import amqp from "amqplib";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { generateSensorData } from "./physics";

dotenv.config();

// ── Constants ─────────────────────────────────────────────────────────────────

const RABBITMQ_URI     = process.env.RABBITMQ_URI     || "amqp://guest:guest@localhost:5672";
const TICK_INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS || "5000", 10);
const MAX_DRIFT_MS     = parseInt(process.env.MAX_DRIFT_MS     || "2500", 10);
const EXCHANGE_NAME    = "sensor.events";

// ── Load and validate per-sensor secret keys ──────────────────────────────────

const SENSOR_SECRET_KEYS: Record<string, string> = {
  "1": process.env.SENSOR_1_SECRET_KEY ?? "",
  "2": process.env.SENSOR_2_SECRET_KEY ?? "",
  "3": process.env.SENSOR_3_SECRET_KEY ?? "",
  "4": process.env.SENSOR_4_SECRET_KEY ?? "",
  "5": process.env.SENSOR_5_SECRET_KEY ?? "",
};

const missingSensorKeys = Object.entries(SENSOR_SECRET_KEYS)
  .filter(([, v]) => !v)
  .map(([k]) => `SENSOR_${k}_SECRET_KEY`);

if (missingSensorKeys.length > 0) {
  console.error(
    `[sensor-server] missing required env variables: ${missingSensorKeys.join(", ")}`
  );
  process.exit(1);
}

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
      `every ${TICK_INTERVAL_MS}ms (MAX_DRIFT_MS=${MAX_DRIFT_MS}ms)`
    );
  } catch (err: any) {
    console.error("[sensor-server] failed to connect to RabbitMQ:", err?.message ?? err);
    process.exit(1);
  }

  function publishTick(): void {
    try {
      // One shared physics base time for this tick
      const baseTs   = new Date();
      const baseTsMs = baseTs.getTime();

      // Physics runs once — all 5 sensors share the same physical state
      const readings = generateSensorData(baseTs);

      for (const reading of readings) {
        // Independent random jitter in ±MAX_DRIFT_MS for each sensor
        const jitter    = Math.floor((Math.random() * 2 - 1) * MAX_DRIFT_MS);
        const sensorTs  = new Date(baseTsMs + jitter);
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

      console.log(`[sensor-server] tick published — base=${baseTs.toISOString()}`);
    } catch (err: any) {
      console.error("[sensor-server] publish error:", err?.message ?? err);
    }
  }

  // Publish immediately on startup then every TICK_INTERVAL_MS
  publishTick();
  setInterval(publishTick, TICK_INTERVAL_MS);
}

start();
