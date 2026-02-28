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
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                              │
│         Real-time Dashboard • Charts • Alerts • Attack Log              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          REST API + SSE (Server-Sent Events)
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Express.js)                            │
│     Physics Simulation • Data Pipeline • FDI Injection • SSE Emitter    │
└─────────────────────────────────────────────────────────────────────────┘
          │                         │                         │
     HTTP POST                   Buffer                   Storage
          │                         │                         │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐
│  Detection API  │    │      Redis      │    │        MongoDB          │
│  (FastAPI/LSTM) │    │  Sliding Window │    │   Flagged Anomalies     │
├─────────────────┤    └─────────────────┘    └─────────────────────────┘
│  Optimizer API  │
│  (FastAPI/LSTM) │
└─────────────────┘
```

### Four-Layer Design

| Layer | Description |
|-------|-------------|
| **Sensing & Ingestion** | Physics-based sensor simulation (5 pressure sensors per tick) with realistic demand profiles |
| **Data Processing** | Redis buffer aggregates readings into 5-frame windows, computes pressure statistics |
| **AI Core** | Parallel LSTM models for anomaly detection (classifier) and pump optimization (regressor) |
| **Visualization** | Real-time dashboard with SSE streaming, alert banners, and paginated attack logs |

---

## Features

- **Real-time Monitoring**: Live area chart comparing actual vs. optimized pump power (kW)
- **FDI Attack Detection**: LSTM classifier identifies anomalies with 90% confidence threshold
- **Energy Optimization**: LSTM regressor predicts optimal pump power settings
- **Attack Simulation**: Built-in FDI injection (~8% probability) for demo purposes
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
| **Backend** | Express.js 5, TypeScript, ioredis, Mongoose |
| **ML Models** | PyTorch, FastAPI, LSTM Networks, scikit-learn |
| **Databases** | MongoDB 8, Redis 7 |
| **Infrastructure** | Docker Compose |

---

## Project Structure

```
ecoShield/
├── frontend/                   # Next.js dashboard
│   ├── app/                    # App router pages
│   ├── components/
│   │   └── dashboard/          # Chart, Navbar, AlertBanner, AttackLog
│   ├── lib/
│   │   └── api.ts              # REST + SSE client
│   └── package.json
│
├── backend/                    # Express.js API server
│   ├── src/
│   │   ├── index.ts            # Server entry point
│   │   ├── routes/
│   │   │   ├── events.ts       # SSE endpoint
│   │   │   └── detections.ts   # Flagged events API
│   │   └── lib/
│   │       ├── pipeline.ts     # Core data pipeline + physics sim
│   │       ├── types.ts        # TypeScript definitions
│   │       ├── redis.ts        # Redis client
│   │       ├── mongo.ts        # MongoDB connection
│   │       └── models/
│   │           └── flaggedEvent.ts
│   ├── docker-compose.yml      # MongoDB + Redis
│   └── package.json
│
├── detectionModel/             # FDI anomaly detection service
│   ├── main.py                 # FastAPI server with LSTM classifier
│   └── requirements.txt
│
├── optimizerModel/             # Pump power optimization service
│   ├── main.py                 # FastAPI server with LSTM regressor
│   └── requirements.txt
│
├── notebooks/                  # Jupyter notebooks + trained models
│   ├── anomalie_detection.ipynb
│   ├── pump_power_optimized_model.ipynb
│   ├── data_generator.ipynb
│   ├── lstm_anomaly_early_stopping.pt    # Trained detection model
│   ├── lstm_optimizer.pt                  # Trained optimizer model
│   ├── anomalie.pkl                       # Feature scaler
│   ├── optim.pkl                          # Output scaler
│   └── smart_water_minimal_physics_with_sensor_id.csv
│
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ (or Bun)
- **Python** 3.11+
- **Docker** & Docker Compose
- **pnpm** (recommended) or npm

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/ecoShield.git
cd ecoShield
```

### 2. Start Infrastructure (MongoDB + Redis)

```bash
cd backend
docker-compose up -d
```

This starts:
- MongoDB on port `27017`
- Redis on port `6379`

### 3. Start the Detection Model API

```bash
cd detectionModel
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

### 4. Start the Optimizer Model API

```bash
cd optimizerModel
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8002
```

### 5. Start the Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs on `http://localhost:3001`

### 6. Start the Frontend

```bash
cd frontend
pnpm install  # or: npm install
pnpm dev      # or: npm run dev
```

Frontend runs on `http://localhost:3000`

### Environment Variables

**Backend** (`backend/.env`):
```env
PORT=3001
DETECTION_API_URL=http://localhost:8001
OPTIMIZER_API_URL=http://localhost:8002
MONGO_ROOT_USER=admin
MONGO_ROOT_PASSWORD=secret
MONGO_DB=ecoshield
MONGO_URI=mongodb://admin:secret@localhost:27017/ecoshield?authSource=admin
REDIS_URI=redis://localhost:6379
```

**Frontend** (`frontend/.env.local`):
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
| `GET` | `/detections?page=1&limit=10` | Paginated list of flagged anomalies |

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

### Data Pipeline (every 5 seconds)

1. **Generate**: Physics engine creates 5 sensor readings with realistic behavior
2. **Inject**: ~8% chance of FDI attack (pressure, pump_power, or flow_rate)
3. **Buffer**: Push readings to Redis sliding window
4. **Aggregate**: Once 25 readings accumulated, build (5, 30) feature matrix
5. **Predict**: Call both ML models in parallel
6. **Store**: If anomaly detected, save full window to MongoDB
7. **Broadcast**: Emit results via SSE to all connected clients
8. **Visualize**: Frontend updates chart and attack log in real-time

### FDI Attack Types

| Type | Target | Effect |
|------|--------|--------|
| Pressure | Single sensor (0-4) | Injects random pressure value |
| Pump Power | All sensors | Overrides pump power reading |
| Flow Rate | All sensors | Falsifies flow rate data |

---

## Future Improvements

- [ ] **Multi-network support**: Monitor multiple water districts simultaneously
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
