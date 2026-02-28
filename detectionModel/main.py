import joblib
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pathlib import Path

app = FastAPI(title="EcoShield Detection Model")

# ── Load model and scaler at startup ─────────────────────────────────────────

BASE_DIR = Path(__file__).parent
NOTEBOOKS_DIR = BASE_DIR.parent / "notebooks"

try:
    model = torch.load(
        NOTEBOOKS_DIR / "lstm_anomaly_early_stopping.pt",
        map_location="cpu",
        weights_only=False,
    )
    model.eval()
    print("[detection] model loaded successfully")
except Exception as e:
    raise RuntimeError(f"[detection] failed to load model: {e}")

try:
    scaler = joblib.load(NOTEBOOKS_DIR / "anomalie.pkl")
    print("[detection] scaler loaded successfully")
except Exception as e:
    raise RuntimeError(f"[detection] failed to load scaler: {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(payload: list[list[float]]) -> dict:
    """
    Real LSTM FDI anomaly detection.
    Accepts shape (5, 30) — 5 frames × 30 floats.
    Each row = 5 sensors (sorted by id) × 6 features:
    [pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]

    Returns anomaly_detected: true if probability >= 0.5.
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

    # Scale input: reshape (5, 30) → (25, 6), scale, reshape back to (5, 30)
    arr = np.array(payload, dtype=np.float32).reshape(25, 6)
    arr_scaled = scaler.transform(arr).reshape(5, 30)

    # shape: (1, 5, 30) — batch of 1
    x = torch.tensor([arr_scaled], dtype=torch.float32)

    with torch.no_grad():
        logits = model(x)
        prob = torch.sigmoid(logits).item()

    return {"anomaly_detected": prob >= 0.5}
