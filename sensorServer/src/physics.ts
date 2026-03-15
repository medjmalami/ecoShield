import type { sensorData } from "./types";

const GROUP_SIZE = 5; // sensors per tick

// ── Physics simulation state (persists across ticks) ─────────────────────────
let prevFlowRate = 0.025;
let prevPumpPower = 80;
let prevTruePressure = 5.5;
let reservoirLevel = 70;
let sensorBiases: number[] | null = null;

// ── Attack state for FDI injection ───────────────────────────────────────────
let activeAttack: {
  type: "pressure" | "pump_power" | "flow_rate";
  sensorId?: number; // only for pressure attacks (0-4)
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

// ── Generate 5 sensorData objects using physics model ────────────────────────
// `now` is the shared physics base time for this tick, supplied by the caller.
// The caller is responsible for stamping each reading's .timestamp individually
// (with per-sensor jitter applied after this function returns).

export function generateSensorData(now: Date): sensorData[] {
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
    0.005,
    0.14
  );
  prevFlowRate = flowRate;

  // ── 2. Pump power — demand-responsive + EMA smoothing ───────────────────────
  const demandNorm = flowRate / 0.14;
  const pumpTarget = 30 + 280 * demandNorm + (isPeakHour ? 25 : 0);
  let pumpPower = clamp(
    0.92 * prevPumpPower + 0.08 * pumpTarget + randNormal(0, 0.7),
    20,
    320
  );
  prevPumpPower = pumpPower;

  // ── 3. Reservoir level — internal state ─────────────────────────────────────
  const kIn = 0.0012,
    kOut = 8.0;
  const intervalSec = 5;
  const dR = kIn * pumpPower - kOut * flowRate;
  reservoirLevel = clamp(
    reservoirLevel + dR * (intervalSec / 3600) + randNormal(0, 0.02),
    10,
    100
  );

  // ── 4. Temperature — daily cycle ────────────────────────────────────────────
  const temperature =
    15 + 5 * Math.sin(2 * Math.PI * (hourFloat / 24 - 0.25)) + randNormal(0, 0.3);

  // ── 5. True pressure — physics model + EMA smoothing ────────────────────────
  const ALPHA = 0.12,
    BETA = 0.8,
    GAMMA = 0.03;
  const tempEffect = 0.005 * (temperature - 12);
  const truePressureRaw =
    ALPHA * pumpPower -
    BETA * flowRate * 100 +
    GAMMA * reservoirLevel +
    tempEffect +
    randNormal(0, 0.03);
  const truePressure = clamp(
    0.7 * prevTruePressure + 0.3 * truePressureRaw,
    4.5,
    6.5
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
    console.log(`[physics] FDI attack injected: ${type} for ${duration} tick(s)`);
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
      timestamp: "",  // caller stamps each sensor individually with per-sensor jitter
      pressure: parseFloat(pressure.toFixed(6)),
      flow_rate: parseFloat(flowRate.toFixed(6)),
      temperature: parseFloat(temperature.toFixed(6)),
      pump_power: parseFloat(pumpPower.toFixed(6)),
    };
  });
}
