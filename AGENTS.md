# EcoShield AI — Agent Guidelines

## Repository Layout

```
ecoShield/
├── frontend/        # Next.js 16 dashboard (React 19, TypeScript, Tailwind CSS v4, shadcn/ui)
├── backend/         # Express.js 5 API server (TypeScript, SSE, RabbitMQ consumer)
├── sensorServer/    # RabbitMQ producer — physics simulation + FDI attack injection (TypeScript)
├── detectionModel/  # FastAPI microservice — LSTM anomaly/FDI classifier (Python)
├── optimizerModel/  # FastAPI microservice — LSTM pump-power regressor (Python)
└── notebooks/       # Jupyter notebooks, trained .pt models, .pkl scalers, CSV dataset
```

There is no root-level `package.json`. `frontend/`, `backend/`, and `sensorServer/` are independent Node.js projects. No shared workspace tooling (no Turborepo, no Nx, no `pnpm-workspace.yaml`).

**Data flow:** `sensorServer` → RabbitMQ topic exchange (`sensor.events`) → `sensor.readings` queue → `backend/pipeline` → Redis bucket buffer → ML models → MongoDB + SSE → `frontend`.

**sensorServer is a single process.** It maintains **two independent physics states** — `stateA` for `locationA` and `stateB` for `locationB` — each with 5 physically coupled sensors (pressure, flow rate, pump power, reservoir level). Per tick it publishes **10 AMQP messages** — 5 per location — each with an individually jittered timestamp and its own JWT. This mimics 10 independent sensors on the wire across 2 locations without breaking per-location physics coupling.

---

## Commands

### Frontend (`frontend/` — pnpm)

```bash
pnpm dev        # Start Next.js dev server on http://localhost:3000
pnpm build      # Production build
pnpm start      # Serve the production build
pnpm lint       # Run ESLint (NOTE: ESLint is not yet installed — this script will fail)
```

### Backend (`backend/` — npm)

```bash
npm run dev     # Start Express with nodemon + ts-node hot-reload on port 3001
npm run build   # Compile TypeScript → dist/
npm start       # Run the compiled JS from dist/index.js
```

**One-time setup — sensor registry:** after configuring `MASTER_KEY` and `MONGO_URI` in `backend/.env`, the 10 `Sensor` documents must be inserted into MongoDB manually (or via a private, out-of-band script that is **never committed to source control**). Each document requires:

```json
{
  "id": "<uuid>",
  "name": "Sensor N",
  "location": "locationA | locationB",
  "encryptedSecretKey": "<iv_hex>:<ciphertext_hex>",
  "active": true
}
```

Encrypt each plaintext key with AES-256-CBC using `MASTER_KEY` (see `decryptKey()` in `backend/src/lib/pipeline.ts` for the format). The UUIDs and their corresponding `LOCATION_<X>_SENSOR_<N>_SECRET_KEY` env vars in `sensorServer/.env` are the authoritative source — they must match the `id` and `encryptedSecretKey` fields in MongoDB.

> **Security note:** `backend/scripts/seedSensors.ts` has been removed because it embedded all 10 plaintext sensor secret keys directly in source code. If you have a copy of the repository from before this change, assume those keys are compromised and rotate them (generate new 32-byte hex secrets, update `sensorServer/.env`, re-encrypt and update MongoDB, restart both services).

A utility script is available for maintenance:

```bash
npx ts-node scripts/clearDetections.ts
```

This deletes all `FlaggedEvent` documents from MongoDB. Useful for resetting the anomaly log during development.

### SensorServer (`sensorServer/` — npm)

```bash
npm run dev     # Start the sensor publisher (single process, publishes 10 messages per tick)
npm run build   # Compile TypeScript → dist/
npm start       # Run the compiled JS from dist/index.js
```

### Python Services

