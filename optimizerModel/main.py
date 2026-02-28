from fastapi import FastAPI

app = FastAPI(title="EcoShield Optimizer Model")


@app.get("/health")
def health():
    return {"status": "ok"}
