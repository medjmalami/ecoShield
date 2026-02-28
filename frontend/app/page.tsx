'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/dashboard/navbar';
import Chart from '@/components/dashboard/chart';
import AttackLog from '@/components/dashboard/attack-log';
import AlertBanner from '@/components/dashboard/alert-banner';
import { subscribeToEvents, fetchDetections } from '@/lib/api';
import type { FlaggedEvent, DetectionsResponse, ChartDataPoint } from '@/lib/api';

const MAX_CHART_POINTS = 30;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function Home() {
  // Chart — rolling 30-point buffer
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  // Navbar stats
  const [energySaved, setEnergySaved] = useState<number>(0);
  const [attacksBlocked, setAttacksBlocked] = useState<number>(0);

  // Alert banner — ISO timestamp of the latest anomaly, null = no active banner
  const [latestAnomaly, setLatestAnomaly] = useState<string | null>(null);

  // Attack log — server-driven pagination
  const [detections, setDetections] = useState<FlaggedEvent[]>([]);
  const [detPage, setDetPage] = useState<number>(1);
  const [detPagination, setDetPagination] = useState<DetectionsResponse['pagination'] | null>(null);
  const [detLoading, setDetLoading] = useState<boolean>(true);

  // ── REST: fetch detections whenever page changes ──────────────────────────
  const loadDetections = useCallback(async (page: number) => {
    setDetLoading(true);
    try {
      const res = await fetchDetections(page, 10);
      setDetections(res.data);
      setDetPagination(res.pagination);
      setAttacksBlocked(res.pagination.total);
    } catch (err) {
      console.error('[page] fetchDetections error:', err);
    } finally {
      setDetLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDetections(detPage);
  }, [detPage, loadDetections]);

  // ── SSE: subscribe once on mount ──────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToEvents((event) => {
      const real      = event.sensor5.pump_power;
      const optimized = event.optimizer.pump_power_optimized;

      // 1. Append to rolling chart buffer
      setChartData((prev) => {
        const next: ChartDataPoint = {
          time: formatTime(event.timestamp),
          real:      parseFloat(real.toFixed(2)),
          optimized: parseFloat(optimized.toFixed(2)),
        };
        const updated = [...prev, next];
        return updated.length > MAX_CHART_POINTS
          ? updated.slice(updated.length - MAX_CHART_POINTS)
          : updated;
      });

      // 2. Recompute energySaved from this tick
      if (real > 0) {
        const pct = Math.round(((real - optimized) / real) * 100);
        setEnergySaved(pct);
      }

      // 3. If anomaly detected — show banner and refresh detections from page 1
      if (event.anomaly.detected) {
        setLatestAnomaly(event.timestamp);
        setDetPage(1);
        // If already on page 1, detPage won't change so force a reload
        loadDetections(1);
      }
    });

    return unsubscribe;
  }, [loadDetections]);

  // ── Handle page change from AttackLog ────────────────────────────────────
  const handlePageChange = useCallback((page: number) => {
    setDetPage(page);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1e]">
      {latestAnomaly && (
        <AlertBanner key={latestAnomaly} detectedAt={latestAnomaly} />
      )}
      <Navbar energySaved={energySaved} attacksBlocked={attacksBlocked} />
      <div className="p-6">
        <div className="mb-8">
          <Chart data={chartData} />
        </div>
        <div>
          <AttackLog
            attacks={detections}
            loading={detLoading}
            pagination={detPagination}
            onPageChange={handlePageChange}
          />
        </div>
      </div>
    </div>
  );
}