```bash
# detectionModel/
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# optimizerModel/
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

### Infrastructure (Docker Compose)

```bash
# From backend/
docker compose up -d    # Start MongoDB 8 + Redis 7 + RabbitMQ 3 (management UI at :15672)
docker compose down     # Stop containers
```

### Testing

**No test framework is currently configured** in any package. There are no test files and no `test` script in any `package.json`. To add testing:
- Frontend/Backend: install Vitest (`pnpm add -D vitest` / `npm i -D vitest`) and add a `"test": "vitest"` script
- Python: install pytest (`pip install pytest`) and run `pytest` from the service directory
- To run a single test file with Vitest: `vitest run src/lib/pipeline.test.ts`
- To run a single pytest test: `pytest detectionModel/test_main.py::test_predict -v`

---

## Environment Variables

### `sensorServer/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `RABBITMQ_URI` | No | `amqp://guest:guest@localhost:5672` | AMQP broker URI |
| `TICK_INTERVAL_MS` | No | `5000` | Publish interval in ms |
| `MAX_DRIFT_MS` | No | `2500` | Max random timestamp jitter per sensor per tick (±ms). Must be ≤ `TICK_INTERVAL_MS / 2` |
| `LOCATION_A_SENSOR_1_SECRET_KEY` | Yes | — | Plaintext shared secret for locationA sensor 1. Used to sign the JWT on every message for that sensor |
| `LOCATION_A_SENSOR_2_SECRET_KEY` | Yes | — | Plaintext shared secret for locationA sensor 2 |
| `LOCATION_A_SENSOR_3_SECRET_KEY` | Yes | — | Plaintext shared secret for locationA sensor 3 |
| `LOCATION_A_SENSOR_4_SECRET_KEY` | Yes | — | Plaintext shared secret for locationA sensor 4 |
| `LOCATION_A_SENSOR_5_SECRET_KEY` | Yes | — | Plaintext shared secret for locationA sensor 5 |
| `LOCATION_B_SENSOR_6_SECRET_KEY` | Yes | — | Plaintext shared secret for locationB sensor 6 |
| `LOCATION_B_SENSOR_7_SECRET_KEY` | Yes | — | Plaintext shared secret for locationB sensor 7 |
| `LOCATION_B_SENSOR_8_SECRET_KEY` | Yes | — | Plaintext shared secret for locationB sensor 8 |
| `LOCATION_B_SENSOR_9_SECRET_KEY` | Yes | — | Plaintext shared secret for locationB sensor 9 |
| `LOCATION_B_SENSOR_10_SECRET_KEY` | Yes | — | Plaintext shared secret for locationB sensor 10 |

### `backend/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | Express server port |
| `RABBITMQ_URI` | No | `amqp://guest:guest@localhost:5672` | AMQP broker URI |
| `MONGO_URI` | Yes | — | MongoDB connection string |
| `MONGO_ROOT_USER` | Yes | — | MongoDB root username (used by Docker Compose to initialise the container) |
| `MONGO_ROOT_PASSWORD` | Yes | — | MongoDB root password (used by Docker Compose) |
| `MONGO_DB` | Yes | — | MongoDB database name (used by Docker Compose) |
| `REDIS_URI` | No | `redis://localhost:6379` | Redis connection string |
| `MASTER_KEY` | Yes | — | 32-byte hex string. AES-256 master key used to encrypt/decrypt sensor secret keys stored in MongoDB. Never stored in the DB. |
| `DETECTION_API_URL` | No | `http://localhost:8001` | FastAPI detection service URL |
| `OPTIMIZER_API_URL` | No | `http://localhost:8002` | FastAPI optimizer service URL |
| `BUCKET_DEADLINE_MS` | No | `8000` | How long to wait for stragglers before closing a time bucket. Must be > `TICK_INTERVAL_MS` and < `2 × TICK_INTERVAL_MS` |

### `frontend/.env.local`

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | Base URL of the Express backend. Used by `frontend/lib/api.ts` for REST and SSE calls |

---

## TypeScript Configuration

### Backend (`backend/tsconfig.json`)
- `"target": "ES2020"`, `"module": "commonjs"`, `"strict": true`
- `"rootDir": "./src"`, `"outDir": "./dist"`
- `"esModuleInterop": true`, `"resolveJsonModule": true`, `"sourceMap": true`

