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
const BINDING_PATTERN = "sensor.#";  // # matches zero or more dot-delimited words — handles UUID routing keys (sensor.<uuid>)
const BUFFER_SIZE     = 5;           // complete buckets needed to fire the pipeline
const SENSOR_COUNT    = 5;           // sensors per location
const LOCATIONS       = ["locationA", "locationB"] as const;

// Reconnection backoff: starts at 1 s, doubles each attempt, caps at 30 s.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;

// Feature order used during model training (shared by both optimizer and detection)
const MODEL_FEATURES: (keyof sensorDataBatch)[] = [
  "pressure", "flow_rate", "temperature", "pump_power", "pressure_mean", "pressure_var",
];

// ── In-memory state ───────────────────────────────────────────────────────────

// sensorId → plaintext secret (populated at startup; UUIDs are globally unique across locations)
const sensorSecretKeys = new Map<string, string>();

// sensorId → location string (populated at startup from MongoDB)
const sensorLocation = new Map<string, string>();

// location → sorted sensorId[] (derived from sensorLocation after loadSensorKeys()).
// Used by onDeadline() for imputation. Built once; never hard-coded.
const locationSensorIds = new Map<string, string[]>();

// deadline timers keyed by "<location>:<bucket_ms>" composite string
const deadlineTimers = new Map<string, NodeJS.Timeout>();

// Per-location pipeline mutex — Node.js is single-threaded so a boolean flag is
// sufficient: the check+set happens synchronously before the first await.
const pipelineRunning = new Map<string, boolean>([
  ["locationA", false],
  ["locationB", false],
]);

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
// Populates sensorSecretKeys, sensorLocation, and locationSensorIds.
// locationSensorIds is derived from sensorLocation so sensor UUIDs are never
// duplicated — MongoDB is the single source of truth.

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
      sensorLocation.set(sensor.id, sensor.location);
    } catch (err: any) {
      console.error(`[pipeline] failed to decrypt key for sensor ${sensor.id}:`, err?.message ?? err);
      process.exit(1);
    }
  }

  // Build location → sensorId[] map from the loaded sensorLocation entries.
  // IDs are sorted lexicographically so the order matches assembleAndPushBatch()
  // and buildModelPayload() — all three sort by id ascending.
  for (const [sensorId, loc] of sensorLocation) {
    if (!locationSensorIds.has(loc)) locationSensorIds.set(loc, []);
    locationSensorIds.get(loc)!.push(sensorId);
  }
  for (const [loc, ids] of locationSensorIds) {
    ids.sort((a, b) => a.localeCompare(b));
    console.log(`[pipeline] location "${loc}" — ${ids.length} sensor(s): [${ids.join(", ")}]`);
  }

  console.log(
    `[pipeline] loaded secret keys for ${sensorSecretKeys.size} sensor(s) ` +
    `across ${locationSensorIds.size} location(s)`
  );
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

async function updateLastKnown(reading: sensorData, location: string): Promise<void> {
  await redis.set(`sensor:last:${location}:${reading.id}`, JSON.stringify(reading));
  console.log(`[pipeline] sensor:last:${location}:${reading.id} updated`);
}

// ── Bucket: assemble batch, push to list, trigger pipeline ───────────────────

