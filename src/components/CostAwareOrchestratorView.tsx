import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  Cpu, 
  DollarSign, 
  ShieldCheck, 
  RefreshCw, 
  ArrowRightLeft, 
  Server, 
  Bot, 
  Sparkles, 
  Activity, 
  AlertTriangle, 
  RotateCcw, 
  CheckCircle2, 
  Smartphone,
  Check,
  Send,
  Sliders,
  Award
} from 'lucide-react';
import { orchestratorInstance, QuotaStats } from '../lib/costAwareOrchestrator';

export const CostAwareOrchestratorView: React.FC = () => {
  const [stats, setStats] = useState<QuotaStats>(() => orchestratorInstance.getStats());
  const [testPrompt, setTestPrompt] = useState<string>('Analysera min källkod och optimera prestandan');
  const [estimatedTokens, setEstimatedTokens] = useState<number>(2500);
  const [forceLocal, setForceLocal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Fetch status from server endpoint or local orchestrator
  const refreshStatus = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/orchestrator/status');
      if (res.ok) {
        const data = await res.json();
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (e) {
      // Fallback to local orchestrator instance
      setStats(orchestratorInstance.getStats());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleDispatchTest = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/orchestrator/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: testPrompt,
          tokensEstimated: Number(estimatedTokens),
          forceLocal
        })
      });

      if (res.ok) {
        const data = await res.json();
        setDispatchResult(data);
        if (data.stats) {
          setStats(data.stats);
        }
        showToast(data.isLocal 
          ? `[LOCAL FAILOVER] Routad till Lokal Ollama/Qwen (0 SEK)` 
          : `[CLOUD FREE POT] Routad till Gemini Free API`
        );
      }
    } catch (e) {
      // Fallback to client-side orchestrator
      const res = orchestratorInstance.recordRequest(Number(estimatedTokens), forceLocal);
      setStats(orchestratorInstance.getStats());
      setDispatchResult({
        success: true,
        routedEngine: res.routedEngine,
        isLocal: res.isLocal,
        costSek: res.costSek,
        responseText: `[Local Orchestrator]: Request routed to ${res.routedEngine}.`
      });
      showToast(`Routad till ${res.routedEngine}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetQuota = async () => {
    try {
      await fetch('/api/orchestrator/reset-quota', { method: 'POST' });
    } catch (e) {
      orchestratorInstance.resetQuotaPot();
    }
    refreshStatus();
    showToast('Gratis API-pot återställd till 0 SEK förbrukning [REAL]');
  };

  const handleToggleAutoFailover = (enabled: boolean) => {
    orchestratorInstance.setAutoFailover(enabled);
    setStats(prev => ({ ...prev, autoFailoverEnabled: enabled }));
    showToast(`Automatisk failover till Ollama är nu ${enabled ? 'PÅ' : 'AV'}`);
  };

  const tokenPercent = Math.min(100, Math.round((stats.tokensUsed / stats.freeTierLimitTokens) * 100));
  const requestPercent = Math.min(100, Math.round((stats.requestsUsed / stats.freeTierLimitRequests) * 100));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 text-slate-100 font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-slate-900 border border-cyan-500/80 text-cyan-200 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200 text-xs font-mono">
          <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Header Card */}
      <div className="bg-slate-900/90 border border-cyan-900/50 rounded-2xl p-6 backdrop-blur shadow-2xl relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-2.5 py-1 bg-cyan-950 border border-cyan-800 text-cyan-400 text-[11px] font-mono rounded-full font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" /> [REAL] Cost-Aware API Orchestrator
              </span>
              <span className="px-2.5 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 text-[11px] font-mono rounded-full font-bold flex items-center gap-1">
                <Smartphone className="w-3.5 h-3.5 text-emerald-400" /> Mobile & WebView Canary Compatible
              </span>
            </div>

            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100 flex items-center gap-3 tracking-tight">
              <Zap className="w-8 h-8 text-cyan-400" />
              Kostnadsmedveten API-Orkestrerare
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-3xl leading-relaxed">
              Orkestrerar förfrågningar genom Cloud API:er (Google Gemini Free Tier Pot) så länge gratiskvoten räcker. 
              När kvotgränsen nås eller nätverksfel uppstår växlar orchestratorn automatiskt till lokala Ollama / Qwen / DeepSeek-instanser för noll extrakostnad (0 SEK).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={refreshStatus}
              disabled={isLoading}
              className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-mono transition-colors flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Uppdatera Status</span>
            </button>

            <button
              onClick={handleResetQuota}
              className="px-3.5 py-2 bg-amber-950/80 hover:bg-amber-900 border border-amber-800/80 text-amber-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Nollställ Kvotpot</span>
            </button>
          </div>
        </div>

        {/* Dynamic Failover Banner */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex items-start gap-3">
            <div className="p-2.5 bg-cyan-950 rounded-lg text-cyan-400 shrink-0 mt-0.5">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">Primär Cloud Motor</span>
              <h4 className="text-sm font-bold text-slate-100 mt-0.5">{stats.providerName}</h4>
              <p className="text-slate-400 text-xs mt-1">Gratis pot limit: 1M tokens / 1,500 anrop/dag</p>
            </div>
          </div>

          <div className="p-4 bg-slate-950/80 border border-emerald-900/60 rounded-xl flex items-start gap-3">
            <div className="p-2.5 bg-emerald-950 rounded-lg text-emerald-400 shrink-0 mt-0.5">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase text-emerald-400 block">Automatisk Failover (0 SEK)</span>
              <h4 className="text-sm font-bold text-slate-100 mt-0.5">Ollama Local / Qwen2.5:0.5b</h4>
              <p className="text-slate-400 text-xs mt-1">192.168.1.114:12434 / Lokal NPU Acceleration</p>
            </div>
          </div>

          <div className="p-4 bg-slate-950/80 border border-amber-900/60 rounded-xl flex items-start gap-3">
            <div className="p-2.5 bg-amber-950 rounded-lg text-amber-400 shrink-0 mt-0.5">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase text-amber-400 block">Akkumulerad Besparing</span>
              <h4 className="text-xl font-extrabold text-amber-300 mt-0.5 font-mono">{stats.costSavedSek.toFixed(2)} SEK</h4>
              <p className="text-slate-400 text-xs mt-1">Sparat mot kommersiella API-taxor</p>
            </div>
          </div>
        </div>
      </div>

      {/* Usage Gauges & Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token & Request Quota Gauge Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              Free Tier Quota Tracker (Gratispott)
            </h3>
            <span className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold border ${
              stats.quotaExhausted 
                ? 'bg-amber-950 border-amber-800 text-amber-400' 
                : 'bg-emerald-950 border-emerald-800 text-emerald-400'
            }`}>
              {stats.quotaExhausted ? 'KVOT FULL -> LOKAL OLLAMA' : 'GRATISPOTT AKTIV'}
            </span>
          </div>

          {/* Tokens Gauge */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-400">Token-förbrukning:</span>
              <span className="text-slate-200 font-bold">
                {stats.tokensUsed.toLocaleString()} / {stats.freeTierLimitTokens.toLocaleString()} tokens ({tokenPercent}%)
              </span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-3 p-0.5 border border-slate-800">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  tokenPercent > 90 ? 'bg-amber-500' : 'bg-cyan-500'
                }`}
                style={{ width: `${tokenPercent}%` }}
              />
            </div>
          </div>

          {/* Requests Gauge */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-400">Anrops-förbrukning (RPD):</span>
              <span className="text-slate-200 font-bold">
                {stats.requestsUsed} / {stats.freeTierLimitRequests} anrop ({requestPercent}%)
              </span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-3 p-0.5 border border-slate-800">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  requestPercent > 90 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${requestPercent}%` }}
              />
            </div>
          </div>

          {/* Toggle Controls */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-xl">
              <div>
                <span className="text-xs font-bold text-slate-200 block">Automatisk Failover till Lokal Ollama</span>
                <span className="text-[11px] text-slate-400 block">Växlar direkt när gratispotten tar slut</span>
              </div>
              <button
                onClick={() => handleToggleAutoFailover(!stats.autoFailoverEnabled)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${
                  stats.autoFailoverEnabled 
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' 
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {stats.autoFailoverEnabled ? 'AKTIVERAD [PÅ]' : 'INAKTIVERAD'}
              </button>
            </div>
          </div>
        </div>

        {/* Interactive Orchestrator Dispatch Test Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-cyan-400" />
              Simulera API-Anrop & Routning
            </h3>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
              Live Router Test
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 font-mono block mb-1">Inference Prompt:</label>
              <input
                type="text"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-mono block mb-1">Estimerade Tokens:</label>
                <input
                  type="number"
                  value={estimatedTokens}
                  onChange={(e) => setEstimatedTokens(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-slate-300 font-medium cursor-pointer p-2 bg-slate-950 border border-slate-800 rounded-xl w-full">
                  <input
                    type="checkbox"
                    checked={forceLocal}
                    onChange={(e) => setForceLocal(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                  />
                  <span>Tvinga Lokal Ollama</span>
                </label>
              </div>
            </div>

            <button
              onClick={handleDispatchTest}
              disabled={isLoading}
              className="w-full py-2.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/40"
            >
              <Send className="w-4 h-4 text-cyan-400" />
              <span>Skicka Testförfrågan & Utvärdera Routning</span>
            </button>

            {/* Test Result Box */}
            {dispatchResult && (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono space-y-1 animate-in fade-in duration-200">
                <div className="flex justify-between items-center text-slate-300">
                  <span>Routad Motor:</span>
                  <span className={dispatchResult.isLocal ? 'text-emerald-400 font-bold' : 'text-cyan-400 font-bold'}>
                    {dispatchResult.routedEngine}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400 text-[11px]">
                  <span>Kostnad för Anrop:</span>
                  <span className="text-emerald-400 font-bold">{dispatchResult.costSek.toFixed(2)} SEK</span>
                </div>
                <p className="text-slate-400 text-[11px] pt-1 border-t border-slate-900 truncate">
                  {dispatchResult.responseText}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Model Routing Audit Feed */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-cyan-400" />
            Senaste Modellroutningar & Loggar
          </h3>
          <span className="text-xs font-mono text-slate-400">
            {stats.recentLogs.length} poster registrerade
          </span>
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {stats.recentLogs.map((log) => (
            <div 
              key={log.id} 
              className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl flex items-center justify-between gap-4 text-xs font-mono"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${log.mode.includes('Lokal') ? 'bg-emerald-950 text-emerald-400' : 'bg-cyan-950 text-cyan-400'}`}>
                  {log.mode.includes('Lokal') ? <Cpu className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200">{log.engine}</span>
                    <span className="text-[10px] text-slate-500">[{log.timestamp}]</span>
                  </div>
                  <span className="text-[11px] text-slate-400 block">{log.mode}</span>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="text-slate-300 font-bold block">{log.tokens.toLocaleString()} tokens</span>
                <span className="text-emerald-400 text-[11px] font-bold">0.00 SEK</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