### Frontend (`frontend/tsconfig.json`)
- `"target": "ES6"`, `"module": "esnext"`, `"moduleResolution": "bundler"`, `"strict": true`
- `"noEmit": true` (Next.js handles compilation)
- `"paths": { "@/*": ["./*"] }` — use the `@/` alias for all non-relative imports
- **Note:** `next.config.mjs` sets `typescript.ignoreBuildErrors: true` — fix type errors; do not rely on this escape hatch

---

## Code Style

### Imports

**Frontend** — single quotes, `@/` alias, `import type` for type-only imports:
```typescript
import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/dashboard/navbar';
import { subscribeToEvents } from '@/lib/api';
import type { FlaggedEvent, ChartDataPoint } from '@/lib/api';
```

**Backend** — double quotes, relative paths, `import type` for type-only imports:
```typescript
import express from "express";
import cors from "cors";
import "./lib/mongo";
import { startConsumer } from "./lib/pipeline";
import type { PipelineEvent } from "./lib/types";
```

Import order (both packages): framework/npm packages → local modules → type-only imports.

### Naming Conventions

| Target | Convention | Examples |
|---|---|---|
| React component files | kebab-case | `alert-banner.tsx`, `attack-log.tsx` |
| Utility/lib/hook files | kebab-case | `api.ts`, `use-mobile.ts`, `mock-data.ts` |
| Backend lib files | camelCase | `pipeline.ts`, `redis.ts`, `emitter.ts` |
| React components (exported) | PascalCase default export | `export default function Navbar(...)` |
| React hooks | camelCase with `use` prefix | `useIsMobile`, `useToast` |
| Frontend type aliases / interfaces | PascalCase | `SensorDataBatch`, `FlaggedEvent`, `ChartProps` |
| Backend type aliases | lowercase-first camelCase | `sensorData`, `optimizerInput` (existing pattern) |
| Module-level constants | SCREAMING_SNAKE_CASE | `MAX_CHART_POINTS`, `BUCKET_DEADLINE_MS`, `TICK_INTERVAL_MS` |
| Regular variables and functions | camelCase | `runPipeline`, `buildSensorGroups`, `callOptimizer` |
| Mongoose models | PascalCase | `FlaggedEvent`, `Sensor` |
| Python classes | PascalCase | `LSTMAnomalyClassifier`, `LSTMRegressor2` |
| Python functions/variables | snake_case | `predict`, `feature_scaler` |

### Types

- Strict mode is enabled in both packages — provide explicit types; do not use implicit `any`.
- Use `import type` for all type-only imports.
- Prefer `type` aliases for object shapes in shared `lib/types.ts`; use `interface` for React component props.
- Provide explicit return types on exported async functions: `Promise<void>`, `Promise<sensorGroup[] | null>`.
- Use `as const` for literal arrays/objects that need narrowed types.
- `err: any` in catch clauses is the established pattern (pragmatic — keep consistent).
- Python: use PEP 484 annotations on all function signatures.

### Formatting

No Prettier or ESLint config currently exists. Follow these conventions observed in the codebase:
- **Frontend:** 2-space indentation, single quotes, trailing semicolons.
- **Backend:** 2-space indentation, double quotes, trailing semicolons.
- Keep lines under ~100 characters.
- One blank line between top-level declarations; no blank lines inside short functions.

### React Components

- All dashboard components must have `'use client'` at the top (they use hooks/browser APIs).
- Use default exports for all components: `export default function ComponentName(props: Props) { ... }`.
- Define prop interfaces locally in the file, just above the component function.
- Define helper functions (formatters, transformers) as module-level functions above the component that uses them; do not export them unless needed elsewhere.
- Use the `cn()` utility from `@/lib/utils` for conditional Tailwind class merging.

### Error Handling

- Always prefix log messages with a bracketed service/module tag: `[pipeline]`, `[mongo]`, `[redis]`,
  `[detections]`, `[page]`, `[detection]`, `[optimizer]`, `[sensor-server]`, `[sensors]`.
