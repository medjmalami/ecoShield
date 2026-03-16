'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import type { ChartDataPoint } from '@/lib/api';

type Location = 'locationA' | 'locationB';

interface ChartProps {
  data: ChartDataPoint[];
  selectedLocation: Location;
  onLocationChange: (loc: Location) => void;
}

const LOCATION_LABELS: Record<Location, string> = {
  locationA: 'Location A',
  locationB: 'Location B',
};

export default function Chart({ data, selectedLocation, onLocationChange }: ChartProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Puissance réelle vs optimisée en temps réel
        </h2>

        {/* Location toggle buttons */}
        <div className="flex gap-2">
          {(Object.keys(LOCATION_LABELS) as Location[]).map((loc) => (
            <button
              key={loc}
              onClick={() => onLocationChange(loc)}
              className={cn(
                'px-4 py-1.5 rounded-md text-sm font-medium border transition-colors',
                selectedLocation === loc
                  ? 'border-[#00ff88] text-[#00ff88] bg-[#00ff88]/10'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
              )}
            >
              {LOCATION_LABELS[loc]}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900/30 rounded-lg p-6 border border-slate-800">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-100 text-center">
            <div className="text-4xl mb-2">📡</div>
            <div className="text-slate-400 font-medium">En attente des données du capteur...</div>
            <div className="text-slate-500 text-sm mt-1">
              Le graphique s&apos;affichera dès la première mesure
            </div>
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
