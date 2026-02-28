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

// ── Physics simulation state (persists across ticks) ─────────────────────────
let prevFlowRate = 0.025;
let prevPumpPower = 80;
let prevTruePressure = 5.5;
let reservoirLevel = 70;
let sensorBiases: number[] | null = null;

// Attack state for FDI injection
let activeAttack: {
  type: "pressure" | "pump_power" | "flow_rate";
  sensorId?: number;        // only for pressure attacks (0-4)
  value: number;
  ticksRemaining: number;
} | null = null;

// ── Physics helpers ───────────────────────────────────────────────────────────

function randNormal(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function demandProfile(hourFloat: number): number {
  const morning = 0.06 * Math.exp(-0.5 * Math.pow((hourFloat - 7.5) / 1.0, 2));
  const evening = 0.07 * Math.exp(-0.5 * Math.pow((hourFloat - 19.5) / 1.5, 2));
  return 0.015 + morning + evening;
}

// ── Step 1: Generate 5 sensorData objects using physics model ─────────────────

function generateSensorData(): sensorData[] {
  const now = new Date();
  const timestamp = now.toISOString();

  // ── Time features ───────────────────────────────────────────────────────────
  const hourFloat = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isPeakHour = (hourFloat >= 6 && hourFloat <= 9) || (hourFloat >= 18 && hourFloat <= 22);

  // ── 1. Flow rate — demand profile + EMA smoothing ───────────────────────────
  let baseFlow = demandProfile(hourFloat);
  if (isWeekend) baseFlow *= 0.75;

  let flowRate = clamp(
    0.85 * prevFlowRate + 0.15 * baseFlow + randNormal(0, 0.0005),
    0.005, 0.14
  );
  prevFlowRate = flowRate;

  // ── 2. Pump power — demand-responsive + EMA smoothing ───────────────────────
  const demandNorm = flowRate / 0.14;
  const pumpTarget = 30 + 280 * demandNorm + (isPeakHour ? 25 : 0);
  let pumpPower = clamp(
    0.92 * prevPumpPower + 0.08 * pumpTarget + randNormal(0, 0.7),
    20, 320
  );
  prevPumpPower = pumpPower;

  // ── 3. Reservoir level — internal state ─────────────────────────────────────
  const kIn = 0.0012, kOut = 8.0;
  const intervalSec = 5;
  const dR = kIn * pumpPower - kOut * flowRate;
  reservoirLevel = clamp(
    reservoirLevel + dR * (intervalSec / 3600) + randNormal(0, 0.02),
    10, 100
  );

  // ── 4. Temperature — daily cycle ────────────────────────────────────────────
  const temperature = 15 + 5 * Math.sin(2 * Math.PI * (hourFloat / 24 - 0.25)) + randNormal(0, 0.3);

  // ── 5. True pressure — physics model + EMA smoothing ────────────────────────
  const ALPHA = 0.12, BETA = 0.8, GAMMA = 0.03;
  const tempEffect = 0.005 * (temperature - 12);
  const truePressureRaw =
    ALPHA * pumpPower - BETA * flowRate * 100 + GAMMA * reservoirLevel + tempEffect + randNormal(0, 0.03);
  const truePressure = clamp(
    0.7 * prevTruePressure + 0.3 * truePressureRaw,
    4.5, 6.5
  );
  prevTruePressure = truePressure;

  // ── 6. Initialize sensor biases (once) ──────────────────────────────────────
  if (!sensorBiases) {
    sensorBiases = Array.from({ length: GROUP_SIZE }, () => randNormal(0, 0.05));
  }

  // ── 7. FDI attack injection (~8% chance per tick) ───────────────────────────
  const ATTACK_PROBABILITY = 0.08;

  if (activeAttack) {
    activeAttack.ticksRemaining--;
    if (activeAttack.ticksRemaining <= 0) {
      activeAttack = null;
    }
  }

  if (!activeAttack && Math.random() < ATTACK_PROBABILITY) {
    const attackTypes = ["pressure", "pump_power", "flow_rate"] as const;
    const type = attackTypes[Math.floor(Math.random() * attackTypes.length)];
    const duration = Math.floor(Math.random() * 3) + 1; // 1-3 ticks

    if (type === "pressure") {
      activeAttack = {
        type,
        sensorId: Math.floor(Math.random() * GROUP_SIZE), // 0-4
        value: Math.random() * 10, // random pressure 0-10
        ticksRemaining: duration,
      };
    } else if (type === "pump_power") {
      activeAttack = {
        type,
        value: 20 + Math.random() * 300, // random pump_power 20-320
        ticksRemaining: duration,
      };
    } else {
      activeAttack = {
        type,
        value: 0.005 + Math.random() * 0.135, // random flow_rate 0.005-0.14
        ticksRemaining: duration,
      };
    }
    console.log(`[pipeline] FDI attack injected: ${type} for ${duration} tick(s)`);
  }

  // Apply active attack to shared values
  if (activeAttack?.type === "pump_power") {
    pumpPower = activeAttack.value;
  } else if (activeAttack?.type === "flow_rate") {
    flowRate = activeAttack.value;
  }

  // ── 8. Generate 5 sensor readings ───────────────────────────────────────────
  const SENSOR_NOISE = 0.05;
  return Array.from({ length: GROUP_SIZE }, (_, i) => {
    let pressure = truePressure + sensorBiases![i] + randNormal(0, SENSOR_NOISE);

    // Apply pressure attack to specific sensor
    if (activeAttack?.type === "pressure" && activeAttack.sensorId === i) {
      pressure = activeAttack.value;
    }

    return {
      id: String(i + 1),
      timestamp,
      pressure: parseFloat(pressure.toFixed(6)),
      flow_rate: parseFloat(flowRate.toFixed(6)),
      temperature: parseFloat(temperature.toFixed(6)),
      pump_power: parseFloat(pumpPower.toFixed(6)),
    };
  });
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
