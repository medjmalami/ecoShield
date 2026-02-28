'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';

interface ChartProps {
  data: any[];
  selectedSensor: string;
  onSensorChange: (sensor: string) => void;
}

const SENSORS = ['W1', 'W2', 'W3', 'W4'];

export default function Chart({ data, selectedSensor, onSensorChange }: ChartProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white mb-2">Capteur Analysé</h2>
          <div className="text-2xl font-bold text-[#00ff88]">{selectedSensor}</div>
        </div>
        
        <div className="flex gap-2">
          {SENSORS.map((sensor) => (
            <button
              key={sensor}
              onClick={() => onSensorChange(sensor)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                selectedSensor === sensor
                  ? 'bg-[#00ff88] text-[#0a0f1e]'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {sensor}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900/30 rounded-lg p-6 border border-slate-800">
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="time"
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              stroke="#9ca3af"
              label={{ value: 'm³/h', angle: -90, position: 'insideLeft', fill: '#9ca3af' }}
              style={{ fontSize: '12px' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #475569',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Area
              type="monotone"
              dataKey="real"
              stroke="#3b82f6"
              name="Consommation Réelle"
              fill="none"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="optimized"
              stroke="#00ff88"
              name="Consommation Optimisée"
              fill="url(#colorGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
