import axios from "axios";
import redis from "./redis";
import { pipelineEmitter } from "./emitter";
import { FlaggedEvent } from "./models/flaggedEvent";
import type {
  sensorData,
  sensorDataBatch,
  sensorGroup,
  optimizerInput,
  optimizerOutput,
  detectionInput,
  detectionOutput,
  PipelineEvent,
} from "./types";

const OPTIMIZER_API_URL =
  process.env.OPTIMIZER_API_URL || "http://localhost:8002";
const DETECTION_API_URL =
  process.env.DETECTION_API_URL || "http://localhost:8001";

const REDIS_KEY   = "sensor:buffer";
const BUFFER_SIZE = 25; // 5 ticks × 5 sensors
const GROUP_SIZE  = 5;  // sensors per tick

// Feature order used during model training (shared by both optimizer and detection)
const MODEL_FEATURES: (keyof sensorDataBatch)[] = [
  "pressure", "flow_rate", "temperature", "pump_power", "pressure_mean", "pressure_var",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(4));
}

// ── Step 1: Generate 5 sensorData objects for the current tick ────────────────

function generateSensorData(): sensorData[] {
  const timestamp = new Date().toISOString();
  return Array.from({ length: GROUP_SIZE }, (_, i) => ({
    id:          String(i + 1),
    timestamp,
    pressure:    rand(2.0, 5.0),
    flow_rate:   rand(10.0, 25.0),
    temperature: rand(18.0, 35.0),
    pump_power:  rand(20.0, 320.0),
  }));
}

// ── Step 2: Push raw readings into Redis buffer ───────────────────────────────

async function pushToRedis(readings: sensorData[]): Promise<void> {
  const pipe = redis.pipeline();
  for (const r of readings) {
    pipe.rpush(REDIS_KEY, JSON.stringify(r));
  }
  await pipe.exec();
}

// ── Step 3: Build the sensorGroup structure from the buffer ──────────────────

async function buildSensorGroups(): Promise<sensorGroup[] | null> {
  const len = await redis.llen(REDIS_KEY);
  if (len < BUFFER_SIZE) {
    console.log(`[pipeline] buffer at ${len}/${BUFFER_SIZE} — waiting`);
    return null;
  }

  // Read the oldest 25 readings
  const raw = await redis.lrange(REDIS_KEY, 0, BUFFER_SIZE - 1);

  // Slide: drop the oldest GROUP_SIZE entries so next tick reads a fresh window
  await redis.ltrim(REDIS_KEY, GROUP_SIZE, -1);

  const readings: sensorData[] = raw.map((r) => JSON.parse(r));

  // Group into 5 chunks of 5 (each chunk = one tick / one sensorGroup)
  const groups: sensorData[][] = [];
  for (let i = 0; i < BUFFER_SIZE; i += GROUP_SIZE) {
    groups.push(readings.slice(i, i + GROUP_SIZE));
  }

  // Build 5 sensorGroups — compute pressure_mean & pressure_var per group
  return groups.map((group): sensorGroup => {
    const pressures = group.map((r) => r.pressure);
    const mean      = pressures.reduce((a, b) => a + b, 0) / pressures.length;
    const variance  =
      pressures.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
      pressures.length;

    const batches = group.map((r): sensorDataBatch => ({
      id:            r.id,
      timestamp:     r.timestamp,
      pressure:      r.pressure,
      flow_rate:     r.flow_rate,
      temperature:   r.temperature,
      pump_power:    r.pump_power,
      pressure_mean: parseFloat(mean.toFixed(6)),
      pressure_var:  parseFloat(variance.toFixed(6)),
    }));

    return batches as unknown as sensorGroup;
  });
}

// ── Step 4: Build model payload — shape (5, 30) ───────────────────────────────
// Each row = 5 sensors sorted by id × 6 features = 30 floats
// Features: [pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]
// Used by both optimizer and detection (identical shape)

function buildModelPayload(groups: sensorGroup[]): number[][] {
  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => Number(a.id) - Number(b.id));
    const row: number[] = [];
    for (const sensor of sorted) {
      for (const feature of MODEL_FEATURES) {
        row.push(sensor[feature] as number);
      }
    }
    return row; // 30 floats
  });
}

// ── Step 5a: Call the optimizer model ────────────────────────────────────────

async function callOptimizer(input: optimizerInput): Promise<optimizerOutput> {
  const response = await axios.post<optimizerOutput>(
    `${OPTIMIZER_API_URL}/predict`,
    input,
    { timeout: 5000 }
  );
  return response.data;
}

// ── Step 5b: Call the detection model ────────────────────────────────────────

async function callDetection(input: detectionInput): Promise<detectionOutput> {
  const response = await axios.post<detectionOutput>(
    `${DETECTION_API_URL}/predict`,
    input,
    { timeout: 5000 }
  );
  return response.data;
}

// ── Step 6: Persist flagged anomaly to MongoDB ────────────────────────────────

async function storeFlaggedEvent(
  sensorWindow: sensorGroup[],
  detectionResult: detectionOutput
): Promise<void> {
  await FlaggedEvent.create({
    detectedAt:      new Date(),
    sensorWindow,
    detectionResult,
  });
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

export async function runPipeline(): Promise<void> {
  try {
    // 1. Generate raw sensor readings
    const raw = generateSensorData();
    console.log(
      `[pipeline] generated ${raw.length} readings at ${raw[0].timestamp}`
    );

    // 2. Push to Redis buffer
    await pushToRedis(raw);

    // 3. Build sensorGroups — returns null if buffer < 25
    const groups = await buildSensorGroups();
    if (!groups) return;

    console.log("[pipeline] buffer ready — calling optimizer & detection...");

    // 4. Build model payload: (5, 30) numeric array — shared by both models
    const modelPayload = buildModelPayload(groups);

    // 5. Call both models in parallel
    const [optimizerResult, detectionResult] = await Promise.all([
      callOptimizer(modelPayload),
      callDetection(modelPayload),
    ]);

    console.log(
      `[pipeline] optimizer → pump_power_optimized: ${optimizerResult.pump_power_optimized} kW` +
      ` | detection → anomaly_detected: ${detectionResult.anomaly_detected}`
    );

    // 6. If anomaly detected, persist full window to MongoDB
    if (detectionResult.anomaly_detected) {
      await storeFlaggedEvent(groups, detectionResult);
      console.log("[pipeline] anomaly flagged — event stored in MongoDB");
    }

    // 7. Emit pipeline event to SSE clients
    const lastGroup = groups[4];
    const sensor5Reading = lastGroup.find((r) => r.id === "5");
    const event: PipelineEvent = {
      timestamp: raw[0].timestamp,
      anomaly: detectionResult.anomaly_detected
        ? { detected: true, sensorWindow: groups as unknown as sensorDataBatch[][] }
        : { detected: false },
      sensor5: { pump_power: sensor5Reading?.pump_power ?? 0 },
      optimizer: { pump_power_optimized: optimizerResult.pump_power_optimized },
    };
    pipelineEmitter.emit("update", event);

  } catch (err: any) {
    console.error("[pipeline] error:", err?.message ?? err);
  }
}
