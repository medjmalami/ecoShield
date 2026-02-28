import axios from "axios";
import redis from "./redis";
import { pipelineEmitter } from "./emitter";
import { FlaggedEvent } from "./models/flaggedEvent";
import type {
  sensorData,
  processedSensorData,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(4));
}

function timeOfDay(hour: number): string {
  if (hour >= 6  && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Step 1: Generate 5 sensorData objects for the current tick ────────────────

function generateSensorData(): sensorData[] {
  const timestamp = new Date().toISOString();
  return Array.from({ length: GROUP_SIZE }, (_, i) => ({
    id:          String(i + 1),
    timestamp,
    pressure:    rand(2.0, 5.0),
    flow_rate:   rand(10.0, 25.0),
    temperature: rand(18.0, 35.0),
    pump_power:  rand(20.0, 90.0),
  }));
}

// ── Step 2: Enrich sensorData → processedSensorData ──────────────────────────

function enrich(data: sensorData): processedSensorData {
  const date = new Date(data.timestamp);
  return {
    ...data,
    time_of_day: timeOfDay(date.getHours()),
    day_of_week: DAYS[date.getDay()],
    month:       MONTHS[date.getMonth()],
  };
}

// ── Step 3: Push enriched readings into Redis buffer ─────────────────────────

async function pushToRedis(readings: processedSensorData[]): Promise<void> {
  const pipe = redis.pipeline();
  for (const r of readings) {
    pipe.rpush(REDIS_KEY, JSON.stringify(r));
  }
  await pipe.exec();
}

// ── Step 4: Build model input from the buffer (shared by both models) ─────────

async function buildModelInput(): Promise<optimizerInput | null> {
  const len = await redis.llen(REDIS_KEY);
  if (len < BUFFER_SIZE) {
    console.log(`[pipeline] buffer at ${len}/${BUFFER_SIZE} — waiting`);
    return null;
  }

  // Read the latest 25 readings
  const raw = await redis.lrange(REDIS_KEY, 0, BUFFER_SIZE - 1);

  // Slide: drop the oldest GROUP_SIZE entries so next tick reads a fresh window
  await redis.ltrim(REDIS_KEY, GROUP_SIZE, -1);

  const readings: processedSensorData[] = raw.map((r) => JSON.parse(r));

  // Group into 5 chunks of 5 (each chunk = one tick / one sensorGroup)
  const groups: processedSensorData[][] = [];
  for (let i = 0; i < BUFFER_SIZE; i += GROUP_SIZE) {
    groups.push(readings.slice(i, i + GROUP_SIZE));
  }

  // Build 5 sensorGroups — compute pressure_mean & pressure_var per group
  const sensorGroups = groups.map((group): sensorGroup => {
    const pressures = group.map((r) => r.pressure);
    const mean      = pressures.reduce((a, b) => a + b, 0) / pressures.length;
    const variance  =
      pressures.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
      pressures.length;

    const batches = group.map((r): sensorDataBatch => ({
      ...r,
      pressure_mean: parseFloat(mean.toFixed(6)),
      pressure_var:  parseFloat(variance.toFixed(6)),
    }));

    return batches as unknown as sensorGroup;
  });

  return sensorGroups as unknown as optimizerInput;
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
  sensorWindow: optimizerInput,
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

    // 2. Enrich to processedSensorData
    const enriched = raw.map(enrich);

    // 3. Push to Redis buffer
    await pushToRedis(enriched);

    // 4. Build model input — returns null if buffer < 25
    const input = await buildModelInput();
    if (!input) return;

    console.log("[pipeline] buffer ready — calling optimizer & detection...");

    // 5. Call both models in parallel (same input shape)
    const [optimizerResult, detectionResult] = await Promise.all([
      callOptimizer(input),
      callDetection(input as unknown as detectionInput),
    ]);

    console.log(
      `[pipeline] optimizer → pump_power_optimized: ${optimizerResult.pump_power_optimized} kW` +
      ` | detection → anomaly_detected: ${detectionResult.anomaly_detected}`
    );

    // 6. If anomaly detected, persist full window to MongoDB
    if (detectionResult.anomaly_detected) {
      await storeFlaggedEvent(input, detectionResult);
      console.log("[pipeline] anomaly flagged — event stored in MongoDB");
    }

    // 7. Emit pipeline event to SSE clients
    const lastGroup = input[4];
    const sensor5Reading = lastGroup.find((r) => r.id === "5");
    const event: PipelineEvent = {
      timestamp: raw[0].timestamp,
      anomaly: detectionResult.anomaly_detected
        ? { detected: true, sensorWindow: input as unknown as sensorDataBatch[][] }
        : { detected: false },
      sensor5: { pump_power: sensor5Reading?.pump_power ?? 0 },
      optimizer: { pump_power_optimized: optimizerResult.pump_power_optimized },
    };
    pipelineEmitter.emit("update", event);

  } catch (err: any) {
    console.error("[pipeline] error:", err?.message ?? err);
  }
}
