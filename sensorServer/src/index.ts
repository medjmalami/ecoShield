import amqp from "amqplib";
import dotenv from "dotenv";
import { generateSensorData } from "./physics";

dotenv.config();

const RABBITMQ_URI = process.env.RABBITMQ_URI || "amqp://guest:guest@localhost:5672";
const QUEUE_NAME = "sensor.readings";
const TICK_INTERVAL_MS = 5000;

async function start(): Promise<void> {
  let connection: amqp.ChannelModel;
  let channel: amqp.Channel;

  try {
    connection = await amqp.connect(RABBITMQ_URI);
    channel = await connection.createChannel();

    // Durable so messages survive a RabbitMQ restart
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    console.log(`[sensor-server] connected to RabbitMQ — publishing to queue "${QUEUE_NAME}" every ${TICK_INTERVAL_MS}ms`);
  } catch (err: any) {
    console.error("[sensor-server] failed to connect to RabbitMQ:", err?.message ?? err);
    process.exit(1);
  }

  function publishTick(): void {
    try {
      const readings = generateSensorData();
      const payload = Buffer.from(JSON.stringify(readings));

      // persistent:true — survives broker restart
      channel.sendToQueue(QUEUE_NAME, payload, { persistent: true });

      console.log(`[sensor-server] published tick at ${readings[0].timestamp} (${readings.length} readings)`);
    } catch (err: any) {
      console.error("[sensor-server] publish error:", err?.message ?? err);
    }
  }

  // Publish immediately on startup then every 5s
  publishTick();
  setInterval(publishTick, TICK_INTERVAL_MS);
}

start();
