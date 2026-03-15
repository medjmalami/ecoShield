import { Schema, model } from "mongoose";

const sensorSchema = new Schema({
  id:                 { type: String,  required: true, unique: true },
  name:               { type: String,  required: true },
  location:           { type: String,  required: true },
  encryptedSecretKey: { type: String,  required: true },
  active:             { type: Boolean, default: true },
  registeredAt:       { type: Date,    default: Date.now },
});

export const Sensor = model("Sensor", sensorSchema);
