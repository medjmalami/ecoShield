'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/dashboard/navbar';
import Chart from '@/components/dashboard/chart';
import AttackLog from '@/components/dashboard/attack-log';
import AlertBanner from '@/components/dashboard/alert-banner';
import { subscribeToEvents, fetchDetections } from '@/lib/api';
import type { FlaggedEvent, DetectionsResponse, ChartDataPoint } from '@/lib/api';

const MAX_CHART_POINTS = 30;

type Location = 'locationA' | 'locationB';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function Home() {
  // ── Location selection ────────────────────────────────────────────────────
  const [selectedLocation, setSelectedLocation] = useState<Location>('locationA');

  // ── Chart — independent rolling 30-point buffers per location ────────────
  const [chartData, setChartData] = useState<Record<Location, ChartDataPoint[]>>({
    locationA: [],
    locationB: [],
  });

  // ── Navbar stats — independent per location ───────────────────────────────
  const [energySaved, setEnergySaved] = useState<Record<Location, number>>({
    locationA: 0,
    locationB: 0,
  });
  const [attacksBlocked, setAttacksBlocked] = useState<Record<Location, number>>({
    locationA: 0,
    locationB: 0,
  });

  // ── Alert banner — ISO timestamp of the latest anomaly (either location) ──
  const [latestAnomaly, setLatestAnomaly] = useState<string | null>(null);

  // ── Attack log — server-driven pagination, scoped to selectedLocation ─────
  const [detections, setDetections] = useState<FlaggedEvent[]>([]);
  const [detPage, setDetPage] = useState<number>(1);
  const [detPagination, setDetPagination] = useState<DetectionsResponse['pagination'] | null>(null);
  const [detLoading, setDetLoading] = useState<boolean>(true);

  // ── REST: fetch detections for the active location ────────────────────────
  const loadDetections = useCallback(async (page: number, location: Location) => {
    setDetLoading(true);
    try {
      const res = await fetchDetections(page, 10, location);
      setDetections(res.data);
      setDetPagination(res.pagination);
      // Keep attacksBlocked in sync with the DB total for this location
      setAttacksBlocked((prev) => ({ ...prev, [location]: res.pagination.total }));
    } catch (err) {
      console.error('[page] fetchDetections error:', err);
    } finally {
      setDetLoading(false);
    }
  }, []);

  // Reload detections whenever page or selected location changes
  useEffect(() => {
    loadDetections(detPage, selectedLocation);
  }, [detPage, selectedLocation, loadDetections]);

  // Reset to page 1 when switching locations
  const handleLocationChange = useCallback((loc: Location) => {
    setSelectedLocation(loc);
    setDetPage(1);
  }, []);

  // ── SSE: subscribe once on mount, route events by location ───────────────
  useEffect(() => {
    const unsubscribe = subscribeToEvents((event) => {
      const loc       = event.location as Location;
      const real      = event.sensor5.pump_power;
      const optimized = event.optimizer.pump_power_optimized;

      // 1. Append to the correct location's rolling chart buffer
      setChartData((prev) => {
        const next: ChartDataPoint = {
          time:      formatTime(event.timestamp),
          real:      parseFloat(real.toFixed(2)),
          optimized: parseFloat(optimized.toFixed(2)),
        };
        const updated = [...prev[loc], next];
        return {
          ...prev,
          [loc]: updated.length > MAX_CHART_POINTS
            ? updated.slice(updated.length - MAX_CHART_POINTS)
            : updated,
        };
      });

      // 2. Recompute energySaved for this location
      if (real > 0) {
        const pct = Math.round(((real - optimized) / real) * 100);
        setEnergySaved((prev) => ({ ...prev, [loc]: pct }));
      }

      // 3. If anomaly detected — show banner and refresh detections if it's the active location
      if (event.anomaly.detected) {
        setLatestAnomaly(event.timestamp);
        if (loc === selectedLocation) {
          setDetPage(1);
          loadDetections(1, loc);
        } else {
          // Still update the attacksBlocked count for the other location in the background
          fetchDetections(1, 10, loc)
            .then((res) => {
              setAttacksBlocked((prev) => ({ ...prev, [loc]: res.pagination.total }));
            })
            .catch((err) => console.error('[page] background fetchDetections error:', err));
        }
      }
    });

    return unsubscribe;
  }, [loadDetections, selectedLocation]);

  // ── Handle page change from AttackLog ─────────────────────────────────────
  const handlePageChange = useCallback((page: number) => {
    setDetPage(page);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1e]">
      {latestAnomaly && (
        <AlertBanner key={latestAnomaly} detectedAt={latestAnomaly} />
      )}
      <Navbar
        energySaved={energySaved[selectedLocation]}
        attacksBlocked={attacksBlocked[selectedLocation]}
      />
      <div className="p-6">
        <div className="mb-8">
          <Chart
            data={chartData[selectedLocation]}
            selectedLocation={selectedLocation}
            onLocationChange={handleLocationChange}
          />
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
