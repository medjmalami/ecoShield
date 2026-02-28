import { Schema, model } from "mongoose";

const sensorDataBatchSchema = new Schema({
  id:            String,
  timestamp:     String,
  pressure:      Number,
  flow_rate:     Number,
  temperature:   Number,
  pump_power:    Number,
  time_of_day:   String,
  day_of_week:   String,
  month:         String,
  pressure_mean: Number,
  pressure_var:  Number,
}, { _id: false });

const flaggedEventSchema = new Schema({
  detectedAt:      { type: Date, default: Date.now },
  sensorWindow:    { type: [[sensorDataBatchSchema]], required: true }, // 5 groups × 5 readings
  detectionResult: {
    anomaly_detected: { type: Boolean, required: true },
  },
});

export const FlaggedEvent = model("FlaggedEvent", flaggedEventSchema);
