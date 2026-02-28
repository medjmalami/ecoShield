import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

mongoose.connect(
  process.env.MONGO_URI || "mongodb://admin:secret@localhost:27017/ecoshield?authSource=admin"
);

mongoose.connection.on("connected", () => console.log("[mongo] connected"));
mongoose.connection.on("error", (err) =>
  console.error("[mongo] error:", err.message)
);

export default mongoose;
