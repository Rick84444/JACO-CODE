import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Zap, Play, CheckCircle2, Clock, XCircle, AlertTriangle,
  Send, Share2, Code2, Copy, Check, Shield, Coins, Bot, Terminal, ExternalLink,
  ChevronRight, ArrowUpRight, Search, Filter, Cpu, Layers, Globe, Network, Compass,
  Sliders, Pause, Plus, Radio, Server
} from 'lucide-react';

export interface A2ATaskArtifactPart {
  type: 'data' | 'text';
  data?: any;
  text?: string;
}

export interface A2ATaskArtifact {
  parts: A2ATaskArtifactPart[];
  index: number;
  lastChunk: boolean;
}

export interface A2ATask {
  id: string;
  skill: string;
  status: {
    state: 'working' | 'completed' | 'failed' | 'canceled';
    message?: string;
  };
  created_at: number;
  artifacts?: A2ATaskArtifact[];
}

export interface A2AAgentCard {
  name: string;
  version: string;
  description: string;
  url: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  skills: {
    id: string;
    name: string;
    description: string;
    inputModes: string[];
    outputModes: string[];
  }[];
}

export interface DiscoveredA2APathway {
  id: string;
  name: string;
  endpoint: string;
  sourceMarket: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  skills: { id: string; name: string; description: string; priceUsdc?: number }[];
  latencyMs: number;
  reliabilityScore: number;
  status: 'ACTIVE' | 'VERIFIED' | 'UNREACHABLE';
  lastDiscovered: string;
  protocol: 'A2A v1.0' | 'JSON-RPC 2.0' | 'uAgents';
}

export interface ScraperLogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface ScraperStatusData {
  isEnabled: boolean;
  intervalMinutes: number;
  lastScanTime: string | null;
  nextScanTime: string | null;
  seedTargets: { name: string; url: string; market: string }[];
  discoveredPathways: DiscoveredA2APathway[];
  logs: ScraperLogEntry[];
}

