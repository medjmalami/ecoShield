const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SensorDataBatch = {
  id: string;
  timestamp: string;
  pressure: number;
  flow_rate: number;
  temperature: number;
  pump_power: number;
  time_of_day: string;
  day_of_week: string;
  month: string;
  pressure_mean: number;
  pressure_var: number;
};

export type FlaggedEvent = {
  _id: string;
  detectedAt: string;
  detectionResult: { anomaly_detected: boolean };
  sensorWindow: SensorDataBatch[][];
};

export type DetectionsResponse = {
  data: FlaggedEvent[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

export type ChartDataPoint = {
  time: string;
  real: number;
  optimized: number;
};

export type PipelineEvent = {
  timestamp: string;
  anomaly: { detected: false } | { detected: true; sensorWindow: SensorDataBatch[][] };
  sensor5: { pump_power: number };
  optimizer: { pump_power_optimized: number };
};

// ── REST ──────────────────────────────────────────────────────────────────────

export async function fetchDetections(
  page: number = 1,
  limit: number = 10
): Promise<DetectionsResponse> {
  const res = await fetch(
    `${API_URL}/detections?page=${page}&limit=${limit}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`[api] fetchDetections failed: ${res.status}`);
  return res.json();
}

// ── SSE ───────────────────────────────────────────────────────────────────────

export function subscribeToEvents(
  onEvent: (event: PipelineEvent) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_URL}/events`);

  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data);
      // Skip the initial connection heartbeat
      if ('connected' in parsed) return;
      onEvent(parsed as PipelineEvent);
    } catch {
      // ignore malformed frames
    }
  };

  if (onError) es.onerror = onError;

  return () => es.close();
}
