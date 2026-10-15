import React, { useState } from 'react';
import {
  History,
  RotateCcw,
  CheckCircle2,
  FileCode,
  Search,
  Filter,
  Copy,
  Check,
  Code2,
  Terminal,
  ShieldCheck,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Undo2,
  FileDiff,
  Hash,
  AlertTriangle,
  Layers,
  FileJson,
  Download
} from 'lucide-react';
import { PatchHistoryItem, CodeFile } from '../types';

interface PatchHistoryViewProps {
  patchHistory: PatchHistoryItem[];
  onRollbackPatch: (patchId: string) => void;
  onReapplyPatch?: (patchId: string) => void;
  onClearHistory?: () => void;
  onExportCheckpoint?: () => void;
  codeFiles?: CodeFile[];
}

export const PatchHistoryView: React.FC<PatchHistoryViewProps> = ({
  patchHistory,
  onRollbackPatch,
  onReapplyPatch,
  onClearHistory,
  onExportCheckpoint,
  codeFiles = []
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'applied' | 'rolled_back'>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [expandedPatchIds, setExpandedPatchIds] = useState<Record<string, boolean>>({
    'patch-001': true // default expand first patch
  });
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [copiedDiffId, setCopiedDiffId] = useState<string | null>(null);
  const [rollbackConfirmationId, setRollbackConfirmationId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const toggleExpand = (id: string) => {
    setExpandedPatchIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text: string, type: 'hash' | 'diff', id: string) => {
    navigator.clipboard.writeText(text);
    if (type === 'hash') {
      setCopiedHash(id);
      setTimeout(() => setCopiedHash(null), 2000);
    } else {
      setCopiedDiffId(id);
      setTimeout(() => setCopiedDiffId(null), 2000);
    }
  };

  const handleExecuteRollback = (id: string) => {
    onRollbackPatch(id);
    setRollbackConfirmationId(null);
    const item = patchHistory.find(p => p.id === id);
    showToast(`Rollback genomförd för patch "${item?.workflowTitle || id}". Källkodsfilen har återställts.`);
  };

  const handleExecuteReapply = (id: string) => {
    if (onReapplyPatch) {
      onReapplyPatch(id);
      const item = patchHistory.find(p => p.id === id);
      showToast(`Patch "${item?.workflowTitle || id}" har återapplicerats.`);
    }
  };

  // Filtered patch items
  const filteredPatches = patchHistory.filter(patch => {
    const matchesSearch =
      patch.workflowTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patch.targetFile.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patch.patchDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patch.agentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patch.id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || patch.status === statusFilter;

    const matchesAgent =
      agentFilter === 'all' || patch.agentName.toLowerCase() === agentFilter.toLowerCase();

    return matchesSearch && matchesStatus && matchesAgent;
  });

  const appliedCount = patchHistory.filter(p => p.status === 'applied').length;
  const rolledBackCount = patchHistory.filter(p => p.status === 'rolled_back').length;

  const getAgentBadge = (agent: string) => {
    switch (agent.toLowerCase()) {
      case 'jaco':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-400 border border-emerald-800/60"><ShieldCheck className="w-3 h-3" /> JACO</span>;
      case 'coder':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800/60"><Code2 className="w-3 h-3" /> Coder</span>;
      case 'termux':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-400 border border-indigo-800/60"><Terminal className="w-3 h-3" /> Termux</span>;
      case 'openclaw':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-400 border border-cyan-800/60"><Layers className="w-3 h-3" /> OpenClaw</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700"><Sparkles className="w-3 h-3" /> {agent}</span>;
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 font-mono text-xs">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-emerald-500 text-emerald-200 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-cyan-400 shrink-0" />
          <span className="font-sans text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Main Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-950 border border-indigo-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]">
              <History className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-100 tracking-tight">
                  Agentic Patch Historik
                </h1>
                <span className="text-[10px] uppercase font-bold text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-indigo-800/60">
                  Version-Logg & Rollback
                </span>
              </div>
              <p className="text-slate-400 text-sm mt-1 max-w-xl leading-relaxed font-sans">
                Aktiv historik över alla lyckade kodändringar och patchar uträttade av autonoma agenter. Varje loggad patch har verifierad kryptografisk hash och en-klicks-rollback.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onExportCheckpoint && (
              <button
                onClick={onExportCheckpoint}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/50 text-xs font-semibold shadow-[0_0_12px_rgba(34,211,238,0.25)] transition-all"
                title="Exportera hela workspacet, filinnehåll och patch-historik till en JSON-checkpoint"
              >
                <FileJson className="w-4 h-4 text-cyan-400" />
                <span>Exportera Checkpoint JSON</span>
              </button>
            )}

            {onClearHistory && (
              <button
                onClick={onClearHistory}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800 text-xs font-semibold transition-colors"
                title="Rensa historik"
              >
                Rensa Logg
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col justify-between">
            <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Totalt Loggade</span>
            <div className="text-xl font-bold text-slate-100 mt-1">{patchHistory.length}</div>
          </div>

          <div className="bg-slate-950 border border-emerald-950 rounded-lg p-3 flex flex-col justify-between">
            <span className="text-emerald-500 text-[10px] uppercase font-bold tracking-wider">Aktiva Patchar</span>
            <div className="text-xl font-bold text-cyan-400 mt-1 flex items-center gap-2">
              {appliedCount}
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
          </div>

          <div className="bg-slate-950 border border-amber-950 rounded-lg p-3 flex flex-col justify-between">
            <span className="text-amber-500 text-[10px] uppercase font-bold tracking-wider">Återställda (Rollbacks)</span>
            <div className="text-xl font-bold text-amber-400 mt-1">{rolledBackCount}</div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col justify-between">
            <span className="text-cyan-500 text-[10px] uppercase font-bold tracking-wider">Källkodsfiler</span>
            <div className="text-xl font-bold text-cyan-300 mt-1">{codeFiles.length > 0 ? codeFiles.length : '3'} Filer</div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Sök på fil, agent, sökord eller patch-ID..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
              statusFilter === 'all'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Alla ({patchHistory.length})
          </button>
          <button
            onClick={() => setStatusFilter('applied')}
            className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
              statusFilter === 'applied'
                ? 'bg-cyan-950 text-emerald-300 border border-emerald-800/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Aktiva ({appliedCount})
          </button>
          <button
            onClick={() => setStatusFilter('rolled_back')}
            className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
              statusFilter === 'rolled_back'
                ? 'bg-amber-950 text-amber-300 border border-amber-800/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Återställda ({rolledBackCount})
          </button>
        </div>

        {/* Agent Filter Dropdown */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="all">Alla Agenter</option>
            <option value="jaco">JACO</option>
            <option value="coder">Coder</option>
            <option value="termux">Termux</option>
            <option value="openclaw">OpenClaw</option>
          </select>
        </div>
      </div>

      {/* Patch List */}
      <div className="space-y-4">
        {filteredPatches.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-8 text-center">
            <FileDiff className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-bold text-sm">Inga agentic patchar hittades</p>
            <p className="text-slate-500 text-xs mt-1">Ingen historik matchar det valda filtret.</p>
          </div>
        ) : (
          filteredPatches.map((patch) => {
            const isExpanded = !!expandedPatchIds[patch.id];
            const isApplied = patch.status === 'applied';

            return (
              <div
                key={patch.id}
                className={`border rounded-xl transition-all overflow-hidden bg-slate-900 ${
                  isApplied
                    ? 'border-slate-800 hover:border-indigo-500/50'
                    : 'border-slate-800/60 opacity-85 bg-slate-950'
                }`}
              >
                {/* Patch Card Header Bar */}
                <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleExpand(patch.id)}
                      className="mt-1 p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-100 transition-colors"
                      title={isExpanded ? 'Fäll ihop' : 'Expandera diff'}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-100 text-sm">
                          {patch.workflowTitle}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          #{patch.id}
                        </span>
                        {getAgentBadge(patch.agentName)}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1 font-semibold text-cyan-300">
                          <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                          {patch.targetFile}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-slate-400">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          {patch.timestamp}
                        </span>
                        <span>•</span>
                        <span className="font-bold text-cyan-400">+{patch.linesAdded}</span>
                        <span className="font-bold text-rose-400">-{patch.linesRemoved}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Status Badge */}
                  <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
                    <div>
                      {isApplied ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-950 text-emerald-300 border border-emerald-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Aktiv Patch
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                          <RotateCcw className="w-3 h-3" />
                          Återställd {patch.rolledBackAt && `(${patch.rolledBackAt})`}
                        </span>
                      )}
                    </div>

                    {/* Rollback / Re-apply Buttons */}
                    <div className="flex items-center gap-2">
                      {isApplied ? (
                        <button
                          onClick={() => setRollbackConfirmationId(patch.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 font-bold text-xs transition-colors shadow-sm"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          <span>Rollback</span>
                        </button>
                      ) : (
                        onReapplyPatch && (
                          <button
                            onClick={() => handleExecuteReapply(patch.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 font-bold text-xs transition-colors shadow-sm"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Återapplicera</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Description Banner */}
                <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800/50 text-slate-300 text-xs font-sans">
                  <strong className="font-mono text-[11px] text-slate-400 mr-2 uppercase tracking-wide">Beskrivning:</strong>
                  {patch.patchDescription}
                </div>

                {/* Expanded Section: Diff Viewer & Hash */}
                {isExpanded && (
                  <div className="p-4 space-y-3 bg-slate-950">
                    {/* Hash & Diff Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      {patch.verificationHash && (
                        <div className="flex items-center gap-2 text-slate-400 font-mono bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
                          <Hash className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="truncate max-w-[200px] sm:max-w-[320px] text-slate-300">
                            {patch.verificationHash}
                          </span>
                          <button
                            onClick={() => copyToClipboard(patch.verificationHash!, 'hash', patch.id)}
                            className="text-slate-400 hover:text-slate-100 transition-colors ml-1"
                            title="Kopiera hash"
                          >
                            {copiedHash === patch.id ? <Check className="w-3.5 h-3.5 text-cyan-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}

                      <button
                        onClick={() => copyToClipboard(patch.diffContent, 'diff', patch.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] transition-colors ml-auto"
                      >
                        {copiedDiffId === patch.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Kopierad!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                            <span>Kopiera Unified Diff</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Unified Code Diff Box */}
                    <div className="bg-black border border-slate-800 rounded-lg p-3 font-mono text-[11px] leading-relaxed overflow-x-auto shadow-inner">
                      <div className="text-slate-500 mb-2 font-bold select-none flex items-center gap-2 border-b border-slate-900 pb-1">
                        <FileDiff className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Unified Diff Output ({patch.targetFile})</span>
                      </div>
                      <pre className="whitespace-pre font-mono">
                        {patch.diffContent.split('\n').map((line, i) => {
                          let lineStyle = 'text-slate-400';
                          if (line.startsWith('+')) {
                            lineStyle = 'text-cyan-400 bg-cyan-950/40 font-semibold px-1 rounded-sm';
                          } else if (line.startsWith('-')) {
                            lineStyle = 'text-rose-400 bg-rose-950/40 font-semibold px-1 rounded-sm';
                          } else if (line.startsWith('@')) {
                            lineStyle = 'text-cyan-400 font-bold';
                          }
                          return (
                            <div key={i} className={lineStyle}>
                              {line}
                            </div>
                          );
                        })}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Rollback Confirmation Modal */}
      {rollbackConfirmationId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-full bg-rose-950 border border-rose-800 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Bekräfta Rollback av Patch</h3>
                <p className="text-slate-400 text-xs">Är du säker på att du vill återställa denna ändring?</p>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
              <div><strong className="text-slate-400">Patch ID:</strong> <span className="text-indigo-300 font-mono">{rollbackConfirmationId}</span></div>
              <div><strong className="text-slate-400">Målfil:</strong> <span className="text-cyan-300 font-mono">{patchHistory.find(p => p.id === rollbackConfirmationId)?.targetFile}</span></div>
            </div>

            <p className="text-slate-300 text-xs font-sans leading-relaxed">
              Källkodsfilen kommer att återställas till sin ursprungliga version före agentens exekvering. Ändringen loggas i terminalen.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setRollbackConfirmationId(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={() => handleExecuteRollback(rollbackConfirmationId)}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 shadow-lg shadow-rose-950/50"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Verkställ Rollback</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
