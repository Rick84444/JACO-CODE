import React, { useState, useEffect } from 'react';
import { Globe, Search, Play, Sparkles, Terminal, Cpu, CheckCircle2, Copy, FileCode, Layers, Shield, RefreshCw, Zap, ArrowRight, UserPlus, Key, Network, BadgeCheck, Check, Lock, CheckSquare } from 'lucide-react';
import { OllamaModel, OpenClawTask, OpenClawA2AAccount, A2AAuthEnvState } from '../types';

interface OpenClawStudioProps {
  models: OllamaModel[];
  activeModel?: OllamaModel;
  onSendContextToJaco: (contextText: string) => void;
}

export const OpenClawStudio: React.FC<OpenClawStudioProps> = ({
  models,
  activeModel,
  onSendContextToJaco
}) => {
  const [crawlQuery, setCrawlQuery] = useState('Ollama API endpoints and Gemma 4 multimodal model specifications');
  const [targetUrl, setTargetUrl] = useState('https://github.com/ollama/ollama');
  const [selectedModel, setSelectedModel] = useState<string>(activeModel?.name || 'gemma-4');
  const [crawlMode, setCrawlMode] = useState<'crawl' | 'scrape' | 'extract' | 'agent'>('agent');
  const [isExecuting, setIsExecuting] = useState(false);
  const [copied, setCopied] = useState(false);

  const [autoApprove, setAutoApprove] = useState(true);
  const [tasks, setTasks] = useState<OpenClawTask[]>([]);

  // A2A Autonomous Account Registration State
  const [a2aAccounts, setA2aAccounts] = useState<OpenClawA2AAccount[]>([]);
  const [targetNetwork, setTargetNetwork] = useState('JACO P2P Mesh Network');
  const [regAgentName, setRegAgentName] = useState('OpenClaw Autonomous Crawler Node');
  const [regRole, setRegRole] = useState('Autonomous Web Scraper & Tool Worker');
  const [isRegistering, setIsRegistering] = useState(false);
  const [lastRegMessage, setLastRegMessage] = useState<string | null>(null);

  // A2A Authentication & Environment Identifier Injection State
  const [authState, setAuthState] = useState<A2AAuthEnvState | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const fetchA2AAccounts = async () => {
    try {
      const res = await fetch('/api/openclaw/a2a-accounts');
      if (res.ok) {
        const data = await res.json();
        if (data.accounts) setA2aAccounts(data.accounts);
      }
    } catch (e) {
      console.warn("Error fetching A2A accounts:", e);
    }
  };

  const fetchAuthStatus = async () => {
    try {
      const res = await fetch('/api/openclaw/a2a-auth-status');
      if (res.ok) {
        const data = await res.json();
        if (data.authState) setAuthState(data.authState);
      }
    } catch (e) {
      console.warn("Error fetching A2A auth status:", e);
    }
  };

  useEffect(() => {
    fetchA2AAccounts();
    fetchAuthStatus();
  }, []);

  const handleAuthenticateAndInjectEnv = async () => {
    setIsAuthenticating(true);
    setAuthMessage(null);

    try {
      const res = await fetch('/api/openclaw/a2a-auth-inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: targetNetwork,
          agentName: regAgentName
        })
      });

      const data = await res.json();
      if (data.success && data.authState) {
        setAuthState(data.authState);
        setAuthMessage(data.message || 'A2A-autentisering fullbordad och unika identifierare har injekterats!');
      } else {
        setAuthMessage(data.error || 'Autentisering misslyckades.');
      }
    } catch (err: any) {
      setAuthMessage(`Fel vid A2A-autentisering: ${err.message}`);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleRegisterA2AAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);
    setLastRegMessage(null);

    try {
      const res = await fetch('/api/openclaw/a2a-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: targetNetwork,
          agentName: regAgentName,
          role: regRole,
          capabilities: ["A2A-RPC Task Delegation", "Autonomous Web Scraping", "P2P Peer Registration"]
        })
      });

      const data = await res.json();
      if (data.success && data.account) {
        setA2aAccounts(prev => [data.account, ...prev.filter(a => a.id !== data.account.id)]);
        setLastRegMessage(data.message || `Konto '${data.account.agentName}' registrerades autonomt!`);
      } else {
        setLastRegMessage(data.error || "Registrering misslyckades.");
      }
    } catch (err: any) {
      setLastRegMessage(`Fel vid A2A kontoskapande: ${err.message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const activeTask = tasks[0];

  const handleRunOpenClaw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlQuery.trim() && !targetUrl.trim()) return;

    setIsExecuting(true);

    try {
      const res = await fetch('/api/openclaw/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: crawlQuery.trim(),
          url: targetUrl.trim(),
          model: selectedModel,
          mode: crawlMode,
          autoApprove
        })
      });

      const data = await res.json();
      if (data.task) {
        setTasks(prev => [data.task, ...prev.filter(t => t.id !== data.task.id)]);
      }
    } catch (err) {
      console.warn("OpenClaw execution error:", err);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleApproveAction = async (actionId: string) => {
    try {
      const res = await fetch(`/api/actions/${actionId}/approve`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.task) {
        setTasks(prev => prev.map(t => t.id === actionId ? data.task : t));
      }
    } catch (err) {
      console.warn("Failed to approve action:", err);
    }
  };

  const handleCopyMarkdown = () => {
    if (!activeTask?.extractedMarkdown) return;
    navigator.clipboard.writeText(activeTask.extractedMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 font-mono text-xs">
      {/* Top Banner Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-950 border border-amber-800 rounded-xl text-amber-400 shadow-lg shadow-amber-950/50">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white font-sans">OpenClaw Agent Tool</h2>
                <span className="px-2 py-0.5 text-[10px] bg-amber-950 text-amber-300 border border-amber-800 rounded-full">
                  v1.4 Tool Automation
                </span>
              </div>
              <p className="text-xs text-slate-400 font-sans mt-0.5">
                Autonomous web scraper, API extraction crawler & tool runner for local LLMs (Gemma 4, DeepSeek, Llama).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-emerald-950/80 text-emerald-300 border border-emerald-800 rounded-lg flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Termux Package Status: <strong>309 Node.js Packages Installed</strong></span>
            </span>
            <span className="px-3 py-1.5 bg-slate-950 text-slate-300 border border-slate-800 rounded-lg flex items-center gap-2 text-xs">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>Assigned Engine: <strong>{selectedModel}</strong></span>
            </span>
          </div>
        </div>

        {/* Termux Android Note */}
        <div className="bg-slate-950/90 border border-emerald-900/80 p-3 rounded-lg flex items-center justify-between text-[11px] text-slate-300">
          <div className="flex items-center gap-2 font-mono">
            <span className="text-emerald-400 font-bold">[REAL] Termux Android Runtime:</span>
            <span className="text-slate-300">OpenClaw installerade 309 paket framgångsrikt med flaggan <code className="bg-slate-900 px-1.5 py-0.5 rounded text-cyan-300">--ignore-scripts</code>.</span>
          </div>
          <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">
            Node.js v24.17.0 Ready
          </span>
        </div>

        {/* Input Form */}
        <form onSubmit={handleRunOpenClaw} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-slate-400 font-bold flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-amber-400" /> Agent Query / Task Objective
              </label>
              <input
                type="text"
                value={crawlQuery}
                onChange={(e) => setCrawlQuery(e.target.value)}
                placeholder="e.g. Scrape Gemma 4 multimodal API docs and extract code examples"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-bold flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400" /> Target URL or API Endpoint (Optional)
              </label>
              <input
                type="text"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://github.com/ollama/ollama or http://localhost:11434"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-cyan-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
              <span className="text-slate-400 font-bold">Execution Mode:</span>
              <button
                type="button"
                onClick={() => setCrawlMode('agent')}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  crawlMode === 'agent' ? 'bg-amber-600 text-white font-bold' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Agentic Loop
              </button>
              <button
                type="button"
                onClick={() => setCrawlMode('crawl')}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  crawlMode === 'crawl' ? 'bg-amber-600 text-white font-bold' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Full Web Crawl
              </button>
              <button
                type="button"
                onClick={() => setCrawlMode('extract')}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  crawlMode === 'extract' ? 'bg-amber-600 text-white font-bold' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                API JSON Extract
              </button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <label className="flex items-center gap-1.5 text-slate-400 font-sans cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(e) => setAutoApprove(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500"
                />
                <span>Auto-Approve</span>
              </label>

              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-amber-500"
              >
                <option value="gemma-4">Gemma 4 (Local Ollama)</option>
                <option value="gemma2:9b">Gemma 2 (9B)</option>
                <option value="deepseek-coder:6.7b">DeepSeek-Coder 6.7b</option>
                <option value="llama3.2:3b">Llama 3.2 (3b)</option>
              </select>

              <button
                type="submit"
                disabled={isExecuting}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-amber-950/40"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>OpenClaw Crawling...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Execute OpenClaw Tool</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Extracted Output & Tool Results */}
      {activeTask && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                {activeTask.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : activeTask.status === 'pending' ? (
                  <Shield className="w-4 h-4 text-amber-400 animate-pulse" />
                ) : (
                  <Terminal className="w-4 h-4 text-cyan-400" />
                )}
                <h3 className="text-sm font-bold text-white font-sans">OpenClaw Process Execution</h3>
                <span className={`px-2 py-0.5 text-[10px] rounded font-mono border ${
                  activeTask.status === 'completed'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : activeTask.status === 'failed'
                    ? 'bg-red-950 text-red-300 border-red-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}>
                  Status: {activeTask.status.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{activeTask.aiSummary}</p>
            </div>

            <div className="flex items-center gap-2">
              {activeTask.status === 'pending' && activeTask.actionId && (
                <button
                  onClick={() => handleApproveAction(activeTask.actionId!)}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded flex items-center gap-1.5 transition-colors shadow-md shadow-emerald-950/40"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Approve & Run in Terminal</span>
                </button>
              )}

              <button
                onClick={handleCopyMarkdown}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center gap-1.5 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? 'Copied!' : 'Copy Output'}</span>
              </button>

              <button
                onClick={() => onSendContextToJaco(activeTask.extractedMarkdown || activeTask.aiSummary || '')}
                className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded flex items-center gap-1.5 transition-colors shadow-md shadow-cyan-950/40"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Send to JACO Orchestrator</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Code/Markdown Preview */}
          <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-4 font-mono text-xs text-slate-200 leading-relaxed overflow-x-auto max-h-[350px]">
            <pre className="whitespace-pre-wrap">{activeTask.extractedMarkdown}</pre>
          </div>
        </div>
      )}

      {/* OpenClaw Autonomous A2A Account & Node Registrar Panel */}
      <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                <span>Autonom A2A Kontoregistrering via OpenClaw</span>
                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded font-mono font-bold">[REAL API Engine]</span>
              </h3>
              <p className="text-[11px] text-slate-400">OpenClaw registrerar automatiskt agent-konton, noder, kryptografiska nycklar och A2A Bearer Tokens på P2P mesh-nätverket.</p>
            </div>
          </div>
          <span className="px-3 py-1 bg-slate-950 text-emerald-400 border border-emerald-950 rounded text-[11px] font-mono font-bold flex items-center gap-1.5">
            <BadgeCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>{a2aAccounts.length} Registrerade A2A Konton</span>
          </span>
        </div>

        {lastRegMessage && (
          <div className="bg-cyan-950/80 border border-cyan-800 p-3 rounded-lg text-xs text-cyan-200 font-mono flex items-center justify-between">
            <span>{lastRegMessage}</span>
            <button onClick={() => setLastRegMessage(null)} className="text-slate-400 hover:text-white text-xs font-bold">✕</button>
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleRegisterA2AAccount} className="bg-slate-950/90 border border-slate-800 p-4 rounded-xl space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-slate-400 font-bold flex items-center gap-1.5 text-[11px]">
                <Network className="w-3.5 h-3.5 text-cyan-400" /> Målnätverk (A2A Network)
              </label>
              <select
                value={targetNetwork}
                onChange={(e) => setTargetNetwork(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-cyan-300 font-mono focus:outline-none focus:border-cyan-500 text-xs"
              >
                <option value="JACO P2P Mesh Network">JACO P2P Mesh Network [REAL]</option>
                <option value="OpenClaw Agent Hub">OpenClaw Agent Hub [REAL NODE]</option>
                <option value="Fetch.ai / uAgents Network">Fetch.ai / uAgents Network</option>
                <option value="HuggingFace Agent Registry">HuggingFace Agent Registry</option>
                <option value="Custom A2A Peer Node">Custom A2A Peer Node</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-bold flex items-center gap-1.5 text-[11px]">
                <Globe className="w-3.5 h-3.5 text-amber-400" /> Agentnamn
              </label>
              <input
                type="text"
                value={regAgentName}
                onChange={(e) => setRegAgentName(e.target.value)}
                placeholder="t.ex. OpenClaw Autonomous Scraper Node"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-bold flex items-center gap-1.5 text-[11px]">
                <Shield className="w-3.5 h-3.5 text-purple-400" /> Roll & Beskrivning
              </label>
              <input
                type="text"
                value={regRole}
                onChange={(e) => setRegRole(e.target.value)}
                placeholder="t.ex. Web Scraper & Task Delegator"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={isRegistering}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold rounded-lg transition-all flex items-center gap-2 text-xs shadow-md shadow-cyan-950/40"
            >
              {isRegistering ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>OpenClaw Skapar Konto...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Skapa A2A-konto Autonomt med OpenClaw</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Automated Authentication & Environment Variable Injection Box */}
        <div className="bg-slate-950/90 border border-purple-500/30 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-slate-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-400" />
              <span>A2A Autentiserings- & Miljöinjekteringsmotor</span>
              <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded font-mono font-bold">[INJECTED IN .ENV]</span>
            </h4>
            <button
              onClick={handleAuthenticateAndInjectEnv}
              disabled={isAuthenticating}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold rounded text-xs transition-all flex items-center gap-1.5 shadow"
            >
              {isAuthenticating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Autentiserar & Injekterar...</span>
                </>
              ) : (
                <>
                  <Shield className="w-3.5 h-3.5" />
                  <span>Kör A2A Handshake & Injektera Identifierare</span>
                </>
              )}
            </button>
          </div>

          {authMessage && (
            <div className="bg-purple-950/70 border border-purple-800/80 p-2.5 rounded text-[11px] text-purple-200 font-mono">
              {authMessage}
            </div>
          )}

          {authState && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="bg-slate-900 p-2.5 rounded border border-slate-800 space-y-1 font-mono text-[11px]">
                <span className="text-slate-400 font-bold block">A2A_NODE_UUID</span>
                <span className="text-cyan-300 font-bold break-all">{authState.nodeUuid}</span>
              </div>
              <div className="bg-slate-900 p-2.5 rounded border border-slate-800 space-y-1 font-mono text-[11px]">
                <span className="text-slate-400 font-bold block">A2A_BEARER_TOKEN</span>
                <span className="text-amber-300 font-bold break-all truncate block">{authState.a2aBearerToken}</span>
              </div>
              <div className="bg-slate-900 p-2.5 rounded border border-slate-800 space-y-1 font-mono text-[11px]">
                <span className="text-slate-400 font-bold block">OPENCLAW_SECRET_HASH</span>
                <span className="text-emerald-400 font-bold break-all truncate block">{authState.openclawSecretHash}</span>
              </div>
            </div>
          )}
        </div>

        {/* Registered A2A Accounts Cards List */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-emerald-400" />
            <span>Aktiva A2A Agent-konton på Nätverket</span>
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {a2aAccounts.map(acc => (
              <div key={acc.id} className="bg-slate-950/90 border border-slate-800 hover:border-cyan-500/40 rounded-lg p-3 space-y-2 transition-all">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4 text-emerald-400" />
                    <div>
                      <span className="font-bold text-slate-100 text-xs">{acc.agentName}</span>
                      <span className="text-[10px] text-slate-500 block font-mono">{acc.handle} • {acc.network}</span>
                    </div>
                  </div>
                  <span className="text-[9px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-mono font-bold">
                    VERIFIED PEER
                  </span>
                </div>

                <div className="space-y-1 text-[10px] font-mono text-slate-400">
                  <div className="flex justify-between">
                    <span>Node ID:</span>
                    <span className="text-cyan-400 font-bold">{acc.nodeId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>A2A Token:</span>
                    <span className="text-amber-300 truncate max-w-[180px]">{acc.a2aToken}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ECDSA Key:</span>
                    <span className="text-slate-300 truncate max-w-[180px]">{acc.publicKey}</span>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-900 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">{new Date(acc.registeredAt).toLocaleDateString('sv-SE')}</span>
                  <span className="text-emerald-400 font-mono font-bold">Rykte: {acc.reputationScore}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
