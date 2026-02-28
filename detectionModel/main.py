import random
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="EcoShield Detection Model")


# ── Pydantic schemas (mirror of backend/src/lib/types.ts) ────────────────────

# sensorDataBatch — mirrors types.ts sensorDataBatch
class SensorDataBatch(BaseModel):
    id: str
    timestamp: str
    pressure: float
    flow_rate: float
    temperature: float
    pump_power: float
    time_of_day: str
    day_of_week: str
    month: str
    pressure_mean: float
    pressure_var: float


# detectionOutput — mirrors types.ts detectionOutput
class DetectionOutput(BaseModel):
    anomaly_detected: bool


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict", response_model=DetectionOutput)
def predict(payload: list[list[SensorDataBatch]]) -> DetectionOutput:
    """
    Mock FDI anomaly detection.
    Accepts detectionInput: a 5x5 array of SensorDataBatch (5 sensorGroups,
    each group being 5 readings). Returns a weighted-random result:
    ~10% chance of anomaly detected (True), ~90% normal (False).
    """
    if len(payload) != 5 or any(len(group) != 5 for group in payload):
        raise HTTPException(
            status_code=422,
            detail="Expected exactly 5 sensorGroups each with 5 SensorDataBatch readings",
        )

    anomaly = random.random() < 0.50  # 10% attack rate
    return DetectionOutput(anomaly_detected=anomaly)
