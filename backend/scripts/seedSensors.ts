import crypto from "crypto";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

const MONGO_URI  = process.env.MONGO_URI;
const MASTER_KEY = process.env.MASTER_KEY;

if (!MONGO_URI)  { console.error("[seed] MONGO_URI is not set");  process.exit(1); }
if (!MASTER_KEY) { console.error("[seed] MASTER_KEY is not set"); process.exit(1); }

const masterKeyBuf = Buffer.from(MASTER_KEY, "hex");
if (masterKeyBuf.length !== 32) {
  console.error("[seed] MASTER_KEY must be a 32-byte hex string");
  process.exit(1);
}

// ── Sensor definitions ────────────────────────────────────────────────────────

const SENSORS = [
  { id: "1", name: "Sensor 1", plaintextKey: "78260a78bfb9910e17b7320beafed9648f3dbfe29a75355700047cac548ccd56" },
  { id: "2", name: "Sensor 2", plaintextKey: "f902fb7a7eda5c3682a57d5a0b9f0058a6ace28afadb81223ac4c61a77010b49" },
  { id: "3", name: "Sensor 3", plaintextKey: "618dff375e9d86cbfad6acf0e44bf3d5e34c7261907f2ab0cba08c817f3fc279" },
  { id: "4", name: "Sensor 4", plaintextKey: "af98b0774b92baa572cee21f6ff52e38ecee46f7bb4a2ccf92e71f0994b592d9" },
  { id: "5", name: "Sensor 5", plaintextKey: "0c9d4d7aed43b58a2727a12b0649b9f1994b6dcccb9cfeaee362f1fc9c7be222" },
];

const LOCATION = "Water Treatment Plant";

// ── AES-256-CBC encrypt — produces "<iv_hex>:<ciphertext_hex>" ────────────────

function encryptKey(plaintext: string): string {
  const iv         = crypto.randomBytes(16);
  const cipher     = crypto.createCipheriv("aes-256-cbc", masterKeyBuf, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${ciphertext.toString("hex")}`;
}

// ── Mongoose Sensor model (inline — avoids importing compiled pipeline code) ──

const sensorSchema = new mongoose.Schema({
  id:                 { type: String,  required: true, unique: true },
  name:               { type: String,  required: true },
  location:           { type: String,  required: true },
  encryptedSecretKey: { type: String,  required: true },
  active:             { type: Boolean, default: true },
  registeredAt:       { type: Date,    default: Date.now },
});

const Sensor = mongoose.model("Sensor", sensorSchema);

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  await mongoose.connect(MONGO_URI!);
  console.log("[seed] connected to MongoDB");

  for (const s of SENSORS) {
    const encryptedSecretKey = encryptKey(s.plaintextKey);

    await Sensor.findOneAndUpdate(
      { id: s.id },
      { id: s.id, name: s.name, location: LOCATION, encryptedSecretKey, active: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[seed] upserted sensor ${s.id} — name="${s.name}" location="${LOCATION}" encryptedSecretKey="${encryptedSecretKey}"`);
  }

  await mongoose.disconnect();
  console.log("[seed] done — disconnected from MongoDB");
}

seed().catch((err) => {
  console.error("[seed] fatal error:", err?.message ?? err);
  process.exit(1);
});