- Backend route handlers: catch errors, log with `console.error("[route] error:", err?.message ?? err)`,
  and respond with `res.status(500).json({ error: "Internal server error" })`.
- Frontend async callbacks: catch errors and log; update loading/error state so the UI reflects failure.
- Python: raise `HTTPException` for invalid client input (status 422); raise `RuntimeError` on startup
  failures (model load, scaler load).

---

## Architecture Notes

These are load-bearing design decisions — do not change without understanding the implications.

- **Physics simulation state** lives as two independent `PhysicsState` instances in `sensorServer/src/physics.ts` — `stateA` for `locationA` and `stateB` for `locationB`. Each state tracks 5 physically coupled sensors (pressure, flow rate, pump power, reservoir level) and must not be merged or shared between locations. `generateSensorData(now, state, sensorIds)` accepts a state object and the UUID array for that location's sensors, and returns all 5 readings per call. `publishTick()` calls `generateSensorData` twice per tick (once per location), then calls `publishGroup()` for each set of 5 readings. Individual timestamp jitter is applied per sensor after generation.

- **FDI attack simulation:** `sensorServer/src/physics.ts` has an 8% per-tick probability of injecting a
  False Data Injection attack (types: `pressure`, `pump_power`, `flow_rate`; duration: 1–3 ticks). This is
  intentional for demo purposes. Attack state is shared across all sensors in the same process.

- **RabbitMQ topology:** `sensorServer` publishes to a durable topic exchange named `sensor.events`. Each
  sensor reading is published with routing key `sensor.<uuid>` (e.g. `sensor.2bf2a35c-b0b3-4f5e-b344-e63334b5ea21`). The backend
  binds queue `sensor.readings` to this exchange with binding pattern `sensor.#`. Both producer and consumer
  assert the exchange as `type: "topic"` and `durable: true` on startup. Never publish directly to the queue
  by name — always go through the exchange.

- **Sensor authentication (JWT HS256):** every AMQP message carries a short-lived JWT in the message header
  `x-token`. The JWT is signed with that sensor's individual `LOCATION_<X>_SENSOR_<N>_SECRET_KEY` using HS256, contains
  `{ sensorId: string }`, and has a 1-minute TTL (`expiresIn: "1m"`). A fresh token is generated on every
  publish — tokens are never reused. The backend verifies the token on every message before any processing.
  Expired or invalid tokens result in `nack` (no requeue) and a warning log. A compromised key for one
  sensor does not affect the other nine.

- **Sensor secret key storage:** each sensor's `LOCATION_<X>_SENSOR_<N>_SECRET_KEY` is stored AES-256 encrypted in its
  `Sensor` MongoDB document (`encryptedSecretKey` field). The `MASTER_KEY` in `backend/.env` is the sole
  decryption key — it never touches the database. At `startConsumer()` the backend loads all `Sensor`
  documents, decrypts each key in memory, and caches the results for the lifetime of the process. It also
  builds a `sensorLocation: Map<string, string>` mapping (`sensorId → location`) from the loaded documents,
  used to route incoming messages to the correct per-location pipeline. Rotate a sensor key by generating a
  new secret, updating `encryptedSecretKey` in MongoDB and the corresponding
  `LOCATION_<X>_SENSOR_<N>_SECRET_KEY` in `sensorServer/.env`, then restarting both services.

- **Sensor registry:** a `Sensor` Mongoose model (`backend/src/lib/models/sensor.ts`) stores
  `{ id, name, location, encryptedSecretKey, active, registeredAt }`. Documents must be inserted
  out-of-band (see the one-time setup note in the Backend commands section above). The in-memory
  cache built at startup is the auth source of truth during runtime; the DB is not queried per message.

- **Timestamp drift simulation:** `sensorServer` applies an independent random jitter of ±`MAX_DRIFT_MS` to
  each sensor's timestamp before publishing. All 5 readings in a tick share the same underlying physics
  timestamp but each carries a different wire timestamp. `MAX_DRIFT_MS` defaults to 2500ms and must not
  exceed `TICK_INTERVAL_MS / 2` — exceeding this means a drifted reading could round into the wrong bucket.

