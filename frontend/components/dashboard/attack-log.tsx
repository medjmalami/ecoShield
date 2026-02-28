'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';

interface Attack {
  id: string;
  sensorId: string;
  timestamp: string;
  type: string;
  score: number;
  status: string;
}

interface AttackLogProps {
  attacks: Attack[];
}

const ITEMS_PER_PAGE = 5;

export default function AttackLog({ attacks }: AttackLogProps) {
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedSensor, setSelectedSensor] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [lastAnimatedId, setLastAnimatedId] = useState<string | null>(null);

  // Get unique values for filters
  const sensors = Array.from(new Set(attacks.map(a => a.sensorId)));
  const types = Array.from(new Set(attacks.map(a => a.type)));
  const statuses = Array.from(new Set(attacks.map(a => a.status)));

  // Filter attacks based on selected filters
  const filteredAttacks = attacks.filter(attack => {
    if (selectedSensor && attack.sensorId !== selectedSensor) return false;
    if (selectedType && attack.type !== selectedType) return false;
    if (selectedStatus && attack.status !== selectedStatus) return false;
    return true;
  });

  useEffect(() => {
    setCurrentPage(0);
  }, [selectedSensor, selectedType, selectedStatus]);

  useEffect(() => {
    if (filteredAttacks.length > 0) {
      const firstId = filteredAttacks[0].id;
      if (firstId !== lastAnimatedId) {
        setLastAnimatedId(firstId);
        setAnimatingIds(new Set([firstId]));
        const timer = setTimeout(() => {
          setAnimatingIds(new Set());
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [filteredAttacks, lastAnimatedId]);

  const totalPages = Math.ceil(filteredAttacks.length / ITEMS_PER_PAGE);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedAttacks = filteredAttacks.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Journal des Attaques</h2>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-slate-300 hover:bg-slate-800 transition-all"
        >
          <Filter size={16} />
          <span className="text-sm">Filtres</span>
        </button>
      </div>

      {showFilters && (
        <div className="mb-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
          <div className="grid grid-cols-3 gap-4">
            {/* Sensor Filter */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-2 block">Capteur</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedSensor(null)}
                  className={`px-3 py-1 rounded text-sm transition-all ${
                    selectedSensor === null
                      ? 'bg-[#00ff88] text-[#0a0f1e]'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Tous
                </button>
                {sensors.map(sensor => (
                  <button
                    key={sensor}
                    onClick={() => setSelectedSensor(selectedSensor === sensor ? null : sensor)}
                    className={`px-3 py-1 rounded text-sm transition-all ${
                      selectedSensor === sensor
                        ? 'bg-[#00ff88] text-[#0a0f1e]'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {sensor}
                  </button>
                ))}
              </div>
            </div>

            {/* Type Filter */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-2 block">Type d&apos;Attaque</label>
              <select
                value={selectedType || ''}
                onChange={(e) => setSelectedType(e.target.value || null)}
                className="w-full px-3 py-2 rounded bg-slate-800 text-slate-300 text-sm border border-slate-700 focus:border-[#00ff88] focus:outline-none transition-all"
              >
                <option value="">Tous les types</option>
                {types.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-2 block">Statut</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedStatus(null)}
                  className={`px-3 py-1 rounded text-sm transition-all ${
                    selectedStatus === null
                      ? 'bg-[#00ff88] text-[#0a0f1e]'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Tous
                </button>
                {statuses.map(status => (
                  <button
                    key={status}
                    onClick={() => setSelectedStatus(selectedStatus === status ? null : status)}
                    className={`px-3 py-1 rounded text-sm transition-all ${
                      selectedStatus === status
                        ? 'bg-[#00ff88] text-[#0a0f1e]'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex-1 space-y-3 mb-4 min-h-[320px]">
        {filteredAttacks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="text-4xl mb-2">🛡️</div>
            <div className="text-[#00ff88] font-medium">
              {attacks.length === 0 ? 'Aucune attaque détectée' : 'Aucune attaque correspondant aux filtres'}
            </div>
            <div className="text-slate-400 text-sm mt-1">
              Système sécurisé
            </div>
          </div>
        ) : (
          paginatedAttacks.map((attack) => (
            <div
              key={attack.id}
              className={`bg-slate-900/50 border-l-4 border-[#ff4444] rounded-lg p-4 transition-all duration-300 ${
                animatingIds.has(attack.id)
                  ? 'translate-x-0 opacity-100'
                  : 'translate-x-full opacity-0'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-semibold text-white mb-1">
                      Capteur: <span className="text-[#ff4444]">{attack.sensorId}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {attack.type}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-[#ff4444]">
                    {attack.score}%
                  </div>
                  <div className="text-xs text-slate-400">Menace</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  {attack.timestamp}
                </div>
                <div className={`text-xs px-2 py-1 rounded ${
                  attack.status === 'Bloquée'
                    ? 'bg-red-900/30 text-red-300'
                    : 'bg-yellow-900/30 text-yellow-300'
                }`}>
                  {attack.status}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {filteredAttacks.length > 0 && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <button
            onClick={handlePreviousPage}
            disabled={currentPage === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={18} />
            <span className="text-sm">Précédent</span>
          </button>

          <div className="flex items-center gap-2">
            {Array.from({ length: totalPages }).map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentPage(index)}
                className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                  currentPage === index
                    ? 'bg-[#00ff88] text-[#0a0f1e]'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {index + 1}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              {startIndex + 1}-{Math.min(endIndex, filteredAttacks.length)} sur {filteredAttacks.length}
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages - 1}
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
