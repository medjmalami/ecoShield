export type sensorData = {
    id: string,
    timestamp: string,
    pressure: number,
    flow_rate: number,
    temperature: number,
    pump_power: number
}

export type processedSensorData = {
    id: string,
    timestamp: string,
    pressure: number,
    flow_rate: number,
    temperature: number,
    pump_power: number,
    time_of_day: string,
    day_of_week: string,
    month: string,
}
export type sensorDataBatch = {
    id: string,
    timestamp: string,
    pressure: number,
    flow_rate: number,
    temperature: number,
    pump_power: number,
    time_of_day: string,
    day_of_week: string,
    month: string,
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

export type optimizerInput = [
    sensorGroup,
    sensorGroup,
    sensorGroup,
    sensorGroup,
    sensorGroup,
]

export type optimizerOutput = {
    pump_power_optimized: number,
}

export type detectionInput = [
    sensorGroup,
    sensorGroup,
    sensorGroup,
    sensorGroup,
    sensorGroup,
]

export type detectionOutput = {
    anomaly_detected: boolean,
}

export type PipelineEvent = {
    timestamp: string;
    anomaly: { detected: false } | { detected: true; sensorWindow: sensorDataBatch[][] };
    sensor5: { pump_power: number };
    optimizer: { pump_power_optimized: number };
}