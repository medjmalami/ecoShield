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

**sensorServer is a single process.** It maintains one shared physics state for all 5 sensors (pressure, flow rate, pump power, reservoir level are physically coupled). Per tick it publishes 5 separate AMQP messages — one per sensor — each with an individually jittered timestamp and its own JWT. This mimics 5 independent sensors on the wire without breaking physics coupling.

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

### SensorServer (`sensorServer/` — npm)

```bash
npm run dev     # Start the sensor publisher (single process, publishes 5 messages per tick)
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
| `SENSOR_1_SECRET_KEY` | Yes | — | Plaintext shared secret for sensor 1. Used to sign the JWT on every message for sensor 1 |
| `SENSOR_2_SECRET_KEY` | Yes | — | Plaintext shared secret for sensor 2 |
| `SENSOR_3_SECRET_KEY` | Yes | — | Plaintext shared secret for sensor 3 |
| `SENSOR_4_SECRET_KEY` | Yes | — | Plaintext shared secret for sensor 4 |
| `SENSOR_5_SECRET_KEY` | Yes | — | Plaintext shared secret for sensor 5 |

### `backend/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | Express server port |
| `RABBITMQ_URI` | No | `amqp://guest:guest@localhost:5672` | AMQP broker URI |
| `MONGO_URI` | Yes | — | MongoDB connection string |
| `REDIS_URI` | No | `redis://localhost:6379` | Redis connection string |
| `MASTER_KEY` | Yes | — | 32-byte hex string. AES-256 master key used to encrypt/decrypt sensor secret keys stored in MongoDB. Never stored in the DB. |
| `DETECTION_API_URL` | No | `http://localhost:8001` | FastAPI detection service URL |
| `OPTIMIZER_API_URL` | No | `http://localhost:8002` | FastAPI optimizer service URL |
| `BUCKET_DEADLINE_MS` | No | `8000` | How long to wait for stragglers before closing a time bucket. Must be > `TICK_INTERVAL_MS` and < `2 × TICK_INTERVAL_MS` |

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

- **Physics simulation state** lives as mutable module-level `let` variables in `sensorServer/src/physics.ts`.
  All 5 sensors share this state because they are physically coupled — pressure, flow rate, pump power, and
  reservoir level are interdependent. Do not split this into per-sensor state or move it to a database.
  `generateSensorData()` still returns all 5 readings per call; the caller publishes them as 5 separate
  messages with individual timestamp jitter applied after generation.

- **FDI attack simulation:** `sensorServer/src/physics.ts` has an 8% per-tick probability of injecting a
  False Data Injection attack (types: `pressure`, `pump_power`, `flow_rate`; duration: 1–3 ticks). This is
  intentional for demo purposes. Attack state is shared across all sensors in the same process.

- **RabbitMQ topology:** `sensorServer` publishes to a durable topic exchange named `sensor.events`. Each
  sensor reading is published with routing key `sensor.<id>` (e.g. `sensor.1`, `sensor.3`). The backend
  binds queue `sensor.readings` to this exchange with binding pattern `sensor.*`. Both producer and consumer
  assert the exchange as `type: "topic"` and `durable: true` on startup. Never publish directly to the queue
  by name — always go through the exchange.

- **Sensor authentication (JWT HS256):** every AMQP message carries a short-lived JWT in the message header
  `x-token`. The JWT is signed with that sensor's individual `SENSOR_<N>_SECRET_KEY` using HS256, contains
  `{ sensorId: string }`, and has a 1-minute TTL (`expiresIn: "1m"`). A fresh token is generated on every
  publish — tokens are never reused. The backend verifies the token on every message before any processing.
  Expired or invalid tokens result in `nack` (no requeue) and a warning log. A compromised key for one
  sensor does not affect the other four.

- **Sensor secret key storage:** each sensor's `SENSOR_<N>_SECRET_KEY` is stored AES-256 encrypted in its
  `Sensor` MongoDB document (`encryptedSecretKey` field). The `MASTER_KEY` in `backend/.env` is the sole
  decryption key — it never touches the database. At `startConsumer()` the backend loads all `Sensor`
  documents, decrypts each key in memory, and caches the results for the lifetime of the process. Rotate a
  sensor key by generating a new secret, updating `encryptedSecretKey` in MongoDB and
  `SENSOR_<N>_SECRET_KEY` in `sensorServer/.env`, then restarting both services.

