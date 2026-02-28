import random
from fastapi import FastAPI, HTTPException

app = FastAPI(title="EcoShield Detection Model")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(payload: list[list[float]]) -> dict:
    """
    Mock FDI anomaly detection.
    Accepts detectionInput: shape (5, 30) — 5 frames × 30 floats.
    Each row = 5 sensors (sorted by id) × 6 features:
    [pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]

    Returns a weighted-random result: ~50% chance of anomaly detected.
    """
    if len(payload) != 5:
        raise HTTPException(
            status_code=422,
            detail=f"Expected 5 frames, got {len(payload)}",
        )
    for i, row in enumerate(payload):
        if len(row) != 30:
            raise HTTPException(
                status_code=422,
                detail=f"Frame {i}: expected 30 floats (5 sensors × 6 features), got {len(row)}",
            )

    anomaly = random.random() < 0.50
    return {"anomaly_detected": anomaly}
