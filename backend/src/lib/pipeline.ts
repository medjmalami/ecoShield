import crypto from "crypto";
import axios from "axios";
import amqp from "amqplib";
import jwt from "jsonwebtoken";
import redis from "./redis";
import { pipelineEmitter } from "./emitter";
import { FlaggedEvent } from "./models/flaggedEvent";
import { Sensor } from "./models/sensor";
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

// ── Config ────────────────────────────────────────────────────────────────────

const OPTIMIZER_API_URL  = process.env.OPTIMIZER_API_URL  || "http://localhost:8002";
const DETECTION_API_URL  = process.env.DETECTION_API_URL  || "http://localhost:8001";
const RABBITMQ_URI       = process.env.RABBITMQ_URI       || "amqp://guest:guest@localhost:5672";
const TICK_INTERVAL_MS   = parseInt(process.env.TICK_INTERVAL_MS   || "5000", 10);
const BUCKET_DEADLINE_MS = parseInt(process.env.BUCKET_DEADLINE_MS || "8000", 10);

const EXCHANGE_NAME   = "sensor.events";
const QUEUE_NAME      = "sensor.readings";
const BINDING_PATTERN = "sensor.*";
const BUFFER_SIZE     = 5;  // number of complete batches needed to fire the pipeline
const SENSOR_COUNT    = 5;
const SENSOR_IDS      = ["1", "2", "3", "4", "5"] as const;

// Feature order used during model training (shared by both optimizer and detection)
const MODEL_FEATURES: (keyof sensorDataBatch)[] = [
  "pressure", "flow_rate", "temperature", "pump_power", "pressure_mean", "pressure_var",
];

// ── In-memory state ───────────────────────────────────────────────────────────

// sensorId → plaintext secret (populated at startup from MongoDB, decrypted with MASTER_KEY)
const sensorSecretKeys = new Map<string, string>();

// bucket timestamp (ms) → active deadline NodeJS.Timeout
const deadlineTimers = new Map<number, NodeJS.Timeout>();

// Mutex — prevents tryRunPipeline() from executing concurrently with itself.
// Node.js is single-threaded so a boolean flag is sufficient: the check+set
// happens synchronously before the first await, making it race-free.
let pipelineRunning = false;

// ── Crypto — AES-256-CBC decrypt ─────────────────────────────────────────────
// encryptedSecretKey format stored in MongoDB: "<iv_hex>:<ciphertext_hex>"

