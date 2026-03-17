# EcoShield AI

**Smart City Cybersecurity & Energy Optimization Platform**

> Real-time False Data Injection (FDI) attack detection and pump power optimization for smart water infrastructure.

Built for the **AI Night Challenge** hackathon.

---

## Overview

EcoShield AI addresses a dual challenge facing modern smart cities:

### Green Challenge (Ecological)
Design an AI system capable of optimizing water pump energy consumption based on sensor data, targeting energy savings while maintaining service quality.

### Cyber Challenge (Security)
Develop an AI "guardian" able to detect corrupted data (FDI attacks) in real-time and neutralize their impact on decision-making, preserving infrastructure safety and citizen trust.

**Why both?** Most existing solutions focus on *either* energy optimization *or* attack detection—rarely both within the same operational system. EcoShield AI combines these dimensions into a single, holistic architecture where environmental performance doesn't come at the expense of security.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      SENSOR SERVER (×2 locations)                            │
│         Physics Simulation • FDI Injection • JWT Signing • AMQP Publisher    │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                         RabbitMQ  (sensor.events exchange)
                         10 messages/tick — routing key sensor.<uuid>
                                      │
┌──────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Express.js)                               │
│   JWT Verification • Redis Bucket Buffer • ML Inference • SSE Emitter        │
└──────────────────────────────────────────────────────────────────────────────┘
          │                         │                         │
     HTTP POST                   Buffer                   Storage
          │                         │                         │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐
│  Detection API  │    │      Redis      │    │        MongoDB          │
│  (FastAPI/LSTM) │    │  Sliding Window │    │   Flagged Anomalies     │
├─────────────────┤    └─────────────────┘    └─────────────────────────┘
│  Optimizer API  │                 │
│  (FastAPI/LSTM) │      REST API + SSE (Server-Sent Events)
└─────────────────┘                │
                    ┌──────────────────────────────────┐
                    │         FRONTEND (Next.js)        │
                    │  Dashboard • Location Toggle •    │
                    │  Live Chart • Alerts • Attack Log │
                    └──────────────────────────────────┘
```

### Four-Layer Design

| Layer | Description |
|-------|-------------|
| **Sensing & Ingestion** | Separate `sensorServer` process publishes 10 JWT-signed readings per tick (5 per location) to RabbitMQ; backend verifies each JWT before processing |
| **Data Processing** | Redis bucket buffer aggregates readings per location into 5-frame windows, computes pressure statistics; missing sensors imputed from last-known values |
| **AI Core** | Parallel LSTM models for anomaly detection (classifier) and pump optimization (regressor) |
| **Visualization** | Real-time dashboard with SSE streaming, location toggle (A/B), alert banners, and paginated attack logs |

---

## Features

- **Real-time Monitoring**: Live area chart comparing actual vs. optimized pump power (kW)
- **Multi-Location Monitoring**: Independent dashboards for Location A and Location B with a chart toggle
- **FDI Attack Detection**: LSTM classifier identifies anomalies with 90% confidence threshold
- **Energy Optimization**: LSTM regressor predicts optimal pump power settings
- **Sensor Authentication**: Every sensor message is JWT-signed (HS256, 1-minute TTL); invalid or expired tokens are rejected before processing
- **Attack Simulation**: Built-in FDI injection (~8% probability per tick) for demo purposes
- **Alert System**: Visual banner notification when anomaly detected
- **Attack Log**: Paginated history of all flagged events stored in MongoDB
- **Physics Simulation**: Realistic water network behavior with:
  - Demand profiles (morning/evening peaks)
  - Temperature daily cycles
  - Reservoir level tracking
  - Sensor noise and biases

---

## Tech Stack

| Component | Technologies |
|-----------|-------------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS, Recharts, Radix UI |
| **Backend** | Express.js 5, TypeScript, ioredis, Mongoose, jsonwebtoken |
| **Sensor Server** | Node.js, TypeScript, amqplib, jsonwebtoken |
| **Message Broker** | RabbitMQ 3 (AMQP topic exchange, management UI on port 15672) |
| **ML Models** | PyTorch, FastAPI, LSTM Networks, scikit-learn |
| **Databases** | MongoDB 8, Redis 7 |
| **Infrastructure** | Docker Compose |

---

## Project Structure

```
ecoShield/
├── frontend/                   # Next.js dashboard (location A/B toggle)
│   ├── app/                    # App router pages
│   ├── components/
│   │   └── dashboard/          # Chart, Navbar, AlertBanner, AttackLog
│   ├── lib/
│   │   └── api.ts              # REST + SSE client, type definitions
│   └── package.json
│
├── backend/                    # Express.js API + RabbitMQ consumer + SSE server
│   ├── src/
│   │   ├── index.ts            # Server entry point
│   │   ├── routes/
│   │   │   ├── events.ts       # SSE endpoint
│   │   │   └── detections.ts   # Flagged events REST API
│   │   └── lib/
│   │       ├── pipeline.ts     # JWT auth, Redis bucket buffer, ML calls, SSE emit
│   │       ├── types.ts        # TypeScript definitions
│   │       ├── redis.ts        # Redis client singleton
│   │       ├── mongo.ts        # MongoDB connection
│   │       ├── emitter.ts      # Node.js EventEmitter (SSE bus)
│   │       └── models/
│   │           ├── flaggedEvent.ts
│   │           └── sensor.ts   # Sensor registry (AES-256 encrypted keys)
│   ├── scripts/
│   │   ├── seedSensors.ts      # One-time: encrypt + upsert 10 sensor docs
│   │   └── clearDetections.ts  # Utility: wipe all flagged events
│   ├── docker-compose.yml      # MongoDB + Redis + RabbitMQ
│   └── package.json
│
├── sensorServer/               # RabbitMQ producer — physics simulation + FDI injection
│   ├── src/
│   │   ├── index.ts            # Tick loop, JWT signing, AMQP publisher (10 sensors)
│   │   ├── physics.ts          # Physics engine (demand profiles, EMA, FDI injection)
│   │   └── types.ts            # sensorData type
│   └── package.json
│
├── detectionModel/             # FDI anomaly detection service
│   ├── main.py                 # FastAPI + LSTM classifier (threshold 0.9)
│   └── requirements.txt
│
├── optimizerModel/             # Pump power optimization service
│   ├── main.py                 # FastAPI + LSTM regressor
│   └── requirements.txt
│
├── notebooks/                  # Jupyter notebooks + trained models + scalers + dataset
│   ├── anomalie_detection.ipynb
│   ├── pump_power_optimized_model.ipynb
│   ├── data_generator.ipynb
│   ├── lstm_anomaly_early_stopping.pt    # Trained detection model
│   ├── lstm_optimizer.pt                  # Trained optimizer model
│   ├── anomalie.pkl                       # Shared feature scaler (detection + optimizer)
│   ├── optim.pkl                          # Output scaler (optimizer only)
│   └── smart_water_minimal_physics_with_sensor_id.csv
│
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **Docker** & Docker Compose
- **pnpm** (frontend package manager)
- **npm** (backend and sensorServer package manager)

