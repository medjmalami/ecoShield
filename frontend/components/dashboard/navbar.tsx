interface NavbarProps {
  energySaved: number;
  attacksBlocked: number;
}

export default function Navbar({ energySaved, attacksBlocked }: NavbarProps) {
  return (
    <nav className="border-b border-slate-800 bg-[#0a0f1e]">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="text-2xl font-bold text-[#00ff88] flex items-center gap-2">
          <span>🛡️</span>
          <span>EcoShield AI</span>
        </div>
        
        <div className="flex gap-6">
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Énergie Économisée
            </div>
            <div className="text-3xl font-bold text-[#00ff88]">
              {energySaved}%
            </div>
          </div>
          
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Attaques Bloquées
            </div>
            <div className="text-3xl font-bold text-[#ff4444]">
              {attacksBlocked}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
