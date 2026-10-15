import React, { useState, useEffect } from 'react';
import { 
  Database, Search, RefreshCw, Download, Upload, Trash2,
  CheckCircle2, AlertCircle, Layers, FileCode, Zap, Brain,
  Sparkles, Tag, Clock, HardDrive, Filter, Plus, ChevronRight,
  ShieldCheck, ArrowRight, Eye, Code2
} from 'lucide-react';
import { 
  AgentWorkflowItem, 
  PatchHistoryItem, 
  AgenticSkill, 
  AuraMemoryItem, 
  ContextQueryResult, 
  MemoryStoreStats, 
  MemoryStoreName 
} from '../types';
import { memoryStore } from '../lib/memoryStore';

interface MemoryStoreInspectorProps {
  onExportCheckpoint?: () => void;
}

export const MemoryStoreInspector: React.FC<MemoryStoreInspectorProps> = ({ onExportCheckpoint }) => {
  const [stats, setStats] = useState<MemoryStoreStats | null>(null);
  const [activeTab, setActiveTab] = useState<'workflows' | 'patches' | 'skills' | 'memories' | 'search'>('search');

  // Search Tester State
  const [searchQuery, setSearchQuery] = useState<string>('TypeScript AST patch');
  const [queryResult, setQueryResult] = useState<ContextQueryResult | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Loaded Items State
  const [workflows, setWorkflows] = useState<AgentWorkflowItem[]>([]);
  const [patches, setPatches] = useState<PatchHistoryItem[]>([]);
  const [skills, setSkills] = useState<AgenticSkill[]>([]);
  const [memories, setMemories] = useState<AuraMemoryItem[]>([]);

  // Modal State for Adding Memory or Custom Item
  const [showAddMemoryModal, setShowAddMemoryModal] = useState<boolean>(false);
  const [newMemContent, setNewMemContent] = useState<string>('');
  const [newMemCategory, setNewMemCategory] = useState<AuraMemoryItem['category']>('system');
  const [newMemImportance, setNewMemImportance] = useState<AuraMemoryItem['importance']>('high');

  // Status message
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchStatsAndData = async () => {
    try {
      const currentStats = await memoryStore.getStats();
      setStats(currentStats);

      const [wf, pt, sk, mem] = await Promise.all([
        memoryStore.getWorkflows(),
        memoryStore.getPatches(),
        memoryStore.getSkills(),
        memoryStore.getAllMemories()
      ]);

      setWorkflows(wf);
      setPatches(pt);
      setSkills(sk);
      setMemories(mem);
    } catch (err) {
      console.error('Error fetching MemoryStore data:', err);
    }
  };

  useEffect(() => {
    fetchStatsAndData();
  }, []);

  const handleTestQuery = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const result = await memoryStore.queryContext(searchQuery);
      setQueryResult(result);
    } catch (err) {
      console.error('Query error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (searchQuery) {
      handleTestQuery();
    }
  }, [searchQuery]);

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemContent.trim()) return;

    const newItem: AuraMemoryItem = {
      id: `mem-usr-${Date.now()}`,
      category: newMemCategory,
      content: newMemContent.trim(),
      importance: newMemImportance,
      source: 'User Inspector',
      timestamp: new Date().toLocaleDateString('sv-SE')
    };

    await memoryStore.indexMemoryItem(newItem);
    setNewMemContent('');
    setShowAddMemoryModal(false);
    setStatusMessage(`[MEMORY STORED] Nytt minne indexerat i IndexedDB!`);
    await fetchStatsAndData();
  };

  const handleDeleteItem = async (storeName: MemoryStoreName, id: string) => {
    await memoryStore.deleteItem(storeName, id);
    setStatusMessage(`[DELETED] Objekt borttaget från ${storeName}`);
    await fetchStatsAndData();
    if (searchQuery) handleTestQuery();
  };

  const handleClearAll = async () => {
    if (window.confirm('Är du säker på att du vill rensa hela IndexedDB MemoryStore?')) {
      await memoryStore.clearAll();
      setStatusMessage('[CLEARED] IndexedDB MemoryStore har rensats.');
      await fetchStatsAndData();
      setQueryResult(null);
    }
  };

  const handleExportDump = async () => {
    const dump = await memoryStore.exportDump();
    const blob = new Blob([dump], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jaco-memorystore-dump-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('[EXPORTED] MemoryStore exporterades till JSON.');
  };

  const handleImportDump = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const success = await memoryStore.importDump(text);
    if (success) {
      setStatusMessage('[IMPORTED] MemoryStore-data har importerats!');
      await fetchStatsAndData();
      if (searchQuery) handleTestQuery();
    } else {
      setStatusMessage('[ERROR] Kunde inte importera MemoryStore-dump.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 text-slate-100 font-sans">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-950 via-cyan-950/80 to-slate-950 border border-cyan-500/40 rounded-xl p-5 shadow-[0_0_25px_rgba(34,211,238,0.15)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-cyan-950 border border-cyan-400/50 flex items-center justify-center text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
              <Database className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100 font-sans tracking-tight">
                  JACO Persistent MemoryStore Engine
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40">
                  IndexedDB v1
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Automatisk indexering av agent-workflows, lyckade patchar och inlärda skills i lokal webbläsardatabas för förbättrad kontextmedvetenhet.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={fetchStatsAndData}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors"
              title="Uppdatera MemoryStore statistik"
            >
              <RefreshCw className="w-4 h-4 text-cyan-400" />
            </button>

            <button
              onClick={handleExportDump}
              className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 text-xs font-mono font-semibold border border-slate-700 transition-colors flex items-center gap-1.5"
            >
              <Download className="w-4 h-4 text-cyan-400" />
              <span>Exportera Dump</span>
            </button>

            <label className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-teal-300 text-xs font-mono font-semibold border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-4 h-4 text-teal-400" />
              <span>Importera Dump</span>
              <input type="file" accept=".json" onChange={handleImportDump} className="hidden" />
            </label>

            <button
              onClick={handleClearAll}
              className="px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-xs font-mono font-semibold border border-rose-800/80 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>Rensa DB</span>
            </button>
          </div>
        </div>

        {/* Database Quick Stats Metrics */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-cyan-900/40 relative z-10 text-xs font-mono">
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Totalt Indexerat</span>
              <strong className="text-cyan-300 text-sm font-bold">{stats.totalItemsCount} objekt</strong>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Agent Workflows</span>
              <strong className="text-purple-300 text-sm font-bold">{stats.workflowsCount} st</strong>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Verifierade Patchar</span>
              <strong className="text-emerald-300 text-sm font-bold">{stats.patchesCount} st</strong>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Inlärda Skills</span>
              <strong className="text-amber-300 text-sm font-bold">{stats.skillsCount} st</strong>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 col-span-2 sm:col-span-1">
              <span className="text-slate-400 block text-[10px]">DB Storlek / Status</span>
              <strong className="text-cyan-400 text-sm font-bold">{stats.estimatedSizeKb} KB • AKTIV</strong>
            </div>
          </div>
        )}
      </div>

      {statusMessage && (
        <div className="p-3 bg-cyan-950/80 border border-cyan-500/50 rounded-lg text-xs font-mono text-cyan-300 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('search')}
          className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
            activeTab === 'search'
              ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(34,211,238,0.4)]'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Search className="w-4 h-4" />
          <span>Kontext-Sökning & AI-Ranking</span>
        </button>

        <button
          onClick={() => setActiveTab('workflows')}
          className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
            activeTab === 'workflows'
              ? 'bg-purple-500 text-slate-950 shadow-[0_0_15px_rgba(168,85,247,0.4)]'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Workflows ({workflows.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('patches')}
          className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
            activeTab === 'patches'
              ? 'bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>Patchar ({patches.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('skills')}
          className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
            activeTab === 'skills'
              ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.4)]'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Skills ({skills.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('memories')}
          className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
            activeTab === 'memories'
              ? 'bg-blue-500 text-slate-950 shadow-[0_0_15px_rgba(59,130,246,0.4)]'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Brain className="w-4 h-4" />
          <span>Minnen ({memories.length})</span>
        </button>
      </div>

      {/* TAB 1: CONTEXT SEARCH & RANKING TESTER */}
      {activeTab === 'search' && (
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-cyan-900/60 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-cyan-900/40 pb-3">
              <span className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-2">
                <Search className="w-4 h-4 text-cyan-400" />
                Sök Kontext i IndexedDB (Simulera JACO Context Awareness)
              </span>
              <span className="text-xs font-mono text-slate-400">
                Indexerad Sökning via Nöckelordsranking
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Skriv sökord (t.ex. AST patch, NPU, Ollama, server.ts)..."
                  className="w-full bg-slate-950 border border-cyan-900/80 rounded-lg pl-9 pr-3 py-2.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="flex gap-2 w-full sm:w-auto">
                {['AST patch', 'NPU acceleration', 'Ollama config', 'server.ts'].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setSearchQuery(preset)}
                    className="px-2.5 py-2 bg-slate-950 hover:bg-cyan-950 text-slate-300 text-[11px] font-mono rounded border border-slate-800 whitespace-nowrap"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {queryResult && (
              <div className="space-y-4 pt-2">
                {/* Search Meta Bar */}
                <div className="bg-slate-950 p-3.5 rounded-lg border border-cyan-900/50 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Sökning:</span>
                    <strong className="text-cyan-300 font-bold">"{queryResult.query}"</strong>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-slate-400">Totalt Träffar: <strong className="text-emerald-400">{queryResult.totalMatches}</strong></span>
                    <span className="text-slate-400">Relevanspoäng: <strong className="text-amber-400">{queryResult.relevanceScore}%</strong></span>
                  </div>
                </div>

                {/* Context Snippet Output for AI Prompts */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-cyan-400" />
                    Genererad Kontext-Snippet för AI-Prompt Injektion:
                  </h4>
                  <pre className="bg-slate-950 p-4 rounded-xl border border-cyan-500/30 font-mono text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap overflow-x-auto shadow-inner">
                    {queryResult.contextSnippet}
                  </pre>
                </div>

                {/* Ranked Matches Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  {/* Matching Workflows */}
                  <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                    <h5 className="text-xs font-mono font-bold text-purple-300 flex items-center justify-between">
                      <span>Matchande Workflows ({queryResult.relevantWorkflows.length})</span>
                      <Layers className="w-3.5 h-3.5 text-purple-400" />
                    </h5>
                    {queryResult.relevantWorkflows.length === 0 ? (
                      <p className="text-[11px] text-slate-500 font-mono italic">Inga workflows matchade.</p>
                    ) : (
                      queryResult.relevantWorkflows.map(w => (
                        <div key={w.id} className="p-2.5 bg-slate-900 rounded border border-slate-800 text-xs space-y-1">
                          <div className="font-bold text-slate-200">{w.title}</div>
                          <p className="text-[11px] text-slate-400">{w.outcomeSummary}</p>
                          <div className="text-[10px] font-mono text-purple-400">Relevans-Score: +{w.matchScore}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Matching Patches */}
                  <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                    <h5 className="text-xs font-mono font-bold text-emerald-300 flex items-center justify-between">
                      <span>Matchande Patchar ({queryResult.relevantPatches.length})</span>
                      <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                    </h5>
                    {queryResult.relevantPatches.length === 0 ? (
                      <p className="text-[11px] text-slate-500 font-mono italic">Inga patchar matchade.</p>
                    ) : (
                      queryResult.relevantPatches.map(p => (
                        <div key={p.id} className="p-2.5 bg-slate-900 rounded border border-slate-800 text-xs space-y-1">
                          <div className="font-bold text-slate-200">{p.targetFile}</div>
                          <p className="text-[11px] text-slate-400">{p.patchDescription}</p>
                          <div className="text-[10px] font-mono text-emerald-400">Relevans-Score: +{p.matchScore}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: INDEXED WORKFLOWS */}
      {activeTab === 'workflows' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono font-bold text-slate-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              Indexerade Agentic Workflows i IndexedDB ({workflows.length})
            </span>
            <span className="text-xs font-mono text-slate-400">Store: 'workflows'</span>
          </div>

          <div className="space-y-3">
            {workflows.map((wf) => (
              <div key={wf.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 text-sm">{wf.title}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-purple-950 text-purple-300 border border-purple-800">
                      {wf.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-400 font-mono">{wf.timestamp}</span>
                    <button
                      onClick={() => handleDeleteItem('workflows', wf.id)}
                      className="text-slate-500 hover:text-rose-400 transition-colors"
                      title="Ta bort workflow från IndexedDB"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-slate-300 leading-relaxed"><strong className="text-slate-400">Prompt:</strong> {wf.prompt}</p>
                <p className="text-slate-300 leading-relaxed"><strong className="text-slate-400">Resultat:</strong> {wf.outcomeSummary}</p>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {wf.tags.map((tag, i) => (
                    <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: INDEXED PATCHES */}
      {activeTab === 'patches' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono font-bold text-slate-200 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-emerald-400" />
              Indexerade Lyckade Kodpatchar ({patches.length})
            </span>
            <span className="text-xs font-mono text-slate-400">Store: 'patches'</span>
          </div>

          <div className="space-y-3">
            {patches.map((patch) => (
              <div key={patch.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 font-mono text-xs">{patch.targetFile}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-800">
                      {patch.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-400 font-mono">{patch.timestamp}</span>
                    <button
                      onClick={() => handleDeleteItem('patches', patch.id)}
                      className="text-slate-500 hover:text-rose-400 transition-colors"
                      title="Ta bort patch"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-slate-300">{patch.patchDescription}</p>

                <div className="bg-slate-900 p-2.5 rounded border border-slate-800 font-mono text-[11px] text-slate-300 space-y-1">
                  <div className="text-slate-400 text-[10px]">Verifierings-Hash: {patch.verificationHash || 'N/A'}</div>
                  <pre className="text-[10px] text-emerald-300 overflow-x-auto whitespace-pre-wrap">{patch.diffContent}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: INDEXED SKILLS */}
      {activeTab === 'skills' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono font-bold text-slate-200 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Inlärda & Indexerade Agentic Skills ({skills.length})
            </span>
            <span className="text-xs font-mono text-slate-400">Store: 'skills'</span>
          </div>

          <div className="space-y-3">
            {skills.map((skill) => (
              <div key={skill.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 text-sm">{skill.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-950 text-amber-300 border border-amber-800">
                      {skill.category}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteItem('skills', skill.id)}
                    className="text-slate-500 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-slate-300">{skill.description}</p>
                <div className="text-[11px] font-mono text-cyan-400">Trigger key: {skill.triggerKey}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: INDEXED MEMORIES */}
      {activeTab === 'memories' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono font-bold text-slate-200 flex items-center gap-2">
              <Brain className="w-4 h-4 text-blue-400" />
              Inlärda Kontextminnen i IndexedDB ({memories.length})
            </span>
            <button
              onClick={() => setShowAddMemoryModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-slate-950 text-xs font-mono font-bold rounded flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Lägg till Minne</span>
            </button>
          </div>

          <div className="space-y-2">
            {memories.map((mem) => (
              <div key={mem.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1 text-xs flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded bg-slate-900 text-blue-300 border border-slate-800">
                      {mem.category}
                    </span>
                    <span className={`px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded ${
                      mem.importance === 'high' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-slate-900 text-slate-400'
                    }`}>
                      {mem.importance}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">{mem.source}</span>
                  </div>
                  <p className="text-slate-200 leading-relaxed font-sans">{mem.content}</p>
                </div>

                <button
                  onClick={() => handleDeleteItem('memories', mem.id)}
                  className="text-slate-500 hover:text-rose-400 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ADD MEMORY MODAL */}
      {showAddMemoryModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateMemory} className="bg-slate-900 border border-cyan-500/40 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Brain className="w-4 h-4 text-blue-400" /> Indexera Nytt Kontextminne i IndexedDB
              </h3>
              <button
                type="button"
                onClick={() => setShowAddMemoryModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-slate-300 block mb-1">Minnesinnehåll / Regel</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Skriv regel eller kontext som JACO ska komma ihåg för framtida uppdrag..."
                  value={newMemContent}
                  onChange={(e) => setNewMemContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded p-2 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1">Kategori</label>
                  <select
                    value={newMemCategory}
                    onChange={(e) => setNewMemCategory(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded p-2 focus:outline-none"
                  >
                    <option value="system">System</option>
                    <option value="code_ast">Code AST</option>
                    <option value="learned_skill">Inlärd Skill</option>
                    <option value="user_preference">Användarpreferens</option>
                    <option value="mission_result">Mission Resultat</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 block mb-1">Giltighet/Viktighet</label>
                  <select
                    value={newMemImportance}
                    onChange={(e) => setNewMemImportance(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded p-2 focus:outline-none"
                  >
                    <option value="high">Hög (High)</option>
                    <option value="medium">Medium</option>
                    <option value="low">Låg (Low)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddMemoryModal(false)}
                className="px-4 py-1.5 bg-slate-800 text-slate-200 rounded font-semibold"
              >
                Avbryt
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded"
              >
                Spara i MemoryStore
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
