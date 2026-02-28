'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FlaggedEvent, DetectionsResponse } from '@/lib/api';

interface AttackLogProps {
  attacks: FlaggedEvent[];
  loading: boolean;
  pagination: DetectionsResponse['pagination'] | null;
  onPageChange: (page: number) => void;
}

const ITEMS_PER_PAGE = 10;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AttackLog({ attacks, loading, pagination, onPageChange }: AttackLogProps) {
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const [lastTopId, setLastTopId] = useState<string | null>(null);

  // Animate the first item whenever the list top changes (new anomaly arrived)
  useEffect(() => {
    if (attacks.length > 0) {
      const firstId = attacks[0]._id;
      if (firstId !== lastTopId) {
        setLastTopId(firstId);
        setAnimatingIds(new Set([firstId]));
        const timer = setTimeout(() => setAnimatingIds(new Set()), 500);
        return () => clearTimeout(timer);
      }
    }
  }, [attacks, lastTopId]);

  const currentPage  = pagination?.page ?? 1;
  const totalPages   = pagination?.totalPages ?? 1;
  const total        = pagination?.total ?? 0;
  const startIndex   = (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIndex     = Math.min(currentPage * ITEMS_PER_PAGE, total);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Journal des Anomalies FDI</h2>
        {total > 0 && (
          <span className="text-sm text-slate-400">
            {total} anomalie{total > 1 ? 's' : ''} détectée{total > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex-1 space-y-3 mb-4 min-h-[320px]">
        {loading ? (
          // Loading skeleton
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-slate-900/50 border-l-4 border-slate-700 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-slate-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-slate-800 rounded w-1/2" />
            </div>
          ))
        ) : attacks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="text-4xl mb-2">🛡️</div>
            <div className="text-[#00ff88] font-medium">Aucune anomalie détectée</div>
            <div className="text-slate-400 text-sm mt-1">Système sécurisé</div>
          </div>
        ) : (
          attacks.map((attack) => (
            <div
              key={attack._id}
              className={`bg-slate-900/50 border-l-4 border-[#ff4444] rounded-lg p-4 transition-all duration-300 ${
                animatingIds.has(attack._id)
                  ? 'translate-x-0 opacity-100'
                  : 'translate-x-0 opacity-100'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-white mb-1">
                    Injection FDI
                  </div>
                  <div className="text-xs text-slate-400">
                    {formatDate(attack.detectedAt)}
                  </div>
                </div>
                <div className="text-xs px-2 py-1 rounded bg-red-900/30 text-red-300 self-start">
                  Détectée
                </div>
              </div>
              <div className="text-xs text-slate-500 font-mono">
                ID: {attack._id}
              </div>
            </div>
          ))
        )}
      </div>

      {!loading && total > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={18} />
            <span className="text-sm">Précédent</span>
          </button>

          <div className="flex items-center gap-2">
            {Array.from({ length: totalPages }).map((_, index) => {
              const pageNum = index + 1;
              // Show at most 7 page buttons to avoid overflow
              if (
                totalPages <= 7 ||
                pageNum === 1 ||
                pageNum === totalPages ||
                Math.abs(pageNum - currentPage) <= 2
              ) {
                return (
                  <button
                    key={pageNum}
                    onClick={() => onPageChange(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                      currentPage === pageNum
                        ? 'bg-[#00ff88] text-[#0a0f1e]'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              }
              // Ellipsis
              if (Math.abs(pageNum - currentPage) === 3) {
                return <span key={pageNum} className="text-slate-600 text-sm">…</span>;
              }
              return null;
            })}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              {startIndex}–{endIndex} sur {total}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-sm">Suivant</span>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
