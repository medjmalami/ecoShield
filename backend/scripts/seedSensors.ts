import crypto from "crypto";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: require("path").resolve(__dirname, "../.env") });

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
// UUIDs are the canonical sensor identifiers — keep in sync with:
//   • sensorServer/src/index.ts → LOCATION_A_SENSOR_IDS / LOCATION_B_SENSOR_IDS
//   • backend/src/lib/pipeline.ts → LOCATION_SENSOR_IDS

const SENSORS = [
  // locationA — positional slots 1–5 (env vars LOCATION_A_SENSOR_1..5_SECRET_KEY)
  { id: "2bf2a35c-b0b3-4f5e-b344-e63334b5ea21", name: "Sensor 1",  location: "locationA", plaintextKey: "78260a78bfb9910e17b7320beafed9648f3dbfe29a75355700047cac548ccd56" },
  { id: "0b92e342-c8f7-44a0-bedc-78554cc555cf", name: "Sensor 2",  location: "locationA", plaintextKey: "f902fb7a7eda5c3682a57d5a0b9f0058a6ace28afadb81223ac4c61a77010b49" },
  { id: "cfb4fee6-d20b-4d30-9e7f-b450b2e41f2c", name: "Sensor 3",  location: "locationA", plaintextKey: "618dff375e9d86cbfad6acf0e44bf3d5e34c7261907f2ab0cba08c817f3fc279" },
  { id: "4b5a031a-f16a-4615-9179-fede2cdd0d57", name: "Sensor 4",  location: "locationA", plaintextKey: "af98b0774b92baa572cee21f6ff52e38ecee46f7bb4a2ccf92e71f0994b592d9" },
  { id: "64d5be9f-5cff-41f3-9a99-904bdf4ccbcb", name: "Sensor 5",  location: "locationA", plaintextKey: "0c9d4d7aed43b58a2727a12b0649b9f1994b6dcccb9cfeaee362f1fc9c7be222" },
  // locationB — positional slots 6–10 (env vars LOCATION_B_SENSOR_6..10_SECRET_KEY)
  { id: "9bbc9a74-ca06-4873-8780-839f42f676f7", name: "Sensor 6",  location: "locationB", plaintextKey: "ac45dc69f783fb0fdeaee034f1232c33dbc90e28a71e9b7ec77c4ca610335cba" },
  { id: "9d39c885-da96-446f-a3ad-de8ce0a42778", name: "Sensor 7",  location: "locationB", plaintextKey: "1c1c2d357deb2d5f81fc26d40abb05ce1796f8c39ad36e6e533a7b5fb1c14cf6" },
  { id: "47066d75-1f30-4921-b531-2be485580dd3", name: "Sensor 8",  location: "locationB", plaintextKey: "e40315cf01417801f1aad89360136ebc0dd147cb54476027411efaead7c481fe" },
  { id: "5d89f0a6-0dae-4db8-b929-40c5c51a8ced", name: "Sensor 9",  location: "locationB", plaintextKey: "7e27c64732fbbdbbb84ceaf9084f21261233dab5714f38648c8477f820bd08d7" },
  { id: "e79c6baf-9828-461b-b148-670dfc1aadc4", name: "Sensor 10", location: "locationB", plaintextKey: "91e6fb6b33a810fa4097d302144e97f853f219fe23b7f6f29bb8133b6d1ef2dd" },
];

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

  // Delete legacy sequential-ID documents before upserting UUID ones
  const legacyIds = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const deleted = await Sensor.deleteMany({ id: { $in: legacyIds } });
  if (deleted.deletedCount > 0) {
    console.log(`[seed] deleted ${deleted.deletedCount} legacy sequential-ID sensor(s)`);
  }

  for (const s of SENSORS) {
    const encryptedSecretKey = encryptKey(s.plaintextKey);

    await Sensor.findOneAndUpdate(
      { id: s.id },
      { id: s.id, name: s.name, location: s.location, encryptedSecretKey, active: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(
      `[seed] upserted sensor ${s.id} — name="${s.name}" location="${s.location}" encryptedSecretKey="${encryptedSecretKey}"`
    );
  }

  await mongoose.disconnect();
  console.log("[seed] done — disconnected from MongoDB");
}

seed().catch((err) => {
  console.error("[seed] fatal error:", err?.message ?? err);
  process.exit(1);
});
