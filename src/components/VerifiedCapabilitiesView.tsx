import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Search, 
  Filter, 
  RefreshCw, 
  ExternalLink, 
  Terminal, 
  Clock, 
  Code, 
  Copy, 
  Check, 
  ChevronRight, 
  Info,
  Award,
  Layers,
  Database
} from 'lucide-react';

export interface CapabilityItem {
  id: string;
  name: string;
  category?: string;
  status: 'REAL' | 'VERIFIED' | 'PROTOTYPE' | 'SIMULATED' | 'SPEC' | string;
  realityTag: string;
  isVerifiedByAuditLogs: boolean;
  evidence: string;
  terminalLogProof?: string | null;
  evidenceUrl?: string;
  lastVerifiedTimestamp?: string | null;
  auditChecksum?: string | null;
  sourceFile?: string;
}

export interface EvidencePacket {
  schema: string;
  generatedAt: string;
  system: string;
  sourceFile?: string;
  capabilities: CapabilityItem[];
}

export const VerifiedCapabilitiesView: React.FC = () => {
  const [evidencePackets, setEvidencePackets] = useState<EvidencePacket[]>([]);
  const [allCapabilities, setAllCapabilities] = useState<CapabilityItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filtering & Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'verified' | 'simulated'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<CapabilityItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);

  const evidenceFiles = [
    '/evidence/capability-matrix.json',
    '/evidence/execution-proof.json'
  ];

  const fetchEvidenceData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const packets: EvidencePacket[] = [];
      const combinedItems: CapabilityItem[] = [];

      for (const fileUrl of evidenceFiles) {
        try {
          const response = await fetch(fileUrl);
          if (response.ok) {
            const data: EvidencePacket = await response.json();
            const sourceName = data.sourceFile || fileUrl;
            packets.push(data);
            
            const taggedItems = (data.capabilities || []).map(cap => ({
              ...cap,
              sourceFile: sourceName
            }));
            combinedItems.push(...taggedItems);
          }
        } catch (err) {
          console.warn(`Could not load evidence file from ${fileUrl}`, err);
        }
      }

      setEvidencePackets(packets);
      setAllCapabilities(combinedItems);
    } catch (err: any) {
      setError(err.message || 'Fel vid hämtning av evidenspaket');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvidenceData();
  }, []);

  // Calculate unique categories
  const categories = Array.from(
    new Set(allCapabilities.map(c => c.category).filter(Boolean) as string[])
  );

  // Filter capabilities
  const filteredCapabilities = allCapabilities.filter(item => {
    const matchesSearch = 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.evidence.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.terminalLogProof && item.terminalLogProof.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = 
      filterStatus === 'all' ? true :
      filterStatus === 'verified' ? item.isVerifiedByAuditLogs :
      !item.isVerifiedByAuditLogs;

    const matchesCategory = 
      selectedCategory === 'all' ? true : item.category === selectedCategory;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  const verifiedCount = allCapabilities.filter(c => c.isVerifiedByAuditLogs).length;
  const simulatedCount = allCapabilities.filter(c => !c.isVerifiedByAuditLogs).length;
  const verificationRatio = allCapabilities.length > 0 
    ? Math.round((verifiedCount / allCapabilities.length) * 100) 
    : 0;

  const handleCopyProof = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto font-mono text-slate-100">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-slate-900 via-cyan-950/40 to-slate-900 border border-cyan-800/50 rounded-lg p-5 shadow-[0_0_20px_rgba(34,211,238,0.15)] relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
          <ShieldCheck className="w-36 h-36 text-cyan-400" />
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/30">
                JACO Evidence Protocol
              </span>
              <span className="text-xs text-slate-400">/evidence/*.json</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Award className="w-6 h-6 text-cyan-400" />
              <span>Verifierade Egenskaper (Verified Capabilities)</span>
            </h1>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              Hämtar och utvärderar evidenspaket från JACO:s verifieringslager. 
              Särskiljer automatiskt bekräftad körning i terminal- och granskningsloggar från simulerade platshållare.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchEvidenceData}
              disabled={isLoading}
              className="flex items-center gap-2 px-3.5 py-2 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/50 text-xs font-semibold transition-all shadow-[0_0_10px_rgba(34,211,238,0.2)] disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>{isLoading ? 'Hämtar...' : 'Uppdatera Evidens'}</span>
            </button>

            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className="flex items-center gap-2 px-3.5 py-2 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors"
            >
              <Code className="w-3.5 h-3.5 text-slate-400" />
              <span>{showRawJson ? 'Dölj JSON' : 'Visa Raw JSON'}</span>
            </button>
          </div>
        </div>

        {/* Audit Stats Dashboard Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-cyan-900/40">
          <div className="bg-slate-950/60 p-3 rounded border border-cyan-900/30">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Totalt Laddade</span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-lg font-bold text-slate-100">{allCapabilities.length}</span>
              <Layers className="w-4 h-4 text-slate-400" />
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded border border-emerald-900/50">
            <span className="text-[10px] text-emerald-400 uppercase font-semibold block">Verifierad Körning</span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-lg font-bold text-emerald-300">{verifiedCount}</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded border border-amber-900/50">
            <span className="text-[10px] text-amber-400 uppercase font-semibold block">Simulerade Platshållare</span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-lg font-bold text-amber-300">{simulatedCount}</span>
              <AlertCircle className="w-4 h-4 text-amber-400" />
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded border border-cyan-900/50">
            <span className="text-[10px] text-cyan-300 uppercase font-semibold block">Verifieringsgrad</span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-lg font-bold text-cyan-200">{verificationRatio}%</span>
              <div className="w-12 h-2 bg-slate-800 rounded-full overflow-hidden self-center">
                <div 
                  className="h-full bg-cyan-400 transition-all duration-500" 
                  style={{ width: `${verificationRatio}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Optional Raw JSON Inspector Drawer */}
      {showRawJson && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span>Hämtade Evidenspaket JSON (`/evidence/*.json`)</span>
            </span>
            <span className="text-[11px] text-slate-500">{evidencePackets.length} filer inlästa</span>
          </div>
          <pre className="text-[11px] text-emerald-400 bg-black/80 p-3 rounded border border-slate-800 overflow-x-auto max-h-64 scrollbar-thin">
            {JSON.stringify(evidencePackets, null, 2)}
          </pre>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/70 p-3 rounded-lg border border-slate-800">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Sök egenskaper, id, evidens eller loggar..."
            className="w-full bg-slate-950 border border-slate-700/80 rounded pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 transition-colors"
          />
        </div>

        {/* Status Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'all'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40 font-bold'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Alla ({allCapabilities.length})
          </button>

          <button
            onClick={() => setFilterStatus('verified')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'verified'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50 font-bold'
                : 'bg-slate-950 text-slate-400 hover:text-emerald-300 border border-slate-800'
            }`}
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>Verifierade ({verifiedCount})</span>
          </button>

          <button
            onClick={() => setFilterStatus('simulated')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'simulated'
                ? 'bg-amber-950 text-amber-300 border border-amber-500/50 font-bold'
                : 'bg-slate-950 text-slate-400 hover:text-amber-300 border border-slate-800'
            }`}
          >
            <AlertCircle className="w-3 h-3 text-amber-400" />
            <span>Simulerade ({simulatedCount})</span>
          </button>

          {/* Category Dropdown Filter */}
          {categories.length > 0 && (
            <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
              <Filter className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
              >
                <option value="all">Alla Kategorier</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Capability Cards Grid */}
      {isLoading ? (
        <div className="p-12 text-center bg-slate-950/50 border border-slate-800 rounded-lg space-y-3">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Läser in och validerar evidenspaket från `/evidence/*.json`...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-950/40 border border-red-800/50 rounded-lg text-red-200 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <strong className="font-bold">Fel vid hämtning av evidens:</strong> {error}
          </div>
        </div>
      ) : filteredCapabilities.length === 0 ? (
        <div className="p-12 text-center bg-slate-950/40 border border-slate-800 rounded-lg text-slate-400 text-xs space-y-2">
          <Info className="w-6 h-6 text-slate-500 mx-auto" />
          <p>Inga egenskaper matchade sökningen eller valda filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredCapabilities.map(item => {
            const isVerified = item.isVerifiedByAuditLogs;

            return (
              <div
                key={item.id}
                className={`bg-slate-900/80 border rounded-lg p-4 transition-all flex flex-col justify-between space-y-3 hover:border-cyan-500/50 ${
                  isVerified
                    ? 'border-emerald-800/60 shadow-[0_0_15px_rgba(16,185,129,0.08)]'
                    : 'border-amber-900/50 bg-slate-900/40 opacity-90'
                }`}
              >
                {/* Card Top Row */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {item.category && (
                          <span className="px-2 py-0.5 text-[10px] uppercase font-bold rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {item.category}
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-slate-500">ID: {item.id}</span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
                        {item.name}
                      </h3>
                    </div>

                    {/* Verified vs Simulated Badge */}
                    {isVerified ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 text-[11px] font-bold shadow-[0_0_10px_rgba(16,185,129,0.25)] shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                        <span>VERIFIERAD</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/90 text-amber-300 border border-amber-500/50 text-[11px] font-bold shrink-0">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                        <span>SIMULERAD PLATSHÅLLARE</span>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {item.evidence}
                  </p>
                </div>

                {/* Terminal / Audit Log Proof Container */}
                {isVerified && item.terminalLogProof ? (
                  <div className="bg-black/90 rounded border border-emerald-900/60 p-2.5 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-emerald-400 font-semibold border-b border-emerald-900/40 pb-1 mb-1">
                      <span className="flex items-center gap-1">
                        <Terminal className="w-3 h-3 text-emerald-400" />
                        Bekräftad Terminal-/Auditlogg
                      </span>
                      <button
                        onClick={() => handleCopyProof(item.terminalLogProof!, item.id)}
                        className="text-slate-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                      >
                        {copiedId === item.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{copiedId === item.id ? 'Kopierad' : 'Kopiera'}</span>
                      </button>
                    </div>
                    <code className="text-emerald-300/90 block font-mono text-[10.5px] whitespace-pre-wrap break-all">
                      {item.terminalLogProof}
                    </code>
                  </div>
                ) : !isVerified ? (
                  <div className="bg-amber-950/30 rounded border border-amber-900/40 p-2.5 text-[11px] text-amber-200/80 flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Saknar bekräftad exekveringslogg i terminalarkiv. Taggen är satt till <strong className="text-amber-300 font-mono">{item.realityTag}</strong>.
                    </span>
                  </div>
                ) : null}

                {/* Footer Metadata */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {item.lastVerifiedTimestamp ? new Date(item.lastVerifiedTimestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : 'Ej verifierad'}
                    </span>
                    {item.auditChecksum && (
                      <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                        Checksum: {item.auditChecksum}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {item.evidenceUrl && (
                      <a
                        href={item.evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[11px] font-semibold"
                      >
                        <span>Dokumentation</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={() => setSelectedItem(item)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 transition-colors"
                    >
                      <span>Detaljer</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detailed Modal / Drawer for Capability Item */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-800/70 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 font-mono shadow-[0_0_30px_rgba(34,211,238,0.2)]">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30 mb-1 inline-block">
                  Evidensdetaljer — {selectedItem.id}
                </span>
                <h2 className="text-lg font-bold text-slate-100">{selectedItem.name}</h2>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-slate-400 hover:text-slate-100 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
              >
                Stäng [ESC]
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded border border-slate-800">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block">Verklighetsklassificering</span>
                  <strong className="text-slate-200 font-bold">{selectedItem.realityTag}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block">Audit-Status</span>
                  {selectedItem.isVerifiedByAuditLogs ? (
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> VERIFIERAD (Körning bekräftad)
                    </span>
                  ) : (
                    <span className="text-amber-400 font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> SIMULERAD PLATSHÅLLARE
                    </span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Evidensbeskrivning</span>
                <p className="bg-slate-950 p-3 rounded border border-slate-800 text-slate-300 leading-relaxed">
                  {selectedItem.evidence}
                </p>
              </div>

              {selectedItem.terminalLogProof && (
                <div>
                  <span className="text-[10px] text-emerald-400 uppercase font-semibold block mb-1 flex items-center gap-1">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    Terminal- & Auditloggbevis (Confirming Proof)
                  </span>
                  <div className="bg-black p-3 rounded border border-emerald-900/80 text-emerald-300 font-mono text-[11px] whitespace-pre-wrap break-all">
                    {selectedItem.terminalLogProof}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
                <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">Källfil</span>
                  <span className="text-cyan-300">{selectedItem.sourceFile || '/evidence/capability-matrix.json'}</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">Kryptografisk Checksum</span>
                  <span className="text-slate-300 font-mono">{selectedItem.auditChecksum || 'Ej tillgänglig'}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-1.5 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/40 text-xs font-semibold"
              >
                Stäng Fönster
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