- **Redis bucket buffer:** incoming sensor readings are grouped into time buckets. The incoming timestamp is
  rounded to the nearest `TICK_INTERVAL_MS` boundary:
  `Math.round(ts / TICK_INTERVAL_MS) * TICK_INTERVAL_MS`. All Redis keys are scoped per location. Four
  Redis structures are used per location:
  - `sensor:last:<location>:<id>` — Redis String holding the most recent valid reading per sensor. Updated
    on every successfully authenticated message regardless of bucket state. Used for last-known-value
    imputation. Flushed on backend startup (via `redis.keys("sensor:last:*")` + bulk `del`) to prevent
    stale key conflicts from before the multi-location refactor.
  - `sensor:tick:<location>:<rounded-ts>` — Redis Hash `{ sensorId → sensorData json }`. TTL =
    `TICK_INTERVAL_MS × BUFFER_SIZE × 3` (75s, auto-cleans incomplete buckets). Explicitly DEL'd by
    `assembleAndPushBatch()` immediately after the batch is assembled — it is never read again after that point.
  - `sensor:closing:<location>:<rounded-ts>` — Redis String NX lock (TTL = 30s). Set atomically before
    assembling a bucket. Prevents double-close races where both `processSensorMessage` (full bucket) and
    `onDeadline` (deadline fired) attempt to assemble the same bucket concurrently.
  - `sensor:ticks:complete:<location>` — Redis **List** of fully-assembled `sensorGroup` JSON strings
    (oldest at head, newest at tail). A batch is appended (`RPUSH`) when a bucket closes. The list always
    holds the last 4 complete batches after each pipeline run. All `sensor:ticks:complete:*` lists are
    DEL'd on backend startup to clear any stale state from the previous session.

- **Bucket deadline and imputation:** when the first reading for a bucket arrives, a `setTimeout` of
  `BUCKET_DEADLINE_MS` is registered in the `deadlineTimers: Map<string, NodeJS.Timeout>` in `pipeline.ts`,
  keyed by `"<location>:<bucket_ms>"` composite strings. If all 5 sensors report before the deadline, the
  timer is cancelled and the bucket is immediately closed. If the deadline fires with fewer than 5 sensors:
  each missing sensor is substituted with its `sensor:last:<location>:<id>` value. `pressure_mean` and
  `pressure_var` are computed from all 5 sensors in the bucket, including imputed ones. If a sensor has no
  last-known value (it has never reported since backend startup), the bucket is dropped entirely and a
  warning is logged — the pipeline does not run for that window. Imputation uses real physics readings from
  the previous tick, not zeros or synthetic values, so the model input shape `(5, 30)` is always preserved.

- **Per-location pipeline mutex:** `pipelineRunning: Map<string, boolean>` prevents concurrent pipeline runs
  for the same location. When the pipeline is triggered for a location, it sets the flag for that location
  and clears it on completion. The two locations (`locationA`, `locationB`) run their pipelines independently
  and do not block each other.

- **Pipeline trigger (sliding window):** the pipeline fires when `LLEN("sensor:ticks:complete") = 5`. It
  reads exactly 5 batches via `LRANGE 0 4` (the fully-assembled `sensorGroup` JSON strings — no hash
  lookups at pipeline time), then immediately `LPOP`s the oldest entry so the list returns to 4. It
  reconstructs the `(5 frames × 30 floats)` payload via `buildModelPayload()` (sensors sorted by id
  ascending, 6 features each: `pressure, flow_rate, temperature, pump_power, pressure_mean,
  pressure_var`). After the 4-tick warm-up, the pipeline fires on every tick (~5s), producing one SSE
  event per tick to the frontend. `BUFFER_SIZE = 5` complete buckets, `SENSOR_COUNT = 5` sensors per
  bucket, total model input = 25 readings. Each location runs its own independent pipeline.

