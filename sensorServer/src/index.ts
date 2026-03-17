import amqp from "amqplib";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { generateSensorData, createPhysicsState } from "./physics";

dotenv.config();

// ── Constants ─────────────────────────────────────────────────────────────────

const RABBITMQ_URI     = process.env.RABBITMQ_URI     || "amqp://guest:guest@localhost:5672";
const TICK_INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS || "5000", 10);
const MAX_DRIFT_MS     = parseInt(process.env.MAX_DRIFT_MS     || "2500", 10);
const EXCHANGE_NAME    = "sensor.events";

// Reconnection backoff: starts at 1 s, doubles each attempt, caps at 30 s.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;

// ── Sensor UUIDs grouped by location ──────────────────────────────────────────
// These UUIDs are the canonical sensor identifiers used in AMQP routing keys
// and JWT payloads. The UUIDs must match the `id` fields in the MongoDB Sensor
// documents and the corresponding LOCATION_*_SECRET_KEY env vars in .env.

const LOCATION_A_SENSOR_IDS = [
  "2bf2a35c-b0b3-4f5e-b344-e63334b5ea21",
  "0b92e342-c8f7-44a0-bedc-78554cc555cf",
  "cfb4fee6-d20b-4d30-9e7f-b450b2e41f2c",
  "4b5a031a-f16a-4615-9179-fede2cdd0d57",
  "64d5be9f-5cff-41f3-9a99-904bdf4ccbcb",
];

const LOCATION_B_SENSOR_IDS = [
  "9bbc9a74-ca06-4873-8780-839f42f676f7",
  "9d39c885-da96-446f-a3ad-de8ce0a42778",
  "47066d75-1f30-4921-b531-2be485580dd3",
  "5d89f0a6-0dae-4db8-b929-40c5c51a8ced",
  "e79c6baf-9828-461b-b148-670dfc1aadc4",
];

// ── Load and validate per-sensor secret keys ──────────────────────────────────
// Positional index 1–5  → locationA sensors (env vars LOCATION_A_SENSOR_1_SECRET_KEY…5)
// Positional index 6–10 → locationB sensors (env vars LOCATION_B_SENSOR_6_SECRET_KEY…10)

const SENSOR_SECRET_KEYS: Record<string, string> = {
  [LOCATION_A_SENSOR_IDS[0]]: process.env.LOCATION_A_SENSOR_1_SECRET_KEY ?? "",
  [LOCATION_A_SENSOR_IDS[1]]: process.env.LOCATION_A_SENSOR_2_SECRET_KEY ?? "",
  [LOCATION_A_SENSOR_IDS[2]]: process.env.LOCATION_A_SENSOR_3_SECRET_KEY ?? "",
  [LOCATION_A_SENSOR_IDS[3]]: process.env.LOCATION_A_SENSOR_4_SECRET_KEY ?? "",
  [LOCATION_A_SENSOR_IDS[4]]: process.env.LOCATION_A_SENSOR_5_SECRET_KEY ?? "",
  [LOCATION_B_SENSOR_IDS[0]]: process.env.LOCATION_B_SENSOR_6_SECRET_KEY ?? "",
  [LOCATION_B_SENSOR_IDS[1]]: process.env.LOCATION_B_SENSOR_7_SECRET_KEY ?? "",
  [LOCATION_B_SENSOR_IDS[2]]: process.env.LOCATION_B_SENSOR_8_SECRET_KEY ?? "",
  [LOCATION_B_SENSOR_IDS[3]]: process.env.LOCATION_B_SENSOR_9_SECRET_KEY ?? "",
  [LOCATION_B_SENSOR_IDS[4]]: process.env.LOCATION_B_SENSOR_10_SECRET_KEY ?? "",
};

const SENSOR_ENV_NAMES: Record<string, string> = {
  [LOCATION_A_SENSOR_IDS[0]]: "LOCATION_A_SENSOR_1_SECRET_KEY",
  [LOCATION_A_SENSOR_IDS[1]]: "LOCATION_A_SENSOR_2_SECRET_KEY",
  [LOCATION_A_SENSOR_IDS[2]]: "LOCATION_A_SENSOR_3_SECRET_KEY",
  [LOCATION_A_SENSOR_IDS[3]]: "LOCATION_A_SENSOR_4_SECRET_KEY",
  [LOCATION_A_SENSOR_IDS[4]]: "LOCATION_A_SENSOR_5_SECRET_KEY",
  [LOCATION_B_SENSOR_IDS[0]]: "LOCATION_B_SENSOR_6_SECRET_KEY",
  [LOCATION_B_SENSOR_IDS[1]]: "LOCATION_B_SENSOR_7_SECRET_KEY",
  [LOCATION_B_SENSOR_IDS[2]]: "LOCATION_B_SENSOR_8_SECRET_KEY",
  [LOCATION_B_SENSOR_IDS[3]]: "LOCATION_B_SENSOR_9_SECRET_KEY",
  [LOCATION_B_SENSOR_IDS[4]]: "LOCATION_B_SENSOR_10_SECRET_KEY",
};