async function assembleAndPushBatch(location: string, bucket: number): Promise<void> {
  const bucketKey  = `sensor:tick:${location}:${bucket}`;
  const closingKey = `sensor:closing:${location}:${bucket}`;

  // Atomic claim — SET NX ensures only one caller (processSensorMessage or onDeadline)
  // closes a given bucket. The second caller silently exits.
  const claimed = await redis.set(closingKey, "1", "EX", 30, "NX");
  if (!claimed) {
    console.warn(`[pipeline] bucket ${location}:${bucket} already being closed — skipping duplicate`);
    return;
  }

  // 1. Read all sensor readings from the bucket hash
  const hash = await redis.hgetall(bucketKey);
  const rawReadings = Object.values(hash);

  if (rawReadings.length !== SENSOR_COUNT) {
    console.error(
      `[pipeline] assembleAndPushBatch: bucket ${location}:${bucket} has ` +
      `${rawReadings.length}/${SENSOR_COUNT} sensors — dropping`
    );
    await redis.del(bucketKey);
    return;
  }

  // 2. Delete the hash immediately — it is no longer needed
  await redis.del(bucketKey);

  // 3. Sort sensor readings by id ascending (lexicographic — stable across UUID values)
  const readings: sensorData[] = rawReadings.map((v) => JSON.parse(v));
  const sorted = readings.sort((a, b) => a.id.localeCompare(b.id));

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

  // 6. Push the serialized batch onto the location's list
  const listKey = `sensor:ticks:complete:${location}`;
  const llen    = await redis.rpush(listKey, JSON.stringify(group));
  console.log(
    `[pipeline] batch assembled for ${location} bucket ${bucket} — list length: ${llen}/${BUFFER_SIZE}`
  );

  // 7. Check if the pipeline should fire for this location
  await tryRunPipeline(location);
}

// ── Bucket: deadline handler — impute missing sensors then assemble ───────────

async function onDeadline(location: string, bucket: number): Promise<void> {
  const timerKey = `${location}:${bucket}`;
  deadlineTimers.delete(timerKey);

  const bucketKey = `sensor:tick:${location}:${bucket}`;
  const existing  = await redis.hgetall(bucketKey);
  const present   = Object.keys(existing).length;

  console.log(
    `[pipeline] deadline fired for ${location} bucket ${bucket} — ${present}/${SENSOR_COUNT} sensors present`
  );

  // Use the MongoDB-derived sensor list — no hard-coded UUIDs
  const sensorIds = locationSensorIds.get(location);
  if (!sensorIds) {
    console.error(
      `[pipeline] onDeadline: unknown location "${location}" — ` +
      `known: [${[...locationSensorIds.keys()].join(", ")}]. Dropping bucket ${bucket}.`
    );
    await redis.del(bucketKey);
    return;
  }
  for (const sensorId of sensorIds) {
    if (existing[sensorId]) continue;  // already reported

    const lastKnown = await redis.get(`sensor:last:${location}:${sensorId}`);
    if (!lastKnown) {
      console.warn(
        `[pipeline] dropping ${location} bucket ${bucket} — no last-known value for sensor ${sensorId}`
      );
      await redis.del(bucketKey);
      return;  // cannot impute — drop this bucket
    }

    await redis.hset(bucketKey, sensorId, lastKnown);
    console.log(`[pipeline] imputed sensor ${sensorId} for ${location} bucket ${bucket}`);
  }

  await assembleAndPushBatch(location, bucket);
}

// ── Per-message processing (called after JWT verified) ───────────────────────

async function processSensorMessage(reading: sensorData, location: string): Promise<void> {
  // 1. Always update last-known value for this sensor (scoped by location)
  await updateLastKnown(reading, location);

  // 2. Round wire timestamp to nearest bucket boundary
  const ts        = new Date(reading.timestamp).getTime();
  const bucket    = Math.round(ts / TICK_INTERVAL_MS) * TICK_INTERVAL_MS;
  const bucketKey = `sensor:tick:${location}:${bucket}`;

  console.log(`[pipeline] msg received — sensor ${reading.id} (${location}), bucket ${bucket}`);

  // 3. Check if this is the first reading for this bucket+location
  const isFirst = (await redis.hlen(bucketKey)) === 0;

  // 4. Store reading in the bucket hash (keyed by sensor id within this location)
  await redis.hset(bucketKey, reading.id, JSON.stringify(reading));

  // 5. On first reading: set TTL + start deadline timer
  if (isFirst) {
    await redis.pexpire(bucketKey, TICK_INTERVAL_MS * BUFFER_SIZE * 3);
    const timerKey = `${location}:${bucket}`;
    const timer    = setTimeout(() => onDeadline(location, bucket), BUCKET_DEADLINE_MS);
    deadlineTimers.set(timerKey, timer);
    console.log(`[pipeline] new ${location} bucket ${bucket} — deadline in ${BUCKET_DEADLINE_MS}ms`);
  }

  // 6. Log current fill count
  const hlen = await redis.hlen(bucketKey);
  console.log(
    `[pipeline] sensor ${reading.id} → ${location} bucket ${bucket} (${hlen}/${SENSOR_COUNT} sensors)`
  );

  // 7. If all 5 sensors for this location have reported: cancel deadline and assemble immediately
  if (hlen === SENSOR_COUNT) {
    const timerKey = `${location}:${bucket}`;
    const timer    = deadlineTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      deadlineTimers.delete(timerKey);
    }
    console.log(`[pipeline] ${location} bucket ${bucket} full — closing immediately`);
    await assembleAndPushBatch(location, bucket);
  }
}