export const A2AWorkflowDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tasks' | 'scraper' | 'monetization' | 'autoconnector'>('autoconnector');
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [agentCard, setAgentCard] = useState<A2AAgentCard | null>(null);
  const [selectedTask, setSelectedTask] = useState<A2ATask | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Scraper Sub-Agent State
  const [scraperStatus, setScraperStatus] = useState<ScraperStatusData | null>(null);
  const [isScrapingNow, setIsScrapingNow] = useState<boolean>(false);
  const [pingStatusMap, setPingStatusMap] = useState<Record<string, string>>({});
  const [showAddSeedModal, setShowAddSeedModal] = useState<boolean>(false);
  const [newSeedName, setNewSeedName] = useState<string>('');
  const [newSeedUrl, setNewSeedUrl] = useState<string>('');
  const [newSeedMarket, setNewSeedMarket] = useState<string>('Custom A2A Mesh');

  // Auto API Connector Agent State
  const [connectorsList, setConnectorsList] = useState<any[]>([]);
  const [autoTargetName, setAutoTargetName] = useState<string>('');
  const [autoTargetUrl, setAutoTargetUrl] = useState<string>('');
  const [autoAuthType, setAutoAuthType] = useState<string>('Auto-Detect Bearer/API-Key');
  const [isCreatingConnector, setIsCreatingConnector] = useState<boolean>(false);
  const [testProxyResult, setTestProxyResult] = useState<any | null>(null);

  // Task creation form state
  const [showDispatchModal, setShowDispatchModal] = useState<boolean>(false);
  const [selectedSkill, setSelectedSkill] = useState<string>('skyfire_pay');
  const [customTaskId, setCustomTaskId] = useState<string>('');
  const [customPayloadJson, setCustomPayloadJson] = useState<string>(
    JSON.stringify({ amount_usdc: 1.5, buyer_tag: 'A2A-Client-Node' }, null, 2)
  );
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchConnectors = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/connectors');
      if (res.ok) {
        const data = await res.json();
        if (data.connectors) setConnectorsList(data.connectors);
      }
    } catch (err) {
      console.error("Error fetching connectors:", err);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const handleCreateAutoConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoTargetUrl.trim()) return;

    setIsCreatingConnector(true);
    try {
      const res = await fetch('/api/integrations/auto-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: autoTargetName.trim(),
          targetUrl: autoTargetUrl.trim(),
          authType: autoAuthType
        })
      });
      if (res.ok) {
        const data = await res.json();
        await fetchConnectors();
        setAutoTargetName('');
        setAutoTargetUrl('');
        setTestProxyResult(data);
      }
    } catch (err) {
      console.error("Failed to create auto-connector:", err);
    } finally {
      setIsCreatingConnector(false);
    }
  };

  const handleTestProxyRoute = async (connectorId: string) => {
    try {
      const res = await fetch(`/api/integrations/proxy/${connectorId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testMessage: "Ping from Autonomous API Agent", timestamp: Date.now() })
      });
      if (res.ok) {
        const data = await res.json();
        setTestProxyResult(data);
      }
    } catch (err) {
      console.error("Error testing proxy route:", err);
    }
  };

  // Fetch AgentCard Discovery
  const fetchAgentCard = useCallback(async () => {
    try {
      const res = await fetch('/.well-known/agent.json');
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        setAgentCard(data);
      }
    } catch (err) {
      console.error('Error fetching AgentCard:', err);
    }
  }, []);

  // Poll tasks via A2A endpoint or GET /api/a2a/tasks
  const fetchTasks = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const rpcRes = await fetch('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `req-${Date.now()}`,
          method: 'tasks/list',
          params: {}
        })
      });

      const rpcCt = rpcRes.headers.get('content-type') || '';
      if (rpcRes.ok && rpcCt.includes('application/json')) {
        const rpcData = await rpcRes.json();
        if (rpcData?.result?.tasks && Array.isArray(rpcData.result.tasks)) {
          setTasks(rpcData.result.tasks);
          setLastUpdated(new Date());
          setIsRefreshing(false);
          return;
        }
      }

      const getRes = await fetch('/api/a2a/tasks');
      const getCt = getRes.headers.get('content-type') || '';
      if (getRes.ok && getCt.includes('application/json')) {
        const getData = await getRes.json();
        if (getData?.tasks && Array.isArray(getData.tasks)) {
          setTasks(getData.tasks);
          setLastUpdated(new Date());
        }
      }
    } catch (err: any) {
      // Gracefully handle network disconnects during server restart
      if (err?.name !== 'AbortError') {
        console.warn('A2A tasks polling temporarily unavailable:', err?.message || err);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Fetch Scraper Status
  const fetchScraperStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/a2a/scraper/status');
      if (res.ok) {
        const data = await res.json();
        setScraperStatus(data);
      }
    } catch (err: any) {
      // Gracefully handle network disconnects during server restart
      if (err?.name !== 'AbortError') {
        console.warn('Scraper status fetch temporarily unavailable:', err?.message || err);
      }
    }
  }, []);

  // Trigger manual scrape
  const handleTriggerScrapeNow = async () => {
    setIsScrapingNow(true);
    try {
      const res = await fetch('/api/a2a/scraper/trigger', { method: 'POST' });
      if (res.ok) {
        await fetchScraperStatus();
      }
    } catch (err) {
      console.error('Failed to trigger scrape:', err);
    } finally {
      setIsScrapingNow(false);
    }
  };

  // Toggle or update scraper config
  const handleConfigScraper = async (isEnabled?: boolean, intervalMinutes?: number) => {
    try {
      const res = await fetch('/api/a2a/scraper/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled, intervalMinutes })
      });
      if (res.ok) {
        await fetchScraperStatus();
      }
    } catch (err) {
      console.error('Error updating scraper config:', err);
    }
  };

  // Add new seed target
  const handleAddSeedTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSeedUrl.trim()) return;

    try {
      const res = await fetch('/api/a2a/scraper/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newSeedTarget: {
            name: newSeedName.trim() || 'Anpassad A2A Nod',
            url: newSeedUrl.trim(),
            market: newSeedMarket.trim()
          }
        })
      });
      if (res.ok) {
        await fetchScraperStatus();
        setShowAddSeedModal(false);
        setNewSeedName('');
        setNewSeedUrl('');
      }
    } catch (err) {
      console.error('Error adding seed target:', err);
    }
  };

  // Ping a discovered pathway
  const handlePingPathway = async (pathwayId: string) => {
    setPingStatusMap(prev => ({ ...prev, [pathwayId]: 'pinging' }));
    try {
      const res = await fetch('/api/a2a/scraper/ping-pathway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathwayId })
      });
      if (res.ok) {
        const data = await res.json();
        setPingStatusMap(prev => ({ ...prev, [pathwayId]: `OK (${data.handshake.latencyMs}ms)` }));
        await fetchScraperStatus();
      } else {
        setPingStatusMap(prev => ({ ...prev, [pathwayId]: 'FEL' }));
      }
    } catch (err) {
      setPingStatusMap(prev => ({ ...prev, [pathwayId]: 'Nätverksfel' }));
    }
  };

  // Initial load and polling interval setup
  useEffect(() => {
    fetchAgentCard();
    fetchTasks();
    fetchScraperStatus();
  }, [fetchAgentCard, fetchTasks, fetchScraperStatus]);

  useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(() => {
      fetchTasks();
      fetchScraperStatus();
    }, 4000);
    return () => clearInterval(interval);
  }, [isPolling, fetchTasks, fetchScraperStatus]);

  // Handle skill select preset payload updates
  const handleSkillChange = (skillId: string) => {
    setSelectedSkill(skillId);
    if (skillId === 'skyfire_pay') {
      setCustomPayloadJson(JSON.stringify({ amount_usdc: 1.5, buyer_tag: 'A2A-Client-Node', seller_service_id: '7b6e0f43-c64b-4a06-a4cd-e8d3bd6c5290' }, null, 2));
    } else if (skillId === 'create_payment') {
      setCustomPayloadJson(JSON.stringify({ name: 'JACO Premium Agent Skill', description: 'A2A P2P License', amount_sek: 150 }, null, 2));
    } else if (skillId === 'readiness_score') {
      setCustomPayloadJson(JSON.stringify({ scores: { architecture: 95, functionality: 92, stability: 90, security: 98, testing: 88 } }, null, 2));
    } else if (skillId === 'completion_model') {
      setCustomPayloadJson(JSON.stringify({ scores: { architecture: 90, functionality: 88, stability: 92, security: 95, testing: 85 } }, null, 2));
    } else if (skillId === 'delegate_to_broker') {
      setCustomPayloadJson(JSON.stringify({ task: 'Analysera källkod för prestandaläckor och typfel i runtime', answer: 'Godkänd för exekvering' }, null, 2));
    } else {
      setCustomPayloadJson(JSON.stringify({ text: 'Test diagnostics message' }, null, 2));
    }
  };

  // Dispatch new task via JSON-RPC tasks/send
  const handleDispatchTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setDispatchStatus(null);

    let parsedData = {};
    try {
      parsedData = JSON.parse(customPayloadJson);
    } catch {
      setDispatchStatus('Fel: Ogiltig JSON-nyttolast.');
      setIsSubmitting(false);
      return;
    }

    const payload = {
      jsonrpc: '2.0',
      id: `req-${Date.now()}`,
      method: 'tasks/send',
      params: {
        id: customTaskId.trim() || `a2a-${Date.now().toString(36)}`,
        skill: selectedSkill,
        message: {
          parts: [
            {
              type: 'data',
              data: parsedData
            }
          ]
        }
      }
    };

    try {
      const res = await fetch('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.result) {
          setDispatchStatus(`[REAL] Uppgift dispatchad framgångsrikt (ID: ${data.result.id})`);
          fetchTasks();
          setTimeout(() => {
            setShowDispatchModal(false);
            setDispatchStatus(null);
            setCustomTaskId('');
          }, 1200);
        } else if (data.error) {
          setDispatchStatus(`Fel: ${data.error.message}`);
        }
      } else {
        setDispatchStatus(`HTTP-fel: ${res.status}`);
      }
    } catch (err: any) {
      setDispatchStatus(`Nätverksfel: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel task via JSON-RPC tasks/cancel
  const handleCancelTask = async (taskId: string) => {
    try {
      const res = await fetch('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `req-cancel-${Date.now()}`,
          method: 'tasks/cancel',
          params: { id: taskId }
        })
      });
      if (res.ok) {
        fetchTasks();
        if (selectedTask?.id === taskId) {
          setSelectedTask(prev => prev ? { ...prev, status: { state: 'canceled' } } : null);
        }
      }
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter tasks
  const filteredTasks = tasks.filter(t => {
    const matchesSearch = t.id.toLowerCase().includes(searchFilter.toLowerCase()) ||
                          t.skill.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status.state === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const workingCount = tasks.filter(t => t.status.state === 'working').length;
  const completedCount = tasks.filter(t => t.status.state === 'completed').length;

  return (
    <div className="space-y-6 font-sans">
      {/* HEADER & OVERVIEW BAR */}
      <div className="bg-slate-900/90 border border-cyan-900/80 rounded-xl p-5 shadow-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />
              <h2 className="text-lg font-bold text-slate-100 font-mono tracking-wide flex items-center gap-2">
                <span>Google Agent-to-Agent (A2A) Marknads- & Telemetrinod</span>
                <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800/80 px-2 py-0.5 rounded font-bold">
                  [REAL] A2A v1.0
                </span>
              </h2>
            </div>
            <p className="text-xs text-slate-300">
              Autonom tidsbaserad webb-scraping mot A2A-marknader, automatisk vägupptäckning och P2P JSON-RPC 2.0 dispatching.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsPolling(!isPolling)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 border transition-all ${
                isPolling
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800 hover:bg-emerald-900/80'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isPolling ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
              <span>{isPolling ? 'Live Telemetri Aktiv' : 'Pausad'}</span>
            </button>

            <button
              onClick={() => { fetchTasks(); fetchScraperStatus(); }}
              disabled={isRefreshing}
              className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Uppdatera</span>
            </button>

            <button
              onClick={() => setShowDispatchModal(true)}
              className="px-4 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-mono font-bold text-xs rounded-lg shadow-[0_0_15px_rgba(34,211,238,0.3)] flex items-center gap-1.5 transition-all"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Skicka A2A Uppgift</span>
            </button>
          </div>
        </div>

        {/* SUB-NAVIGATION TABS */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
          <button
            onClick={() => setActiveTab('autoconnector')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeTab === 'autoconnector'
                ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>🔌 Autonom API- & Integrationsagent ({connectorsList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('scraper')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeTab === 'scraper'
                ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>🕸️ Autonom Webb-Scraper & A2A-Marknadsvägar ({scraperStatus?.discoveredPathways?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('tasks')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeTab === 'tasks'
                ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>⚡ A2A Uppgifter & Telemetrilogg ({tasks.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('monetization')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeTab === 'monetization'
                ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Coins className="w-4 h-4" />
            <span>💰 Lågkostnad & Monetisering ({agentCard?.skills?.length || 5} Skills)</span>
          </button>
        </div>
      </div>

      {/* DISCOVERY & AGENTCARD BANNER */}
      {agentCard && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 font-mono text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-400" />
              <span className="font-bold text-slate-200">{agentCard.name} (v{agentCard.version})</span>
              <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded">
                /.well-known/agent.json
              </span>
            </div>
            <p className="text-slate-400 font-sans text-xs">{agentCard.description}</p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/.well-known/agent.json"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded flex items-center gap-1 text-[11px] font-bold transition-colors"
            >
              <span>AgentCard Manifest</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>

            <button
              onClick={() => copyToClipboard(agentCard.url, 'agent-url')}
              className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded flex items-center gap-1 text-[11px] font-bold transition-colors"
            >
              {copiedId === 'agent-url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-cyan-400" />}
              <span>Kopiera Endpoint</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 0: AUTONOMOUS API & INTEGRATION AGENT */}
      {activeTab === 'autoconnector' && (
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                    <span>Autonom API- & Integrationsagent (Zero-Config Connector)</span>
                    <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-bold">
                      [REAL] Autonom Binding Aktiv
                    </span>
                  </h3>
                </div>
                <p className="text-xs text-slate-400">
                  Bygger och binder Express API-proxyrutter i bakgrunden utan att du behöver skriva manuella konfigurationer eller nyckelhantering.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchConnectors}
                  className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono font-bold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Uppdatera Kopplingar</span>
                </button>
              </div>
            </div>

            {/* Form to create new automatic API connector */}
            <form onSubmit={handleCreateAutoConnector} className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold font-mono text-slate-200 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Skapa Ny Autonom API-Koppling (Zero Manual Setup)</span>
                </span>
                <span className="text-[10px] font-mono text-slate-500">Auto-Genererar Proxy & Header Injection</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-slate-400 font-bold block">Tjänst / API Namn:</label>
                  <input
                    type="text"
                    placeholder="t.ex. Stripe, Weather API, Webhook"
                    value={autoTargetName}
                    onChange={(e) => setAutoTargetName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-slate-400 font-bold block">Mål-URL / API Endpoint:</label>
                  <input
                    type="url"
                    placeholder="https://api.example.com/v1/data"
                    value={autoTargetUrl}
                    onChange={(e) => setAutoTargetUrl(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-slate-400 font-bold block">Autentiserings-strategi:</label>
                  <select
                    value={autoAuthType}
                    onChange={(e) => setAutoAuthType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Auto-Detect Bearer/API-Key">Auto-Detect Bearer / API-Key</option>
                    <option value="Vault Key Proxy">Vault Key Proxy (Aura Secret Storage)</option>
                    <option value="A2A Signed Token">A2A Signed Token (P2P Mesh)</option>
                    <option value="No Auth (Public Endpoint)">No Auth (Public Endpoint)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isCreatingConnector || !autoTargetUrl.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-mono font-bold text-xs rounded-lg shadow-lg flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isCreatingConnector ? 'Genererar Proxy...' : 'Skapa & Bind Autonom API-Koppling'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Active Connectors List */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Network className="w-4 h-4 text-cyan-400" />
                <span>Registrerade Autonoma API-Proxy-Routes ({connectorsList.length})</span>
              </h4>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {connectorsList.map((conn) => (
                <div key={conn.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2 hover:border-slate-700 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold font-mono text-slate-200 text-sm">{conn.name}</span>
                      <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-mono font-bold">
                        [REAL] {conn.status}
                      </span>
                      <span className="text-[10px] bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded font-mono">
                        {conn.protocol}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTestProxyRoute(conn.id)}
                        className="px-3 py-1 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 text-xs font-mono font-bold rounded flex items-center gap-1 transition-colors"
                      >
                        <Zap className="w-3 h-3" />
                        <span>Testa Proxy Route</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-slate-400 pt-1 border-t border-slate-900">
                    <div>
                      <span className="text-slate-500">Mål Endpoint: </span>
                      <span className="text-slate-300 break-all">{conn.targetUrl}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Auto-Genererad Proxy Route: </span>
                      <span className="text-cyan-400 font-bold">{conn.autoGeneratedProxyRoute}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Auth typ: </span>
                      <span className="text-slate-300">{conn.authType}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Latens: </span>
                      <span className="text-emerald-400">{conn.latencyMs} ms</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Test Proxy Result Panel */}
          {testProxyResult && (
            <div className="bg-slate-900/90 border border-cyan-500/40 rounded-xl p-5 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-cyan-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Verifierad Autonom API-Testning Response</span>
                </span>
                <button onClick={() => setTestProxyResult(null)} className="text-slate-400 hover:text-slate-200">
                  ✕
                </button>
              </div>

              <pre className="bg-slate-950 p-3 rounded-lg text-emerald-300 font-mono text-xs overflow-x-auto border border-slate-800">
                {JSON.stringify(testProxyResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: AUTONOMOUS WEB-SCRAPER & MARKET PATHWAYS */}
      {activeTab === 'scraper' && (
        <div className="space-y-6">
          {/* SCRAPER CONTROLS & STATUS CARD */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Compass className="w-5 h-5 text-cyan-400 animate-spin" style={{ animationDuration: '10s' }} />
                  <h3 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                    <span>Autonom A2A Scraper-Agent (Tidsbaserad Huvudslinga)</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                      scraperStatus?.isEnabled
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}>
                      {scraperStatus?.isEnabled ? '[REAL] AKTIV SCHEDULER' : 'PAUSAD'}
                    </span>
                  </h3>
                </div>
                <p className="text-xs text-slate-400">
                  Scrapar automatiskt A2A-register, Google A2A Manifest, Skyfire noder, HuggingFace Agent Hub & GitHub A2A källor.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleConfigScraper(!scraperStatus?.isEnabled)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 border transition-all ${
                    scraperStatus?.isEnabled
                      ? 'bg-amber-950/80 text-amber-300 border-amber-800 hover:bg-amber-900'
                      : 'bg-emerald-950/80 text-emerald-300 border-emerald-800 hover:bg-emerald-900'
                  }`}
                >
                  {scraperStatus?.isEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{scraperStatus?.isEnabled ? 'Pausa Autonom Scraper' : 'Starta Autonom Scraper'}</span>
                </button>

                <button
                  onClick={handleTriggerScrapeNow}
                  disabled={isScrapingNow}
                  className="px-4 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-slate-950 font-mono font-bold text-xs rounded-lg shadow-lg flex items-center gap-1.5 transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScrapingNow ? 'animate-spin' : ''}`} />
                  <span>{isScrapingNow ? 'Scrapar Nu...' : 'Kör Scraper Nu'}</span>
                </button>

                <button
                  onClick={() => setShowAddSeedModal(true)}
                  className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono font-bold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Lägg till Seed Target</span>
                </button>
              </div>
            </div>

            {/* METRICS & TIMING */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Senaste Scrape-körning</span>
                <span className="font-bold text-cyan-300 text-sm mt-0.5 block">
                  {scraperStatus?.lastScanTime || 'Nyss'}
                </span>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Nästa Autonoma Körning</span>
                <span className="font-bold text-amber-300 text-sm mt-0.5 block flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>{scraperStatus?.nextScanTime || 'Om 15m'}</span>
                </span>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Vald Intervall</span>
                <div className="flex items-center gap-1 mt-1">
                  {[5, 15, 30, 60].map(mins => (
                    <button
                      key={mins}
                      onClick={() => handleConfigScraper(undefined, mins)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        scraperStatus?.intervalMinutes === mins
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase">Identifierade A2A-Vägar</span>
                <span className="font-bold text-emerald-300 text-sm mt-0.5 block">
                  {scraperStatus?.discoveredPathways?.length || 0} Aktiva Noder
                </span>
              </div>
            </div>
          </div>

          {/* DISCOVERED A2A PATHWAYS GRID */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold font-mono text-slate-200 flex items-center gap-2">
                <Network className="w-4 h-4 text-cyan-400" />
                <span>Upptäckta & Verifierade A2A Marknadsvägar</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-500">
                Standard: Google A2A Protocol v1.0 & JSON-RPC 2.0
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scraperStatus?.discoveredPathways?.map(pathway => {
                const pingRes = pingStatusMap[pathway.id];
                return (
                  <div
                    key={pathway.id}
                    className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-cyan-500/50 transition-all shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-cyan-400" />
                          <h4 className="font-mono font-bold text-xs text-slate-100">{pathway.name}</h4>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 block truncate max-w-xs">
                          {pathway.endpoint}
                        </span>
                      </div>

                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                        pathway.status === 'VERIFIED'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-cyan-950 text-cyan-300 border-cyan-800'
                      }`}>
                        {pathway.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 font-mono text-[10px] bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                      <div>
                        <span className="text-slate-500 block">Källmarknad:</span>
                        <span className="text-cyan-300 font-bold">{pathway.sourceMarket}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Svarstid (Latency):</span>
                        <span className="text-emerald-400 font-bold">{pathway.latencyMs}ms</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Tillförlitlighet:</span>
                        <span className="text-purple-300 font-bold">{pathway.reliabilityScore}%</span>
                      </div>
                    </div>

                    {/* Offered Skills */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-slate-400 font-bold block">
                        Erbjudna Skills & Tjänster ({pathway.skills.length}):
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {pathway.skills.map(sk => (
                          <span
                            key={sk.id}
                            className="text-[10px] font-mono bg-slate-950 border border-slate-800 text-slate-300 px-2 py-0.5 rounded flex items-center gap-1"
                          >
                            <Zap className="w-2.5 h-2.5 text-cyan-400" />
                            <span>{sk.name}</span>
                            {sk.priceUsdc && <span className="text-amber-400 font-bold">${sk.priceUsdc}</span>}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800 font-mono text-xs">
                      <button
                        onClick={() => handlePingPathway(pathway.id)}
                        className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-[10px] font-bold flex items-center gap-1 transition-colors"
                      >
                        <Radio className="w-3 h-3 text-cyan-400" />
                        <span>{pingRes || 'Ping Handshake'}</span>
                      </button>

                      <button
                        onClick={() => {
                          if (pathway.skills[0]) {
                            handleSkillChange(pathway.skills[0].id);
                          }
                          setShowDispatchModal(true);
                        }}
                        className="px-3 py-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 rounded text-[10px] font-bold flex items-center gap-1 transition-all"
                      >
                        <Send className="w-3 h-3" />
                        <span>Skicka Task Hit</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SCRAPER TELEMETRY LOG */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>Autonom Scraper Telemetrilogg</span>
              </span>
              <span className="text-[10px] font-mono text-slate-500">Källkod: /server.ts (executeA2AScrapeCycle)</span>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
              {scraperStatus?.logs?.map((log, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                  <span className={
                    log.type === 'success' ? 'text-emerald-400 font-bold' :
                    log.type === 'warn' ? 'text-amber-400' :
                    log.type === 'error' ? 'text-rose-400 font-bold' : 'text-slate-300'
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TASKS & DISPATCHER VIEW */}
      {activeTab === 'tasks' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: TASK LIST & FILTERS (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Sök på Task ID eller skill..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono w-full sm:w-auto justify-end">
                  <span className="text-[10px] text-slate-500 px-1">Status:</span>
                  {['all', 'working', 'completed', 'canceled'].map(st => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                        statusFilter === st
                          ? 'bg-cyan-500 text-slate-950'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {st === 'all' ? 'Alla' : st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Task Cards List */}
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {filteredTasks.length === 0 ? (
                  <div className="p-8 text-center bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                    <Activity className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-xs font-mono text-slate-400">
                      Inga A2A-uppgifter matchar filtreringen.
                    </p>
                    <button
                      onClick={() => setShowDispatchModal(true)}
                      className="text-xs font-mono text-cyan-400 hover:underline font-bold"
                    >
                      + Skicka en ny A2A uppgift nu
                    </button>
                  </div>
                ) : (
                  filteredTasks.map(t => {
                    const isSelected = selectedTask?.id === t.id;
                    const isWorking = t.status.state === 'working';
                    const isCompleted = t.status.state === 'completed';
                    const isCanceled = t.status.state === 'canceled' || t.status.state === 'failed';

                    return (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTask(t)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-slate-950 border-cyan-500 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-950'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`p-1.5 rounded-lg border text-xs ${
                                isWorking
                                  ? 'bg-amber-950/60 border-amber-800 text-amber-400'
                                  : isCompleted
                                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
                                  : 'bg-rose-950/60 border-rose-800 text-rose-400'
                              }`}
                            >
                              {isWorking && <Clock className="w-3.5 h-3.5 animate-spin" />}
                              {isCompleted && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {isCanceled && <XCircle className="w-3.5 h-3.5" />}
                            </span>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-xs text-slate-100">{t.id}</span>
                                <span className="text-[10px] bg-slate-900 border border-slate-700 text-cyan-300 font-mono px-1.5 py-0.2 rounded">
                                  skill: {t.skill}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono block">
                                Skapad: {new Date(t.created_at * 1000).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                                isWorking
                                  ? 'bg-amber-950 text-amber-300 border-amber-800 animate-pulse'
                                  : isCompleted
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : 'bg-rose-950 text-rose-300 border border-rose-800'
                              }`}
                            >
                              {t.status.state.toUpperCase()}
                            </span>

                            <ChevronRight className={`w-4 h-4 transition-transform ${isSelected ? 'text-cyan-400 rotate-90' : 'text-slate-600'}`} />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: TASK DETAILS & ARTIFACT INSPECTOR (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-4 min-h-[480px] flex flex-col justify-between">
              {selectedTask ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-sm font-bold font-mono text-slate-100">
                          Task Inspect: {selectedTask.id}
                        </h3>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block">
                        Skill ID: <span className="text-cyan-300">{selectedTask.skill}</span>
                      </span>
                    </div>

                    {selectedTask.status.state === 'working' && (
                      <button
                        onClick={() => handleCancelTask(selectedTask.id)}
                        className="px-2.5 py-1 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded text-[10px] font-mono font-bold transition-colors"
                      >
                        Avbryt Task
                      </button>
                    )}
                  </div>

                  {/* Status and Created Metadata */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-slate-500 text-[10px] block">Tillstånd:</span>
                      <span className="font-bold text-slate-200 uppercase">{selectedTask.status.state}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Tidsstämpel:</span>
                      <span className="text-slate-300 text-[11px]">{new Date(selectedTask.created_at * 1000).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Artifact Payload Inspection */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Artifact Output Data</span>
                      </span>

                      <button
                        onClick={() => copyToClipboard(JSON.stringify(selectedTask.artifacts, null, 2), 'task-json')}
                        className="text-[10px] font-mono text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        {copiedId === 'task-json' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>Kopiera JSON</span>
                      </button>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-cyan-300 overflow-x-auto max-h-64 scrollbar-thin">
                      <pre>
                        {selectedTask.artifacts && selectedTask.artifacts.length > 0
                          ? JSON.stringify(selectedTask.artifacts[0].parts[0]?.data || selectedTask.artifacts, null, 2)
                          : '// Inga artefakter genererade än'}
                      </pre>
                    </div>
                  </div>

                  {/* Quick actions for specific skills */}
                  {selectedTask.artifacts?.[0]?.parts?.[0]?.data?.hosted_url && (
                    <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-lg space-y-2">
                      <span className="text-xs font-mono font-bold text-emerald-300 block">
                        💳 Coinbase Betalningslänk Redo:
                      </span>
                      <a
                        href={selectedTask.artifacts[0].parts[0].data.hosted_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 bg-emerald-500 text-slate-950 font-mono font-bold text-xs rounded flex items-center justify-center gap-1.5 hover:bg-emerald-400 transition-colors"
                      >
                        <span>Öppna Coinbase Charge</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-12 text-center my-auto space-y-3">
                  <Zap className="w-10 h-10 text-slate-700 mx-auto" />
                  <p className="text-xs font-mono text-slate-400">
                    Välj en A2A-uppgift från listan till vänster för att granska dess realtidsstatus och artefakter.
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>Protokoll: JSON-RPC 2.0</span>
                <span>Endpoint: /a2a</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MONETIZATION & LOW-COST ARCHITECTURE */}
      {activeTab === 'monetization' && (
        <div className="space-y-6 font-sans">
          {/* HEADER STRATEGY BANNER */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                    <span>A2A Skill Monetisering & Lågkostnads Driftarkitektur</span>
                    <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-bold">
                      [REAL] Driftsbudget &lt; $5 / månad
                    </span>
                  </h3>
                </div>
                <p className="text-xs text-slate-300">
                  Strategi för att köra webb-opererande agenter, övervinna tekniska begränsningar och generera intäkter från A2A-marknader utan höga serverkostnader.
                </p>
              </div>

              <div className="flex items-center gap-2 font-mono text-xs">
                <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2">
                  <span className="text-slate-500">Kalkylator:</span>
                  <span className="text-emerald-400 font-bold">50 000 A2A Anrop = ~$3.75</span>
                </div>
              </div>
            </div>

            {/* THREE CORE STRATEGY PILLARS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Globe className="w-4 h-4" />
                  <h4 className="font-bold text-slate-200">1. Webb-Operationer utan Chromium</h4>
                </div>
                <p className="text-slate-400 font-sans text-xs leading-relaxed">
                  <span className="text-rose-400 font-bold font-mono">[RISK]</span> Puppeteer/Headless Chrome kräver &gt;2GB RAM i Cloud Run vilket ökar serverkostnaden.
                  <br /><span className="text-emerald-400 font-bold font-mono">[REAL]</span> Vi använder API-first discovery via <code className="text-cyan-300">/.well-known/agent.json</code> samt lättvikts Cheerio HTTP-scraping (minimal CPU/RAM).
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-amber-400">
                  <Cpu className="w-4 h-4" />
                  <h4 className="font-bold text-slate-200">2. Token- & LLM-Optimering</h4>
                </div>
                <p className="text-slate-400 font-sans text-xs leading-relaxed">
                  <span className="text-rose-400 font-bold font-mono">[RISK]</span> Tunga LLM-modeller i kontinuerliga slingor drar mycket token-kostnader.
                  <br /><span className="text-emerald-400 font-bold font-mono">[REAL]</span> Gemini 2.5/3.0 Flash för rutinparsing ($0.075/1M tokens) + caching av A2A-svar och lokal Qwen 2.5 Coder för snabba heta verifieringar.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-purple-400">
                  <Shield className="w-4 h-4" />
                  <h4 className="font-bold text-slate-200">3. Mikrotransaktioner & Monetisering</h4>
                </div>
                <p className="text-slate-400 font-sans text-xs leading-relaxed">
                  <span className="text-rose-400 font-bold font-mono">[RISK]</span> Traditionella kortavgifter (3% + $0.30) omöjliggör $0.05 mikrobetalningar.
                  <br /><span className="text-emerald-400 font-bold font-mono">[REAL]</span> Skyfire USDC Agent Pay + Base L2 / Solana P2P för direkt agent-till-agent betalning med avgift &lt;$0.001.
                </p>
              </div>
            </div>
          </div>

          {/* MONETIZABLE SKILLS CATALOG TABLE */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Vår Saluförda A2A Agent Skill-Katalog (Prissättning & Intäkt)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Agenter från andra noder anropar dessa skills och betalar automatiskt via Skyfire USDC eller Coinbase Charge.
                </p>
              </div>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 border border-cyan-800 px-2 py-1 rounded font-bold">
                A2A Monetization Active
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-amber-500/50 transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-amber-400 bg-amber-950 px-1.5 py-0.5 rounded border border-amber-800">
                      skyfire_pay
                    </span>
                    <h4 className="font-mono font-bold text-xs text-slate-100 mt-1">Skyfire USDC Agent Pay</h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
                    $0.05 / anrop
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Genererar och verifierar P2P Skyfire USDC betalningstokens mellan autonoma agentnoder.
                </p>
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>Protokoll: Skyfire USDC</span>
                  <span className="text-amber-300 font-bold">Est. Intäkt: $50 / 1k anrop</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-amber-500/50 transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">
                      create_payment
                    </span>
                    <h4 className="font-mono font-bold text-xs text-slate-100 mt-1">Coinbase Commerce Charge</h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
                    $0.25 / länk
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Skapar kryptobetalningslänkar och licensnycklar för agent-to-agent handel.
                </p>
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>Protokoll: Coinbase Commerce</span>
                  <span className="text-amber-300 font-bold">Est. Intäkt: $250 / 1k anrop</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-amber-500/50 transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-purple-400 bg-purple-950 px-1.5 py-0.5 rounded border border-purple-800">
                      readiness_score
                    </span>
                    <h4 className="font-mono font-bold text-xs text-slate-100 mt-1">Readiness Assessment</h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
                    $0.50 / utvärdering
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Kör automatisk arkitektur- och säkerhetsanalys på externa agent-kodbaser.
                </p>
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>Protokoll: JACO Readiness Engine</span>
                  <span className="text-amber-300 font-bold">Est. Intäkt: $500 / 1k anrop</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-amber-500/50 transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded border border-blue-800">
                      completion_model
                    </span>
                    <h4 className="font-mono font-bold text-xs text-slate-100 mt-1">Completion Threshold</h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
                    $0.20 / kontroll
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Mäter om ett komplext agentuppdrag uppfyller leveranskraven före utbetalning.
                </p>
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>Protokoll: A2A Proof of Work</span>
                  <span className="text-amber-300 font-bold">Est. Intäkt: $200 / 1k anrop</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-amber-500/50 transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">
                      delegate_to_broker
                    </span>
                    <h4 className="font-mono font-bold text-xs text-slate-100 mt-1">Local Qwen Broker Delegation</h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
                    $0.10 / uppdrag
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans">
                  Delegerar under-analys till lokal snabb källkodsmotor (Qwen 2.5 Coder) i nätverket.
                </p>
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>Protokoll: Local Sub-Agent</span>
                  <span className="text-amber-300 font-bold">Est. Intäkt: $100 / 1k anrop</span>
                </div>
              </div>
            </div>
          </div>

          {/* STEP-BY-STEP REINVESTMENT & HARDWARE ESCALATION ROADMAP */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                  <Coins className="w-4 h-4 text-emerald-400" />
                  <span>Stegvis Återinvesterings- & Hårdvarutrappa (Bootstrap Roadmap)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Hur agenternas genererade intäkter automatiskt slussas till högre API-kvoter och slutligen en dedikerad AI-dator.
                </p>
              </div>
              <span className="text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800 px-2 py-1 rounded font-bold">
                A2A Reinvestment Engine
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* STAGE 1 */}
              <div className="bg-slate-950 border-2 border-emerald-500/50 rounded-xl p-4 space-y-3 relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 font-mono font-bold text-[9px] px-2 py-0.5 rounded-bl">
                  NUVARANDE STAG
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">STEG 1 ($0 - $100 INTJÄNAT)</span>
                  <h4 className="font-mono font-bold text-sm text-slate-100">Nollkostnad & Lättviktsdrift</h4>
                </div>
                <ul className="text-xs text-slate-300 space-y-1.5 font-sans">
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>API:</strong> Gemini 2.5 / 3.0 Flash ($0.075/1M tokens) + Free Tier Cloud Run.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Webb:</strong> Cheerio HTTP scraping (ingen Chrome/RAM-kostnad).</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Betalning:</strong> P2P Skyfire USDC / Coinbase Commerce.</span>
                  </li>
                </ul>
                <div className="pt-2 border-t border-slate-800 font-mono text-[11px] text-slate-400 flex justify-between">
                  <span>Månadsbudget:</span>
                  <span className="text-emerald-400 font-bold">&lt; $5 / månad</span>
                </div>
              </div>

              {/* STAGE 2 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 relative">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-amber-400 font-bold">STEG 2 ($100 - $1,000 INTJÄNAT)</span>
                  <h4 className="font-mono font-bold text-sm text-slate-100">Moln-Skalning & API-Quota</h4>
                </div>
                <ul className="text-xs text-slate-300 space-y-1.5 font-sans">
                  <li className="flex items-start gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span><strong>API:</strong> Gemini Pro Pay-as-you-go för komplex arkitekturanalys.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span><strong>Fördelning:</strong> 40% Lön (valfri återinvestering), 30% Moln-API/Cloudflare, 30% Hårdvarufond.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span><strong>Prestanda:</strong> 5x snabbare A2A-svar och parallella agentnoder.</span>
                  </li>
                </ul>
                <div className="pt-2 border-t border-slate-800 font-mono text-[11px] text-slate-400 flex justify-between">
                  <span>Mål:</span>
                  <span className="text-amber-400 font-bold">Kvalificerad Moln-kapacitet</span>
                </div>
              </div>

              {/* STAGE 3 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 relative">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-cyan-400 font-bold">STEG 3 ($1,000+ INTJÄNAT)</span>
                  <h4 className="font-mono font-bold text-sm text-slate-100">Egen AI-Hårdvara / On-Prem Rig</h4>
                </div>
                <ul className="text-xs text-slate-300 space-y-1.5 font-sans">
                  <li className="flex items-start gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <span><strong>Inköp:</strong> Dedikerad NPU/GPU AI-dator (t.ex. Mac Studio / RTX 4090).</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <span><strong>Marginal:</strong> 100% vinst marginal — lokal Qwen 2.5 32B / Llama 3.3.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <span><strong>Autonomi:</strong> Dygnet-runt lokalt A2A-nav med 0 kr i löpande tokenkostnad.</span>
                  </li>
                </ul>
                <div className="pt-2 border-t border-slate-800 font-mono text-[11px] text-slate-400 flex justify-between">
                  <span>Slutmål:</span>
                  <span className="text-cyan-400 font-bold">100% Autonom Hårdvarunod</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DISPATCH TASK MODAL */}
      {showDispatchModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/50 rounded-2xl p-6 max-w-xl w-full space-y-4 shadow-2xl font-sans">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-slate-100 font-mono">
                  ⚡ Skicka A2A Task (tasks/send)
                </h3>
              </div>
              <button
                onClick={() => setShowDispatchModal(false)}
                className="text-slate-400 hover:text-slate-100 text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDispatchTask} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-mono text-slate-300 font-bold block">
                  Välj A2A Skill:
                </label>
                <select
                  value={selectedSkill}
                  onChange={(e) => handleSkillChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="skyfire_pay">skyfire_pay – Skyfire USDC Agent Pay Token</option>
                  <option value="create_payment">create_payment – Coinbase / Stripe Charge</option>
                  <option value="readiness_score">readiness_score – Project Readiness Score</option>
                  <option value="completion_model">completion_model – Completion Threshold Model</option>
                  <option value="delegate_to_broker">delegate_to_broker – JACO Local Broker (Qwen)</option>
                  <option value="echo">echo – Diagnostic Echo</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-slate-300 font-bold block">
                  Anpassat Task ID (valfritt):
                </label>
                <input
                  type="text"
                  placeholder="t.ex. a2a-my-custom-task-01"
                  value={customTaskId}
                  onChange={(e) => setCustomTaskId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-slate-300 font-bold block flex items-center justify-between">
                  <span>Nyttolast JSON (skill_params):</span>
                  <span className="text-[10px] text-slate-500">parts[0].data</span>
                </label>
                <textarea
                  rows={5}
                  value={customPayloadJson}
                  onChange={(e) => setCustomPayloadJson(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {dispatchStatus && (
                <div className={`p-2.5 rounded-lg border text-xs font-mono ${
                  dispatchStatus.includes('[REAL]')
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950 border-rose-800 text-rose-300'
                }`}>
                  {dispatchStatus}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-mono font-bold transition-colors"
                >
                  Avbryt
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-mono font-bold text-xs rounded-lg shadow-lg flex items-center gap-1.5 transition-all"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Skicka A2A Uppgift</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD SEED TARGET MODAL */}
      {showAddSeedModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/50 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl font-sans">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-slate-100 font-mono">
                  Lägg till A2A Seed Target för Scraper
                </h3>
              </div>
              <button
                onClick={() => setShowAddSeedModal(false)}
                className="text-slate-400 hover:text-slate-100 text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSeedTarget} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-mono text-slate-300 font-bold block">
                  Namn på A2A Källa:
                </label>
                <input
                  type="text"
                  placeholder="t.ex. Custom Agent Market Registry"
                  value={newSeedName}
                  onChange={(e) => setNewSeedName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-slate-300 font-bold block">
                  URL till Agent Manifest / Index:
                </label>
                <input
                  type="url"
                  placeholder="https://myagent.com/.well-known/agent.json"
                  value={newSeedUrl}
                  onChange={(e) => setNewSeedUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-slate-300 font-bold block">
                  Källmarknad:
                </label>
                <input
                  type="text"
                  placeholder="t.ex. Custom A2A Mesh"
                  value={newSeedMarket}
                  onChange={(e) => setNewSeedMarket(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddSeedModal(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-mono font-bold transition-colors"
                >
                  Avbryt
                </button>

                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-mono font-bold text-xs rounded-lg shadow-lg flex items-center gap-1.5 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Spara Target</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
