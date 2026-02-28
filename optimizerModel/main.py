import sys
import joblib
import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException
from pathlib import Path

app = FastAPI(title="EcoShield Optimizer Model")

# ── Model class definition (required for torch.load with full model object) ───

class LSTMRegressor2(nn.Module):
    def __init__(self, input_dim=30, hidden_size=128, num_layers=2, dropout=0.2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_size, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        last_h = out[:, -1, :]
        return self.fc(self.dropout(last_h)).squeeze(1)


# ── Register class in __main__ so torch.load can find it ─────────────────────
# The .pt file was saved with torch.save(model, ...) which pickles the class
# reference as __main__.LSTMRegressor2. When running under uvicorn,
# __main__ is uvicorn's entry point, not this file. This trick fixes it.
sys.modules["__main__"].LSTMRegressor2 = LSTMRegressor2


# ── Load model and scalers at startup ────────────────────────────────────────

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

# Input feature scaler (same 6 features as detection model)
# The optimizer model was trained on scaled inputs using StandardScaler
try:
    feature_scaler = joblib.load(NOTEBOOKS_DIR / "anomalie.pkl")
    print("[optimizer] feature scaler loaded successfully")
except Exception as e:
    raise RuntimeError(f"[optimizer] failed to load feature scaler: {e}")

# Output scaler for inverse-transforming predictions back to kW
try:
    y_scaler = joblib.load(NOTEBOOKS_DIR / "optim.pkl")
    print("[optimizer] y_scaler loaded successfully")
except Exception as e:
    raise RuntimeError(f"[optimizer] failed to load y_scaler: {e}")


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

    # Scale input: reshape (5, 30) → (25, 6), scale, reshape back to (1, 5, 30)
    arr = np.array(payload, dtype=np.float32).reshape(25, 6)
    arr_scaled = feature_scaler.transform(arr).reshape(1, 5, 30).astype(np.float32)

    # Convert to tensor — batch of 1
    x = torch.from_numpy(arr_scaled)

    with torch.no_grad():
        raw = model(x)                          # (1,) — normalized output
        raw_val = raw.item()

    # Inverse-transform from normalized space back to kW
    kw = y_scaler.inverse_transform([[raw_val]])[0][0]

    return {"pump_power_optimized": round(float(kw), 4)}
