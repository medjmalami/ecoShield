'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/dashboard/navbar';
import Chart from '@/components/dashboard/chart';
import AttackLog from '@/components/dashboard/attack-log';
import { generateMockData, generateMockAttacks } from '@/lib/mock-data';

export default function Home() {
  const [selectedSensor, setSelectedSensor] = useState('W1');
  const [chartData, setChartData] = useState([]);
  const [attacks, setAttacks] = useState([]);
  const [energySaved, setEnergySaved] = useState(0);
  const [attacksBlocked, setAttacksBlocked] = useState(0);

  useEffect(() => {
    // Initialize data
    const data = generateMockData(selectedSensor);
    const mockAttacks = generateMockAttacks();
    
    setChartData(data);
    setAttacks(mockAttacks);
    
    // Calculate stats
    const totalReal = data.reduce((sum, d) => sum + d.real, 0);
    const totalOptimized = data.reduce((sum, d) => sum + d.optimized, 0);
    const savedPercent = Math.round(((totalReal - totalOptimized) / totalReal) * 100);
    setEnergySaved(savedPercent);
    setAttacksBlocked(mockAttacks.length);
  }, [selectedSensor]);

  return (
    <div className="min-h-screen bg-[#0a0f1e]">
      <Navbar
        energySaved={energySaved}
        attacksBlocked={attacksBlocked}
      />
      <div className="p-6">
        <div className="mb-8">
          <Chart
            data={chartData}
            selectedSensor={selectedSensor}
            onSensorChange={setSelectedSensor}
          />
        </div>
        <div>
          <AttackLog attacks={attacks} />
        </div>
      </div>
    </div>
  );
}