### 1. Clone the Repository

```bash
git clone https://github.com/medjmalami/ecoShield.git
cd ecoShield
```

### 2. Start Infrastructure (MongoDB + Redis + RabbitMQ)

```bash
cd backend
docker compose up -d
```

This starts:
- MongoDB on port `27017`
- Redis on port `6379`
- RabbitMQ on port `5672` (management UI at `http://localhost:15672`, default credentials: `guest` / `guest`)

### 3. Configure Environment Variables

Create the required `.env` files before starting any service (see [Environment Variables](#environment-variables) below).

### 4. Seed the Sensor Registry (one-time)

After configuring `MASTER_KEY` and `MONGO_URI` in `backend/.env`, run:

```bash
cd backend
npx ts-node scripts/seedSensors.ts
```

This encrypts each sensor secret key and upserts 10 `Sensor` documents into MongoDB. Only needs to be run once (or after rotating sensor keys).

### 5. Start the Detection Model API

```bash
cd detectionModel
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

### 6. Start the Optimizer Model API

```bash
cd optimizerModel
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8002
```

### 7. Start the Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs on `http://localhost:3001`

### 8. Start the Sensor Server

```bash
cd sensorServer
npm install
npm run dev
```

The sensor server begins publishing 10 sensor readings per tick (5 for Location A, 5 for Location B) to RabbitMQ every 5 seconds.

### 9. Start the Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Frontend runs on `http://localhost:3000`

### Environment Variables

**`backend/.env`**:
```env
PORT=3001
RABBITMQ_URI=amqp://guest:guest@localhost:5672
MONGO_URI=mongodb://admin:secret@localhost:27017/ecoshield?authSource=admin
MONGO_ROOT_USER=admin
MONGO_ROOT_PASSWORD=secret
MONGO_DB=ecoshield
REDIS_URI=redis://localhost:6379
MASTER_KEY=<32-byte hex string>
DETECTION_API_URL=http://localhost:8001
OPTIMIZER_API_URL=http://localhost:8002
BUCKET_DEADLINE_MS=8000
```

> `MASTER_KEY` is the AES-256 key used to encrypt sensor secret keys in MongoDB. Generate one with: `openssl rand -hex 32`

**`sensorServer/.env`**:
```env
RABBITMQ_URI=amqp://guest:guest@localhost:5672
TICK_INTERVAL_MS=5000
MAX_DRIFT_MS=2500
LOCATION_A_SENSOR_1_SECRET_KEY=<secret>
LOCATION_A_SENSOR_2_SECRET_KEY=<secret>
LOCATION_A_SENSOR_3_SECRET_KEY=<secret>
LOCATION_A_SENSOR_4_SECRET_KEY=<secret>
LOCATION_A_SENSOR_5_SECRET_KEY=<secret>
LOCATION_B_SENSOR_6_SECRET_KEY=<secret>
LOCATION_B_SENSOR_7_SECRET_KEY=<secret>
LOCATION_B_SENSOR_8_SECRET_KEY=<secret>
LOCATION_B_SENSOR_9_SECRET_KEY=<secret>
LOCATION_B_SENSOR_10_SECRET_KEY=<secret>
```

> Each `*_SECRET_KEY` is the plaintext shared secret used to sign JWTs for that sensor. These must match the values encrypted and stored in MongoDB via `seedSensors.ts`.

**`frontend/.env.local`**:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## API Reference

### Backend Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/events` | SSE stream for real-time pipeline events |
| `GET` | `/detections?page=1&limit=10&location=locationA` | Paginated list of flagged anomalies (optional location filter) |

### ML Model Endpoints

| Service | Method | Endpoint | Input | Output |
|---------|--------|----------|-------|--------|
| Detection | `POST` | `/predict` | `(5, 30)` array | `{ anomaly_detected: boolean }` |
| Optimizer | `POST` | `/predict` | `(5, 30)` array | `{ pump_power_optimized: number }` |

**Input Shape**: 5 time frames × 30 features (5 sensors × 6 features each)

**Features per sensor**: `pressure`, `flow_rate`, `temperature`, `pump_power`, `pressure_mean`, `pressure_var`

---

## ML Models

### Detection Model (LSTM Classifier)

Detects False Data Injection attacks by learning normal sensor behavior patterns.

- **Architecture**: LSTM (input_dim=30, hidden_size=64, num_layers=1)
- **Training**: Binary cross-entropy with early stopping
- **Threshold**: Probability ≥ 0.9 triggers anomaly flag
- **Output**: `anomaly_detected: true/false`

### Optimizer Model (LSTM Regressor)

Predicts optimal pump power to minimize energy consumption while maintaining pressure.

- **Architecture**: LSTM (input_dim=30, hidden_size=128, num_layers=2)
- **Training**: MSE loss, 12 epochs
- **Metrics**: R² = 0.51, MAE = 7.77 kW
- **Output**: `pump_power_optimized` in kW

---

## How It Works

### Data Pipeline (every ~5 seconds)

1. **Publish**: `sensorServer` physics engine generates 10 sensor readings per tick (5 for Location A, 5 for Location B), signs each with a per-sensor HS256 JWT, and publishes to the RabbitMQ `sensor.events` topic exchange
2. **Authenticate**: Backend verifies the JWT on every incoming message; expired or invalid tokens are rejected with `nack` (no requeue)
3. **Inject**: ~8% chance per tick of FDI attack (pressure, pump_power, or flow_rate) — injected by `sensorServer` before publishing
4. **Buffer**: Valid readings stored in a per-location Redis time-bucket keyed to the nearest tick boundary
5. **Aggregate**: Once all 5 sensors in a location report (or the deadline fires), the pipeline builds a `(5, 30)` feature matrix; missing sensors are imputed from their last-known Redis value
6. **Predict**: Detection and optimizer models are called in parallel via `Promise.all`
7. **Store**: If an anomaly is detected, the full sensor window is saved to MongoDB
8. **Broadcast**: A `PipelineEvent` is emitted via SSE to all connected frontend clients
9. **Visualize**: Frontend updates the correct location's chart and attack log in real-time

### FDI Attack Types

| Type | Target | Effect |
|------|--------|--------|
| Pressure | Single sensor (0–4) | Injects a random pressure value on one sensor |
| Pump Power | All sensors in location | Overrides pump power reading across the location |
| Flow Rate | All sensors in location | Falsifies flow rate data across the location |

---

## Future Improvements

- [x] ~~**Multi-network support**~~: Location A and Location B are now independently monitored *(implemented)*
- [ ] **Historical analytics**: Time-series dashboards with trend analysis
- [ ] **Attack classification**: Identify specific attack types, not just detect
- [ ] **Alerting integrations**: Email/SMS/Slack notifications
- [ ] **Real sensor integration**: MQTT/Kafka ingestion from actual IoT devices
- [ ] **Model retraining**: Online learning to adapt to evolving attack patterns
- [ ] **Authentication**: User login and role-based access control
- [ ] **Explainability**: SHAP/LIME for understanding model decisions
- [ ] **Containerization**: Full Docker setup with all services

---

## License

This project was developed for the **AI Night Challenge** hackathon.

---

## Acknowledgments

- **AI Night Challenge** organizers
- Research papers on FDI attacks in smart water systems:
  - Addeen et al., "A Survey of Cyber-Physical Attacks and Detection Methods in Smart Water Distribution Systems" (IEEE Access, 2021)
  - Moazeni & Khazaei, "Sequential false data injection cyberattacks in water distribution systems" (Sustainable Cities and Society, 2021)
  - Giannubilo et al., "A Deep Learning Approach for False Data Injection Attacks Detection in Smart Water Infrastructure" (ITASEC & SERICS 2025)

---

**Built with care for smarter, greener, safer cities.**
