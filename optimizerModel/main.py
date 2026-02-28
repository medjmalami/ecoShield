import joblib
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pathlib import Path

app = FastAPI(title="EcoShield Optimizer Model")

# ── Load model and scaler at startup ─────────────────────────────────────────

BASE_DIR = Path(__file__).parent
NOTEBOOKS_DIR = BASE_DIR.parent / "notebooks"

try:
    model = torch.load(
        NOTEBOOKS_DIR / "lstm_optimizer.pt",
        map_location="cpu",
        weights_only=False,
    )
    model.eval()
    print("[optimizer] model loaded successfully")
except Exception as e:
    raise RuntimeError(f"[optimizer] failed to load model: {e}")

try:
    y_scaler = joblib.load(NOTEBOOKS_DIR / "optim.pkl")
    print("[optimizer] scaler loaded successfully")
except Exception as e:
    raise RuntimeError(f"[optimizer] failed to load scaler: {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(payload: list[list[float]]) -> dict:
    """
    Real LSTM pump power optimizer (LSTMRegressor2).
    Accepts shape (5, 30) — 5 frames × 30 floats.
    Each row = 5 sensors (sorted by id) × 6 features:
    [pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]

    Returns the predicted optimized pump power in kW.
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

    # shape: (1, 5, 30) — batch of 1
    x = torch.tensor([payload], dtype=torch.float32)

    with torch.no_grad():
        raw = model(x)                          # (1,) — normalized output
        raw_val = raw.item()

    # Inverse-transform from normalized space back to kW
    kw = y_scaler.inverse_transform([[raw_val]])[0][0]

    return {"pump_power_optimized": round(float(kw), 4)}