// ── Pipeline trigger — fires when a location's list reaches BUFFER_SIZE ───────

async function tryRunPipeline(location: string): Promise<void> {
  if (pipelineRunning.get(location)) return;
  pipelineRunning.set(location, true);

  try {
    const listKey = `sensor:ticks:complete:${location}`;

    // 1. Check list length
    const llen = await redis.llen(listKey);
    if (llen < BUFFER_SIZE) {
      console.log(`[pipeline] ${location} buffer ${llen}/${BUFFER_SIZE} — waiting for more ticks`);
      return;
    }

    // 2. Read exactly BUFFER_SIZE batches (oldest → newest)
    const batchStrs = await redis.lrange(listKey, 0, BUFFER_SIZE - 1);
    if (batchStrs.length !== BUFFER_SIZE) {
      console.error(
        `[pipeline] ${location}: expected ${BUFFER_SIZE} batches in list, got ${batchStrs.length} — aborting run`
      );
      return;
    }
    const groups: sensorGroup[] = batchStrs.map((s) => JSON.parse(s));

    const ts0 = groups[0][0].timestamp;
    const ts4 = groups[BUFFER_SIZE - 1][0].timestamp;
    console.log(`[pipeline] running pipeline for ${location} — window: ${ts0} → ${ts4}`);

    // 3. Pop the oldest batch to slide the window (list goes back to 4)
    await redis.lpop(listKey);
    console.log(`[pipeline] ${location} oldest batch popped — list length now ${BUFFER_SIZE - 1}`);

    // 4. Build (5, 30) model payload
    const modelPayload = buildModelPayload(groups);
    console.log(
      `[pipeline] ${location} payload shape: ${modelPayload.length} rows × ${modelPayload[0]?.length ?? 0} floats`
    );

    // 5. Call both models in parallel
    const [optimizerResult, detectionResult] = await Promise.all([
      callOptimizer(modelPayload),
      callDetection(modelPayload),
    ]);

    console.log(
      `[pipeline] ${location} optimizer → pump_power_optimized: ${optimizerResult.pump_power_optimized} kW` +
      ` | detection → anomaly_detected: ${detectionResult.anomaly_detected}`
    );

    // 6. Persist flagged anomaly if detected
    if (detectionResult.anomaly_detected) {
      await storeFlaggedEvent(location, groups, detectionResult);
      console.log(`[pipeline] ${location} anomaly flagged — event stored in MongoDB`);
    }

    // 7. Build and emit SSE event — last sensor in the group for pump_power reference
    const lastGroup         = groups[BUFFER_SIZE - 1];
    const lastSensorReading = lastGroup[lastGroup.length - 1]; // highest id in this location

    const event: PipelineEvent = {
      timestamp: ts4,
      location,
      anomaly: detectionResult.anomaly_detected
        ? { detected: true, sensorWindow: groups as unknown as sensorDataBatch[][] }
        : { detected: false },
      sensor5:   { pump_power: lastSensorReading?.pump_power ?? 0 },
      optimizer: { pump_power_optimized: optimizerResult.pump_power_optimized },
    };
    pipelineEmitter.emit("update", event);
    console.log(`[pipeline] SSE event emitted for ${location} — timestamp ${ts4}`);
  } catch (err: any) {
    console.error(`[pipeline] error during ${location} pipeline run:`, err?.message ?? err);
  } finally {
    pipelineRunning.set(location, false);
  }
}

// ── Build model payload — shape (5, 30) ──────────────────────────────────────
// Each row = 5 sensors sorted by id (lexicographic asc) × 6 features = 30 floats

