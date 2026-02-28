from fastapi import FastAPI

app = FastAPI(title="EcoShield Detection Model")


@app.get("/health")
def health():
    return {"status": "ok"}