const missingSensorKeys = Object.entries(SENSOR_SECRET_KEYS)
  .filter(([, v]) => !v)
  .map(([k]) => SENSOR_ENV_NAMES[k] ?? k);

if (missingSensorKeys.length > 0) {
  console.error(
    `[sensor-server] missing required env variables: ${missingSensorKeys.join(", ")}`
  );
  process.exit(1);
}

// ── Physics state — one independent instance per location ─────────────────────

const stateA = createPhysicsState(); // locationA — sensors 1–5 (positional)
const stateB = createPhysicsState(); // locationB — sensors 6–10 (positional)

// ── AMQP channel — null when disconnected ────────────────────────────────────
// publishGroup checks for null and skips silently; ticks resume automatically
// once the reconnect loop re-establishes the channel.

let channel: amqp.Channel | null = null;

// ── Publish helpers ───────────────────────────────────────────────────────────

function publishGroup(
  readings: ReturnType<typeof generateSensorData>,
  baseTsMs: number
): void {
  if (!channel) {
    console.warn("[sensor-server] channel unavailable — skipping tick (reconnecting)");
    return;
  }
  for (const reading of readings) {
    // Independent random jitter in ±MAX_DRIFT_MS for each sensor
    const jitter      = Math.floor((Math.random() * 2 - 1) * MAX_DRIFT_MS);
    const sensorTs    = new Date(baseTsMs + jitter);
    reading.timestamp = sensorTs.toISOString();

    // Fresh HS256 JWT per message — never reused
    const secret = SENSOR_SECRET_KEYS[reading.id];
    const token  = jwt.sign(
      { sensorId: reading.id },
      secret,
      { algorithm: "HS256", expiresIn: "1m" }
    );

    const payload    = Buffer.from(JSON.stringify(reading));
    const routingKey = `sensor.${reading.id}`;

    channel.publish(EXCHANGE_NAME, routingKey, payload, {
      persistent: true,
      headers: { "x-token": token },
    });

    console.log(
      `[sensor-server] sensor ${reading.id} → ${routingKey} ` +
      `timestamp=${reading.timestamp} (jitter=${jitter > 0 ? "+" : ""}${jitter}ms)`
    );
  }
}

function publishTick(): void {
  try {
    // One shared physics base time for this tick across both locations
    const baseTs   = new Date();
    const baseTsMs = baseTs.getTime();

    // locationA: sensors with UUIDs LOCATION_A_SENSOR_IDS[0..4]
    const readingsA = generateSensorData(baseTs, stateA, LOCATION_A_SENSOR_IDS);
    publishGroup(readingsA, baseTsMs);

    // locationB: sensors with UUIDs LOCATION_B_SENSOR_IDS[0..4]
    const readingsB = generateSensorData(baseTs, stateB, LOCATION_B_SENSOR_IDS);
    publishGroup(readingsB, baseTsMs);

    console.log(`[sensor-server] tick published — base=${baseTs.toISOString()} (10 messages)`);
  } catch (err: any) {
    console.error("[sensor-server] publish error:", err?.message ?? err);
  }
}

// ── AMQP connection + reconnection loop ───────────────────────────────────────
// Connects to RabbitMQ and asserts the exchange. On any error or unexpected
// close, schedules a reconnect with exponential backoff (1 s → 2 s → … → 30 s).

async function connect(attempt: number): Promise<void> {
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt - 1), RECONNECT_MAX_MS);

  try {
    const connection = await amqp.connect(RABBITMQ_URI);
    const ch         = await connection.createChannel();

    // Assert the durable topic exchange — producer and consumer both assert it
    await ch.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    channel = ch;

    console.log(
      `[sensor-server] connected to RabbitMQ (attempt ${attempt}) — ` +
      `publishing to exchange "${EXCHANGE_NAME}" every ${TICK_INTERVAL_MS}ms ` +
      `(MAX_DRIFT_MS=${MAX_DRIFT_MS}ms) — 10 sensors (2 locations)`
    );

    // On broker-side error or connection drop: null the channel and reconnect
    const onLost = (err?: any) => {
      if (channel !== ch) return; // already reconnecting from another event
      channel = null;
      console.error(
        "[sensor-server] RabbitMQ connection lost:",
        err?.message ?? "connection closed"
      );
      scheduleReconnect(1);
    };

    connection.on("error", onLost);
    connection.on("close", onLost);
  } catch (err: any) {
    channel = null;
    console.error(
      `[sensor-server] RabbitMQ connect failed (attempt ${attempt}), ` +
      `retrying in ${delay}ms — ${err?.message ?? err}`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
    await connect(attempt + 1);
  }
}

function scheduleReconnect(attempt: number): void {
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt - 1), RECONNECT_MAX_MS);
  console.log(`[sensor-server] scheduling reconnect in ${delay}ms (attempt ${attempt})`);
  setTimeout(() => connect(attempt).catch(() => scheduleReconnect(attempt + 1)), delay);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await connect(1);

  // Publish immediately on startup then every TICK_INTERVAL_MS
  publishTick();
  setInterval(publishTick, TICK_INTERVAL_MS);
}

start();
