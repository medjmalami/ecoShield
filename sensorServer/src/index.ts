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

// ── Load and validate per-sensor secret keys ──────────────────────────────────
// Sensors 1–5  → locationA
// Sensors 6–10 → locationB
// Each sensor has a globally unique id so the flat key map is unambiguous.

const SENSOR_SECRET_KEYS: Record<string, string> = {
  "1":  process.env.LOCATION_A_SENSOR_1_SECRET_KEY  ?? "",
  "2":  process.env.LOCATION_A_SENSOR_2_SECRET_KEY  ?? "",
  "3":  process.env.LOCATION_A_SENSOR_3_SECRET_KEY  ?? "",
  "4":  process.env.LOCATION_A_SENSOR_4_SECRET_KEY  ?? "",
  "5":  process.env.LOCATION_A_SENSOR_5_SECRET_KEY  ?? "",
  "6":  process.env.LOCATION_B_SENSOR_6_SECRET_KEY  ?? "",
  "7":  process.env.LOCATION_B_SENSOR_7_SECRET_KEY  ?? "",
  "8":  process.env.LOCATION_B_SENSOR_8_SECRET_KEY  ?? "",
  "9":  process.env.LOCATION_B_SENSOR_9_SECRET_KEY  ?? "",
  "10": process.env.LOCATION_B_SENSOR_10_SECRET_KEY ?? "",
};

const missingSensorKeys = Object.entries(SENSOR_SECRET_KEYS)
  .filter(([, v]) => !v)
  .map(([k]) => {
    const num = Number(k);
    return num <= 5
      ? `LOCATION_A_SENSOR_${k}_SECRET_KEY`
      : `LOCATION_B_SENSOR_${k}_SECRET_KEY`;
  });

if (missingSensorKeys.length > 0) {
  console.error(
    `[sensor-server] missing required env variables: ${missingSensorKeys.join(", ")}`
  );
  process.exit(1);
}

// ── Physics state — one independent instance per location ─────────────────────

const stateA = createPhysicsState(); // locationA — sensors 1–5
const stateB = createPhysicsState(); // locationB — sensors 6–10

// ── Main ──────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  let connection: amqp.ChannelModel;
  let channel: amqp.Channel;

  try {
    connection = await amqp.connect(RABBITMQ_URI);
    channel    = await connection.createChannel();

    // Assert the durable topic exchange — producer and consumer both assert it
    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    console.log(
      `[sensor-server] connected to RabbitMQ — publishing to exchange "${EXCHANGE_NAME}" ` +
      `every ${TICK_INTERVAL_MS}ms (MAX_DRIFT_MS=${MAX_DRIFT_MS}ms) — 10 sensors (2 locations)`
    );
  } catch (err: any) {
    console.error("[sensor-server] failed to connect to RabbitMQ:", err?.message ?? err);
    process.exit(1);
  }

  function publishGroup(
    readings: ReturnType<typeof generateSensorData>,
    baseTsMs: number
  ): void {
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

      // locationA: sensors 1–5 (sensorIdOffset=0)
      const readingsA = generateSensorData(baseTs, stateA, 0);
      publishGroup(readingsA, baseTsMs);

      // locationB: sensors 6–10 (sensorIdOffset=5)
      const readingsB = generateSensorData(baseTs, stateB, 5);
      publishGroup(readingsB, baseTsMs);

      console.log(`[sensor-server] tick published — base=${baseTs.toISOString()} (10 messages)`);
    } catch (err: any) {
      console.error("[sensor-server] publish error:", err?.message ?? err);
    }
  }

  // Publish immediately on startup then every TICK_INTERVAL_MS
  publishTick();
  setInterval(publishTick, TICK_INTERVAL_MS);
}

start();
