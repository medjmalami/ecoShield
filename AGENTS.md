# EcoShield AI — Agent Guidelines

## Repository Layout

```
ecoShield/
├── frontend/        # Next.js 16 dashboard (React 19, TypeScript, Tailwind CSS v4, shadcn/ui)
├── backend/         # Express.js 5 API server (TypeScript, SSE, physics simulation)
├── detectionModel/  # FastAPI microservice — LSTM anomaly/FDI classifier (Python)
├── optimizerModel/  # FastAPI microservice — LSTM pump-power regressor (Python)
└── notebooks/       # Jupyter notebooks, trained .pt models, .pkl scalers, CSV dataset
```

There is no root-level `package.json`. `frontend/` and `backend/` are independent Node.js projects. No shared workspace tooling (no Turborepo, no Nx, no `pnpm-workspace.yaml`).

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
docker compose up -d    # Start MongoDB 8 + Redis 7
docker compose down     # Stop containers
```

### Testing

**No test framework is currently configured** in any package. There are no test files and no `test` script in any `package.json`. To add testing:
- Frontend/Backend: install Vitest (`pnpm add -D vitest` / `npm i -D vitest`) and add a `"test": "vitest"` script
- Python: install pytest (`pip install pytest`) and run `pytest` from the service directory
- To run a single test file with Vitest: `vitest run src/lib/pipeline.test.ts`
- To run a single pytest test: `pytest detectionModel/test_main.py::test_predict -v`

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
import "./lib/mongo";                      // side-effect / singleton init
import { runPipeline } from "./lib/pipeline";
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
| Module-level constants | SCREAMING_SNAKE_CASE | `MAX_CHART_POINTS`, `BUFFER_SIZE`, `REDIS_KEY` |
| Regular variables and functions | camelCase | `runPipeline`, `buildSensorGroups`, `callOptimizer` |
| Mongoose models | PascalCase | `FlaggedEvent` |
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

- Always prefix log messages with a bracketed service/module tag: `[pipeline]`, `[mongo]`, `[redis]`, `[detections]`, `[page]`, `[detection]`, `[optimizer]`.
- Backend route handlers: catch errors, log with `console.error("[route] error:", err?.message ?? err)`, and respond with `res.status(500).json({ error: "Internal server error" })`.
- Frontend async callbacks: catch errors and log; update loading/error state so the UI reflects failure.
- Python: raise `HTTPException` for invalid client input (status 422); raise `RuntimeError` on startup failures (model load, scaler load).

---

## Architecture Notes

These are load-bearing design decisions — do not change without understanding the implications.

- **Physics simulation state** lives as mutable module-level `let` variables in `backend/src/lib/pipeline.ts`. This is an intentional stateful singleton; do not refactor to a class or database without careful thought.
- **Redis sliding window:** readings are `RPUSH`ed to the `sensor:buffer` key. The pipeline only runs when ≥ 25 readings are buffered, then `LTRIM`s the oldest 5 to slide the window. Keep `BUFFER_SIZE = 25` and `GROUP_SIZE = 5` in sync with model input expectations.
- **Shared model input shape:** both LSTM models accept exactly `(5 frames × 30 floats)`. The `buildModelPayload()` function constructs this for both. Any model retrain must preserve this shape.
- **Parallel ML inference:** detection and optimizer are called via `Promise.all()` — do not make them sequential.
- **SSE transport:** the backend emits `PipelineEvent` objects via Node.js `EventEmitter` (`pipelineEmitter`). SSE route handlers attach/detach listeners on connect/disconnect. Do not replace this with WebSockets without updating both sides.
- **No shared code:** types are intentionally duplicated between `frontend/lib/api.ts` and `backend/src/lib/types.ts`. Keep them in sync manually when changing the data shape.
- **FDI attack simulation:** the backend has an 8 % per-tick probability of injecting a False Data Injection attack. This is intentional for demo purposes.
- **`sys.modules["__main__"]` hack (Python):** both FastAPI services register their model class on `sys.modules["__main__"]` so `torch.load()` works under uvicorn. Do not remove this.

---

## Adding New Features — Checklist

1. **New backend route:** create a file in `backend/src/routes/`, export a default `Router`, and `app.use(...)` it in `backend/src/index.ts`.
2. **New frontend component:** place it in `frontend/components/` using a kebab-case filename; add `'use client'` if it uses hooks.
3. **New shared data shape:** update both `backend/src/lib/types.ts` and `frontend/lib/api.ts`.
4. **New environment variable:** document it in the README and add it to the relevant `.env.example` (create one if it doesn't exist).
5. **Python model change:** retrain preserving `(5, 30)` input shape, save new `.pt` and `.pkl` files to `notebooks/`, and update the model path constants in the corresponding FastAPI `main.py`.
