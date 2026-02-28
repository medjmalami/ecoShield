'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ChartDataPoint } from '@/lib/api';

interface ChartProps {
  data: ChartDataPoint[];
}

export default function Chart({ data }: ChartProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Puissance réelle vs optimisée en temps réel</h2>
      </div>

      <div className="bg-slate-900/30 rounded-lg p-6 border border-slate-800">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-100 text-center">
            <div className="text-4xl mb-2">📡</div>
            <div className="text-slate-400 font-medium">En attente des données du capteur...</div>
            <div className="text-slate-500 text-sm mt-1">Le graphique s&apos;affichera dès la première mesure</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="gradientOptimized" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00ff88" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradientReal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="time"
                stroke="#9ca3af"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                stroke="#9ca3af"
                tick={{ fontSize: 11 }}
                label={{ value: 'kW', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={(value: number, name: string) => [`${value.toFixed(2)} kW`, name]}
              />
              <Area
                type="monotone"
                dataKey="real"
                stroke="#3b82f6"
                name="Puissance Réelle"
                fill="url(#gradientReal)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="optimized"
                stroke="#00ff88"
                name="Puissance Optimisée"
                fill="url(#gradientOptimized)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