- **Shared model input shape:** both LSTM models accept exactly `(5 frames × 30 floats)`. The
  `buildModelPayload()` function constructs this. Any model retrain must preserve `SEQ_LEN = 5`,
  `input_dim = 30`, and feature order: `[pressure, flow_rate, temperature, pump_power, pressure_mean,
  pressure_var]` per sensor.

- **Parallel ML inference:** detection and optimizer are called via `Promise.all()` — do not make them
  sequential.

- **Detection threshold:** the detection model returns a probability score; `anomaly_detected` is set to
  `true` when `prob >= 0.9`. This threshold is applied inside `detectionModel/main.py`, not in the backend
  pipeline. Do not lower this threshold without revalidating false-positive rates on the training dataset.

- **SSE transport:** the backend emits `PipelineEvent` objects via Node.js `EventEmitter`
  (`pipelineEmitter`). SSE route handlers attach/detach listeners on connect/disconnect. Do not replace this
  with WebSockets without updating both sides.

- **No shared code:** types are intentionally duplicated between `frontend/lib/api.ts` and
  `backend/src/lib/types.ts`. Keep them in sync manually when changing the data shape.

- **`sys.modules["__main__"]` hack (Python):** both FastAPI services register their model class on
  `sys.modules["__main__"]` so `torch.load()` works under uvicorn. Do not remove this.

---

## Adding New Features — Checklist

1. **New backend route:** create a file in `backend/src/routes/`, export a default `Router`, and
   `app.use(...)` it in `backend/src/index.ts`.
2. **New frontend component:** place it in `frontend/components/` using a kebab-case filename; add
   `'use client'` if it uses hooks.
3. **New shared data shape:** update both `backend/src/lib/types.ts` and `frontend/lib/api.ts`.
4. **New environment variable:** add it to the Environment Variables table in this file and to the relevant
   `.env.example` (create one if it doesn't exist).
5. **Python model change:** retrain preserving `SEQ_LEN = 5`, `input_dim = 30`, and feature order
   `[pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]`. Refit `anomalie.pkl` on
   training data only. Save new `.pt` and `.pkl` files to `notebooks/` and update the model path constants
   in the corresponding FastAPI `main.py`.
6. **Registering a new sensor:** generate a random 32-byte hex secret. Encrypt it with `MASTER_KEY` using
   AES-256. Insert a `Sensor` document in MongoDB: `{ id: <uuid>, name, location, encryptedSecretKey, active: true }`.
   Add the plaintext key to `sensorServer/.env` as `LOCATION_<X>_SENSOR_<N>_SECRET_KEY`. Restart both
   `sensorServer` and `backend` to pick up the new key — the `sensorLocation` map is rebuilt from MongoDB
   on every backend startup.
7. **Changing timing constants:** `BUCKET_DEADLINE_MS` must always satisfy
   `TICK_INTERVAL_MS < BUCKET_DEADLINE_MS < 2 × TICK_INTERVAL_MS`. `MAX_DRIFT_MS` must always satisfy
   `MAX_DRIFT_MS ≤ TICK_INTERVAL_MS / 2`. Violating these invariants causes readings to round into wrong
   buckets or deadlines to fire before all sensors have had a chance to report.

---

## Miscellaneous Notes

- **`frontend/lib/mock-data.ts`:** contains legacy helpers `generateMockData()` and `generateMockAttacks()`
  that were used during early development. They are not imported by `app/page.tsx` or any other active
  component. Do not delete — they can be useful for local UI testing — but do not add new dependencies on them.

- **`@vercel/analytics`:** installed as a production dependency and integrated via `<Analytics />` in
  `frontend/app/layout.tsx`. It is a zero-config, passive analytics collector. No changes are needed unless
  the deployment target changes from Vercel.

- **`http-proxy-middleware`:** listed in `backend/package.json` dependencies but not imported anywhere in
  `backend/src/`. It can be removed if it is confirmed to be unneeded, or left as-is until a proxying use
  case arises.
