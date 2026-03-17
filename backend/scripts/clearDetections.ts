import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("[clear-detections] MONGO_URI is not set");
  process.exit(1);
}

// ── FlaggedEvent model (inline — avoids importing compiled pipeline code) ─────

const flaggedEventSchema = new mongoose.Schema({}, { strict: false });
const FlaggedEvent = mongoose.model("FlaggedEvent", flaggedEventSchema);

// ── Main ──────────────────────────────────────────────────────────────────────

async function clear(): Promise<void> {
  await mongoose.connect(MONGO_URI!);
  console.log("[clear-detections] connected to MongoDB");

  const result = await FlaggedEvent.deleteMany({});
  console.log(`[clear-detections] deleted ${result.deletedCount} flagged event(s)`);

  await mongoose.disconnect();
  console.log("[clear-detections] done — disconnected from MongoDB");
}

clear().catch((err) => {
  console.error("[clear-detections] fatal error:", err?.message ?? err);
  process.exit(1);
});
