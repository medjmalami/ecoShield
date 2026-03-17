import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import "./lib/mongo";
import { startConsumer } from "./lib/pipeline";
import eventsRouter from "./routes/events";
import detectionsRouter from "./routes/detections";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/events", eventsRouter);
app.use("/detections", detectionsRouter);

app.listen(PORT, () => {
  console.log(`[server] running on port ${PORT}`);

  // Start consuming sensor ticks from RabbitMQ.
  // startConsumer() handles its own reconnect loop internally; a rejection here
  // means the initial Redis flush or MongoDB key-load failed — both unrecoverable.
  startConsumer().catch((err: any) => {
    console.error("[server] startConsumer() failed fatally:", err?.message ?? err);
    process.exit(1);
  });
});

export default app;