function decryptKey(encryptedSecretKey: string): string {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) throw new Error("MASTER_KEY is not set in environment");

  const keyBuf = Buffer.from(masterKey, "hex");
  if (keyBuf.length !== 32) throw new Error("MASTER_KEY must be a 32-byte hex string");

  const [ivHex, cipherHex] = encryptedSecretKey.split(":");
  if (!ivHex || !cipherHex) throw new Error("Invalid encryptedSecretKey format — expected <iv>:<ciphertext>");

  const iv         = Buffer.from(ivHex,     "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");
  const decipher   = crypto.createDecipheriv("aes-256-cbc", keyBuf, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ── Sensor key loading (runs once at startup) ─────────────────────────────────

async function loadSensorKeys(): Promise<void> {
  const sensors = await Sensor.find({ active: true });
  if (sensors.length === 0) {
    console.error("[pipeline] no active sensors found in MongoDB — cannot verify JWT tokens");
    process.exit(1);
  }
  for (const sensor of sensors) {
    try {
      const plaintext = decryptKey(sensor.encryptedSecretKey);
      sensorSecretKeys.set(sensor.id, plaintext);
    } catch (err: any) {
      console.error(`[pipeline] failed to decrypt key for sensor ${sensor.id}:`, err?.message ?? err);
      process.exit(1);
    }
  }
  console.log(`[pipeline] loaded secret keys for ${sensorSecretKeys.size} sensor(s)`);
}

// ── JWT verification ──────────────────────────────────────────────────────────

function verifyToken(token: string, sensorId: string): boolean {
  const secret = sensorSecretKeys.get(sensorId);
  if (!secret) return false;
  try {
    jwt.verify(token, secret, { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function updateLastKnown(reading: sensorData): Promise<void> {
  await redis.set(`sensor:last:${reading.id}`, JSON.stringify(reading));
  console.log(`[pipeline] sensor:last:${reading.id} updated`);
}

// ── Bucket: assemble batch, push to list, trigger pipeline ───────────────────
//
// This replaces the old closeBucket() + the batch-assembly logic that was
// previously buried inside tryRunPipeline(). Doing it here means:
//   • sensor:tick:<bucket> is DEL'd immediately after use (no stale hashes)
//   • sensor:ticks:complete holds fully-assembled sensorGroup JSON strings
//   • tryRunPipeline() only reads from the list — no hash lookups at pipeline time

async function assembleAndPushBatch(bucket: number): Promise<void> {
  const bucketKey  = `sensor:tick:${bucket}`;
  const closingKey = `sensor:closing:${bucket}`;

  // Atomic claim — SET NX ensures only one caller (processSensorMessage or onDeadline)
  // closes a given bucket. The second caller silently exits.
  const claimed = await redis.set(closingKey, "1", "EX", 30, "NX");
  if (!claimed) {
    console.warn(`[pipeline] bucket ${bucket} already being closed — skipping duplicate`);
    return;
  }

  // 1. Read all sensor readings from the bucket hash
  const hash = await redis.hgetall(bucketKey);
  const rawReadings = Object.values(hash);

  if (rawReadings.length !== SENSOR_COUNT) {
    // Should never happen: we only call this after imputation fills all slots
    console.error(
      `[pipeline] assembleAndPushBatch: bucket ${bucket} has ${rawReadings.length}/${SENSOR_COUNT} sensors — dropping`
    );
    await redis.del(bucketKey);
    return;
  }

  // 2. Delete the hash immediately — it is no longer needed
  await redis.del(bucketKey);

  // 3. Sort sensor readings by id ascending (model expects 1→2→3→4→5)
  const readings: sensorData[] = rawReadings.map((v) => JSON.parse(v));
  const sorted = readings.sort((a, b) => Number(a.id) - Number(b.id));

  // 4. Compute pressure_mean and pressure_var across all 5 readings
  const pressures = sorted.map((r) => r.pressure);
  const mean      = pressures.reduce((a, b) => a + b, 0) / pressures.length;
  const variance  = pressures.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pressures.length;

  // 5. Build sensorGroup (5 sensorDataBatch entries)
  const group: sensorGroup = sorted.map((r): sensorDataBatch => ({
    id:            r.id,
    timestamp:     r.timestamp,
    pressure:      r.pressure,
    flow_rate:     r.flow_rate,
    temperature:   r.temperature,
    pump_power:    r.pump_power,
    pressure_mean: parseFloat(mean.toFixed(6)),
    pressure_var:  parseFloat(variance.toFixed(6)),
  })) as sensorGroup;

  // 6. Push the serialized batch onto the right end of the list
  const llen = await redis.rpush("sensor:ticks:complete", JSON.stringify(group));
  console.log(
    `[pipeline] batch assembled for bucket ${bucket} — list length: ${llen}/${BUFFER_SIZE}`
  );

  // 7. Check if the pipeline should fire
  await tryRunPipeline();
}

// ── Bucket: deadline handler — impute missing sensors then assemble ───────────

async function onDeadline(bucket: number): Promise<void> {
  deadlineTimers.delete(bucket);

  const existing = await redis.hgetall(`sensor:tick:${bucket}`);
  const present  = Object.keys(existing).length;

  console.log(
    `[pipeline] deadline fired for bucket ${bucket} — ${present}/${SENSOR_COUNT} sensors present`
  );

  for (const sensorId of SENSOR_IDS) {
    if (existing[sensorId]) continue;  // already reported

    const lastKnown = await redis.get(`sensor:last:${sensorId}`);
    if (!lastKnown) {
      console.warn(
        `[pipeline] dropping bucket ${bucket} — no last-known value for sensor ${sensorId}`
      );
      await redis.del(`sensor:tick:${bucket}`);
      return;  // cannot impute — drop this bucket
    }

    await redis.hset(`sensor:tick:${bucket}`, sensorId, lastKnown);
    console.log(`[pipeline] imputed sensor ${sensorId} for bucket ${bucket}`);
  }

  await assembleAndPushBatch(bucket);
}

// ── Per-message processing (called after JWT verified) ───────────────────────

async function processSensorMessage(reading: sensorData): Promise<void> {
  // 1. Always update last-known value for this sensor
  await updateLastKnown(reading);

  // 2. Round wire timestamp to nearest bucket boundary
  const ts        = new Date(reading.timestamp).getTime();
  const bucket    = Math.round(ts / TICK_INTERVAL_MS) * TICK_INTERVAL_MS;
  const bucketKey = `sensor:tick:${bucket}`;

  console.log(`[pipeline] msg received — sensor ${reading.id}, bucket ${bucket}`);

  // 3. Check if this is the first reading for this bucket
  const isFirst = (await redis.hlen(bucketKey)) === 0;

  // 4. Store reading in the bucket hash
  await redis.hset(bucketKey, reading.id, JSON.stringify(reading));

  // 5. On first reading: set TTL + start deadline timer
  if (isFirst) {
    // TTL long enough to outlive BUFFER_SIZE ticks; auto-cleans incomplete buckets
    await redis.pexpire(bucketKey, TICK_INTERVAL_MS * BUFFER_SIZE * 3);
    const timer = setTimeout(() => onDeadline(bucket), BUCKET_DEADLINE_MS);
    deadlineTimers.set(bucket, timer);
    console.log(`[pipeline] new bucket ${bucket} — deadline in ${BUCKET_DEADLINE_MS}ms`);
  }

  // 6. Log current fill count
  const hlen = await redis.hlen(bucketKey);
  console.log(`[pipeline] sensor ${reading.id} → bucket ${bucket} (${hlen}/${SENSOR_COUNT} sensors)`);

  // 7. If all sensors have reported: cancel deadline and assemble immediately
  if (hlen === SENSOR_COUNT) {
    const timer = deadlineTimers.get(bucket);
    if (timer) {
      clearTimeout(timer);
      deadlineTimers.delete(bucket);
    }
    console.log(`[pipeline] bucket ${bucket} full — closing immediately`);
    await assembleAndPushBatch(bucket);
  }
}

// ── Pipeline trigger — fires when list reaches BUFFER_SIZE ───────────────────
//
// Sliding window: the list always holds the last 4 complete batches after a run.
// On each new tick, a batch is appended (LLEN becomes 5), the pipeline fires,
// then LPOP removes the oldest — leaving 4 again. Frontend gets an event every tick.

async function tryRunPipeline(): Promise<void> {
  if (pipelineRunning) return;
  pipelineRunning = true;

  try {
    // 1. Check list length
    const llen = await redis.llen("sensor:ticks:complete");
    if (llen < BUFFER_SIZE) {
      console.log(`[pipeline] buffer ${llen}/${BUFFER_SIZE} — waiting for more ticks`);
      return;
    }

    // 2. Read exactly BUFFER_SIZE batches (oldest → newest)
    const batchStrs = await redis.lrange("sensor:ticks:complete", 0, BUFFER_SIZE - 1);
    if (batchStrs.length !== BUFFER_SIZE) {
      console.error(
        `[pipeline] expected ${BUFFER_SIZE} batches in list, got ${batchStrs.length} — aborting run`
      );
      return;
    }
    const groups: sensorGroup[] = batchStrs.map((s) => JSON.parse(s));

    const ts0 = groups[0][0].timestamp;
    const ts4 = groups[BUFFER_SIZE - 1][0].timestamp;
    console.log(`[pipeline] running pipeline — window: ${ts0} → ${ts4}`);

    // 3. Pop the oldest batch to slide the window (list goes back to 4)
    await redis.lpop("sensor:ticks:complete");
    console.log(`[pipeline] oldest batch popped — list length now ${BUFFER_SIZE - 1}`);

    // 4. Build (5, 30) model payload
    const modelPayload = buildModelPayload(groups);
    console.log(
      `[pipeline] payload shape: ${modelPayload.length} rows × ${modelPayload[0]?.length ?? 0} floats`
    );

    // 5. Call both models in parallel
    const [optimizerResult, detectionResult] = await Promise.all([
      callOptimizer(modelPayload),
      callDetection(modelPayload),
    ]);

    console.log(
      `[pipeline] optimizer → pump_power_optimized: ${optimizerResult.pump_power_optimized} kW` +
      ` | detection → anomaly_detected: ${detectionResult.anomaly_detected}`
    );

    // 6. Persist flagged anomaly if detected
    if (detectionResult.anomaly_detected) {
      await storeFlaggedEvent(groups, detectionResult);
      console.log("[pipeline] anomaly flagged — event stored in MongoDB");
    }

    // 7. Build and emit SSE event
    const lastGroup      = groups[BUFFER_SIZE - 1];
    const sensor5Reading = lastGroup.find((r) => r.id === "5");

    const event: PipelineEvent = {
      timestamp: ts4,
      anomaly: detectionResult.anomaly_detected
        ? { detected: true, sensorWindow: groups as unknown as sensorDataBatch[][] }
        : { detected: false },
      sensor5:   { pump_power: sensor5Reading?.pump_power ?? 0 },
      optimizer: { pump_power_optimized: optimizerResult.pump_power_optimized },
    };
    pipelineEmitter.emit("update", event);
    console.log(`[pipeline] SSE event emitted — timestamp ${ts4}`);
  } catch (err: any) {
    console.error("[pipeline] error during pipeline run:", err?.message ?? err);
  } finally {
    pipelineRunning = false;
  }
}

// ── Build model payload — shape (5, 30) ──────────────────────────────────────
// Each row = 5 sensors sorted by id × 6 features = 30 floats

function buildModelPayload(groups: sensorGroup[]): number[][] {
  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => Number(a.id) - Number(b.id));
    const row: number[] = [];
    for (const sensor of sorted) {
      for (const feature of MODEL_FEATURES) {
        row.push(sensor[feature] as number);
      }
    }
    return row;  // 30 floats
  });
}

// ── ML callers ────────────────────────────────────────────────────────────────

async function callOptimizer(input: optimizerInput): Promise<optimizerOutput> {
  const response = await axios.post<optimizerOutput>(
    `${OPTIMIZER_API_URL}/predict`,
    input,
    { timeout: 5000 }
  );
  return response.data;
}

async function callDetection(input: detectionInput): Promise<detectionOutput> {
  const response = await axios.post<detectionOutput>(
    `${DETECTION_API_URL}/predict`,
    input,
    { timeout: 5000 }
  );
  return response.data;
}

// ── MongoDB persistence ───────────────────────────────────────────────────────

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

// ── RabbitMQ consumer — entry point called from index.ts ──────────────────────

export async function startConsumer(): Promise<void> {
  // Clear stale list from any previous session.
  // sensor:last:* keys are intentionally preserved — they are valid imputation sources.
  await redis.del("sensor:ticks:complete");
  console.log("[pipeline] cleared stale sensor:ticks:complete on startup");

  // Load and decrypt sensor secret keys from MongoDB before opening the channel
  await loadSensorKeys();

  let connection: amqp.ChannelModel;
  let channel: amqp.Channel;

  try {
    connection = await amqp.connect(RABBITMQ_URI);
    channel    = await connection.createChannel();

    // Assert the durable topic exchange (same declaration as sensorServer)
    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    // Assert the durable queue and bind it to the exchange with sensor.* pattern
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, BINDING_PATTERN);

    // Process one message at a time
    channel.prefetch(1);

    console.log(
      `[pipeline] connected to RabbitMQ — consuming from queue "${QUEUE_NAME}" ` +
      `(exchange="${EXCHANGE_NAME}", binding="${BINDING_PATTERN}")`
    );
  } catch (err: any) {
    console.error("[pipeline] failed to connect to RabbitMQ:", err?.message ?? err);
    process.exit(1);
  }

  channel.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return;

    try {
      const body: sensorData = JSON.parse(msg.content.toString());
      const sensorId         = body.id;
      const token            = msg.properties.headers?.["x-token"];

      // Reject messages with missing or invalid JWT
      if (!token || !verifyToken(String(token), sensorId)) {
        console.warn(
          `[pipeline] invalid/expired token for sensor ${sensorId} — nack (no requeue)`
        );
        channel.nack(msg, false, false);
        return;
      }

      await processSensorMessage(body);
      channel.ack(msg);
    } catch (err: any) {
      console.error("[pipeline] error processing message:", err?.message ?? err);
      channel.nack(msg, false, false);
    }
  });
}
