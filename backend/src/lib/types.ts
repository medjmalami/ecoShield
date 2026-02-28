export type sensorData = {
    id: string,
    timestamp: string,
    pressure: number,
    flow_rate: number,
    temperature: number,
    pump_power: number
}

export type sensorDataBatch = {
    id: string,
    timestamp: string,
    pressure: number,
    flow_rate: number,
    temperature: number,
    pump_power: number,
    pressure_mean: number,
    pressure_var: number,
}
export type sensorGroup =  [
    sensorDataBatch,
    sensorDataBatch,
    sensorDataBatch,
    sensorDataBatch,
    sensorDataBatch,
]

// Shape sent to the optimizer: (5 frames × 30 floats)
// Each row = 5 sensors × 6 features [pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]
// sorted by sensor id ascending
export type optimizerInput = number[][]

export type optimizerOutput = {
    pump_power_optimized: number,
}

// Shape sent to the detection model: (5 frames × 30 floats)
// Each row = 5 sensors × 6 features [pressure, flow_rate, temperature, pump_power, pressure_mean, pressure_var]
// sorted by sensor id ascending — identical shape to optimizerInput
export type detectionInput = number[][]

export type detectionOutput = {
    anomaly_detected: boolean,
}

export type PipelineEvent = {
    timestamp: string;
    anomaly: { detected: false } | { detected: true; sensorWindow: sensorDataBatch[][] };
    sensor5: { pump_power: number };
    optimizer: { pump_power_optimized: number };
}