function buildModelPayload(groups: sensorGroup[]): number[][] {
  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
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
  location: string,
  sensorWindow: sensorGroup[],
  detectionResult: detectionOutput
): Promise<void> {
  await FlaggedEvent.create({
    detectedAt: new Date(),
    location,
    sensorWindow,
    detectionResult,
  });
}

// ── AMQP consumer setup ───────────────────────────────────────────────────────
// Called on every successful (re)connect. Asserts the exchange + queue,
// sets prefetch, and registers the message handler.

async function setupConsumer(channel: amqp.Channel): Promise<void> {
  await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, BINDING_PATTERN);
  channel.prefetch(1);

  console.log(
    `[pipeline] consuming from queue "${QUEUE_NAME}" ` +
    `(exchange="${EXCHANGE_NAME}", binding="${BINDING_PATTERN}")`
  );

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

      // Resolve location from the in-memory map (populated from MongoDB at startup)
      const loc = sensorLocation.get(sensorId);
      if (!loc) {
        console.warn(
          `[pipeline] no location found for sensor ${sensorId} — nack (no requeue)`
        );
        channel.nack(msg, false, false);
        return;
      }

      await processSensorMessage(body, loc);
      channel.ack(msg);
    } catch (err: any) {
      console.error("[pipeline] error processing message:", err?.message ?? err);
      channel.nack(msg, false, false);
    }
  });
}

// ── AMQP connection + reconnection loop ───────────────────────────────────────
// On any error or unexpected close, schedules a reconnect with exponential
// backoff (1 s → 2 s → … → 30 s). In-memory state (sensorSecretKeys,
// sensorLocation, locationSensorIds) is loaded once at startup and is not
// affected by reconnects — the broker holds no auth state.

async function connectAndConsume(attempt: number): Promise<void> {
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt - 1), RECONNECT_MAX_MS);

  try {
    const connection = await amqp.connect(RABBITMQ_URI);
    const channel    = await connection.createChannel();

    console.log(`[pipeline] connected to RabbitMQ (attempt ${attempt})`);

    await setupConsumer(channel);

    // On broker-side error or connection drop: reconnect
    const onLost = (err?: any) => {
      console.error(
        "[pipeline] RabbitMQ connection lost:",
        err?.message ?? "connection closed"
      );
      scheduleReconnect(1);
    };

    connection.on("error", onLost);
    connection.on("close", onLost);
  } catch (err: any) {
    console.error(
      `[pipeline] RabbitMQ connect failed (attempt ${attempt}), ` +
      `retrying in ${delay}ms — ${err?.message ?? err}`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
    await connectAndConsume(attempt + 1);
  }
}

function scheduleReconnect(attempt: number): void {
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt - 1), RECONNECT_MAX_MS);
  console.log(`[pipeline] scheduling reconnect in ${delay}ms (attempt ${attempt})`);
  setTimeout(
    () => connectAndConsume(attempt).catch(() => scheduleReconnect(attempt + 1)),
    delay
  );
}

// ── RabbitMQ consumer — entry point called from index.ts ──────────────────────

export async function startConsumer(): Promise<void> {
  // Clear stale lists from any previous session (one per location).
  for (const loc of LOCATIONS) {
    await redis.del(`sensor:ticks:complete:${loc}`);
  }
  console.log("[pipeline] cleared stale sensor:ticks:complete:* lists on startup");

  // Clear stale sensor:last:* keys — they may carry old location strings from a
  // previous schema that would cause onDeadline to crash.
  const lastKeys = await redis.keys("sensor:last:*");
  if (lastKeys.length > 0) {
    await redis.del(...lastKeys);
    console.log(`[pipeline] cleared ${lastKeys.length} stale sensor:last:* key(s) on startup`);
  }

  // Load and decrypt sensor secret keys + location mapping from MongoDB.
  // Also builds locationSensorIds from the loaded data — no hard-coded UUIDs.
  await loadSensorKeys();

  // Connect to RabbitMQ and start consuming. The reconnect loop handles all
  // subsequent broker disconnects transparently.
  await connectAndConsume(1);
}