- **Sensor registry:** a `Sensor` Mongoose model (`backend/src/lib/models/sensor.ts`) stores
  `{ id, name, location, encryptedSecretKey, active, registeredAt }`. Exposed read-only via `GET /sensors`
  — the response always strips `encryptedSecretKey`. The in-memory cache built at startup is the auth source
  of truth during runtime; the DB is not queried per message.

- **Timestamp drift simulation:** `sensorServer` applies an independent random jitter of ±`MAX_DRIFT_MS` to
  each sensor's timestamp before publishing. All 5 readings in a tick share the same underlying physics
  timestamp but each carries a different wire timestamp. `MAX_DRIFT_MS` defaults to 2500ms and must not
  exceed `TICK_INTERVAL_MS / 2` — exceeding this means a drifted reading could round into the wrong bucket.

- **Redis bucket buffer:** incoming sensor readings are grouped into time buckets. The incoming timestamp is
  rounded to the nearest `TICK_INTERVAL_MS` boundary:
  `Math.round(ts / TICK_INTERVAL_MS) * TICK_INTERVAL_MS`. Three Redis structures are used:
  - `sensor:tick:<rounded-ts>` — Redis Hash `{ sensorId → sensorData json }`. TTL = `BUCKET_DEADLINE_MS × 2`
    (auto-cleans incomplete buckets without any application-level cleanup code).
  - `sensor:ticks:complete` — Redis Sorted Set of closed bucket timestamps (score = epoch ms). A bucket is
    added here when it either reaches 5 sensors naturally or its deadline fires with imputation applied.
  - `sensor:last:<id>` — Redis String holding the most recent valid reading per sensor. Updated on every
    successfully authenticated message regardless of bucket state. Used for last-known-value imputation.

- **Bucket deadline and imputation:** when the first reading for a bucket arrives, a `setTimeout` of
  `BUCKET_DEADLINE_MS` is registered in the `deadlineTimers: Map<string, NodeJS.Timeout>` in `pipeline.ts`.
  If all 5 sensors report before the deadline, the timer is cancelled and the bucket is immediately closed.
  If the deadline fires with fewer than 5 sensors: each missing sensor is substituted with its
  `sensor:last:<id>` value. `pressure_mean` and `pressure_var` are computed from only the sensors that
  actually reported real readings — not from imputed values — then assigned to all sensors in the bucket
  including imputed ones. If a sensor has no last-known value (it has never reported since backend startup),
  the bucket is dropped entirely and a warning is logged — the pipeline does not run for that window.
  Imputation uses real physics readings from the previous tick, not zeros or synthetic values, so the model
  input shape `(5, 30)` is always preserved.

- **Pipeline trigger:** the pipeline fires when `sensor:ticks:complete` contains ≥ 5 members. It reads the
  5 oldest complete bucket timestamps from the sorted set, fetches their hash data from Redis, reconstructs
  the `(5 frames × 30 floats)` payload via `buildModelPayload()` (sensors sorted by id ascending, 6 features
  each: `pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var`), then removes the oldest
  entry from the sorted set to slide the window. `BUFFER_SIZE = 5` complete buckets, `SENSOR_COUNT = 5`
  sensors per bucket, total model input = 25 readings.

- **Shared model input shape:** both LSTM models accept exactly `(5 frames × 30 floats)`. The
  `buildModelPayload()` function constructs this. Any model retrain must preserve `SEQ_LEN = 5`,
  `input_dim = 30`, and feature order: `[pressure, flow_rate, temperature, pump_power, pressure_mean,
  pressure_var]` per sensor.

- **Parallel ML inference:** detection and optimizer are called via `Promise.all()` — do not make them
  sequential.

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
   AES-256. Insert a `Sensor` document in MongoDB: `{ id, name, location, encryptedSecretKey, active: true }`.
   Add the plaintext key to `sensorServer/.env` as `SENSOR_<N>_SECRET_KEY`. Restart both `sensorServer` and
   `backend` to pick up the new key.
7. **Changing timing constants:** `BUCKET_DEADLINE_MS` must always satisfy
   `TICK_INTERVAL_MS < BUCKET_DEADLINE_MS < 2 × TICK_INTERVAL_MS`. `MAX_DRIFT_MS` must always satisfy
   `MAX_DRIFT_MS ≤ TICK_INTERVAL_MS / 2`. Violating these invariants causes readings to round into wrong
   buckets or deadlines to fire before all sensors have had a chance to report.
