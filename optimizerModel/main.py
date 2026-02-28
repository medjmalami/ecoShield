import random
from fastapi import FastAPI, HTTPException

app = FastAPI(title="EcoShield Optimizer Model")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(payload: list[list[float]]) -> dict:
    """
    Mock pump power optimizer.
    Accepts optimizerInput: shape (5, 30) — 5 frames × 30 floats.
    Each row = 5 sensors (sorted by id) × 6 features:
    [pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]

    Returns a realistic random optimized pump power value —
    Gaussian(mu=40, sigma=15) clamped to [5.0, 100.0] kW.
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

    optimized = random.gauss(mu=40.0, sigma=15.0)
    optimized = round(max(5.0, min(100.0, optimized)), 2)
    return {"pump_power_optimized": optimized}
