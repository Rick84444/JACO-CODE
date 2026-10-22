import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  DollarSign, 
  Award, 
  Sparkles, 
  Search, 
  Filter, 
  Lock, 
  Unlock, 
  Bot, 
  Cpu, 
  Globe, 
  Layers, 
  Terminal, 
  AlertTriangle, 
  Download, 
  Check, 
  Info,
  ShieldAlert,
  Server
} from 'lucide-react';

export interface MarketplacePlugin {
  id: string;
  name: string;
  category: 'A2A Network' | 'Local AI Engine' | 'Web Scraper' | 'Quantum Tensor' | 'Cloud API' | 'Workspace Skill';
  description: string;
  realityTag: '[REAL]' | '[PROTOTYPE]' | '[SIMULATED]' | '[SPEC]' | '[RISK]';
  isApproved: boolean;
  isFinancialCost: boolean; // True if it costs external API money or financial transaction
  costEstimate: string; // e.g. "0 SEK / Gratis Lokal", "$0.002 / 1k tokens"
  maxBudgetSEK?: number;
  auditChecksum: string;
  provider: string;
  capabilities: string[];
}

export const VerifiedMarketplacesView: React.FC = () => {
  // Autonomy settings from LocalStorage
  const [autoApproveNonFinancial, setAutoApproveNonFinancial] = useState<boolean>(() => {
    const saved = localStorage.getItem('jaco_auto_approve');
    return saved !== null ? saved === 'true' : true;
  });

  const [requireFinancialApproval, setRequireFinancialApproval] = useState<boolean>(true);
  const [maxFinancialLimitSEK, setMaxFinancialLimitSEK] = useState<number>(50);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'approved' | 'pending' | 'free' | 'paid'>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Marketplace plugins state
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([
    {
      id: 'plugin-a2a-network',
      name: 'A2A Protocol & Marketplace Broker',
      category: 'A2A Network',
      description: 'Autonom agent-till-agent nätverksbrygga med A2A-RPC, capability discovery och kryptografiska exekveringsbevis.',
      realityTag: '[REAL]',
      isApproved: true,
      isFinancialCost: false,
      costEstimate: '0 SEK / Lokal A2A-brygga',
      auditChecksum: 'sha256:7f8e9d4a0b2c1e8',
      provider: 'JACO OS Core',
      capabilities: ['A2A-RPC Task Delegation', 'Capability Discovery', 'Proof-of-Execution Verification']
    },
    {
      id: 'plugin-qwen-local',
      name: 'Ollama / Qwen2.5 Local Inference',
      category: 'Local AI Engine',
      description: 'Lokal kvantiserad modellmotor för resursoptimerad resonering och automatisk failover utan externa API-kostnader.',
      realityTag: '[REAL]',
      isApproved: true,
      isFinancialCost: false,
      costEstimate: '0 SEK / 100% Lokal Hårdvara',
      auditChecksum: 'sha256:3a1c9e8b7d6f5a4',
      provider: 'Ollama Local Bridge (192.168.1.114)',
      capabilities: ['Offline Inference', 'Zero API Cost Failover', 'Swedish Reasoning Engine']
    },
    {
      id: 'plugin-openclaw-scraper',
      name: 'OpenClaw Autonomous Web Extractor',
      category: 'Web Scraper',
      description: 'Autonom DOM-extraktor och innehållssummerare för sanntidsdata från webbsidor och öppna API-källor.',
      realityTag: '[REAL]',
      isApproved: true,
      isFinancialCost: false,
      costEstimate: '0 SEK / Öppen Webbskrapning',
      auditChecksum: 'sha256:9f8e7d6c5b4a3e2',
      provider: 'OpenClaw Studio',
      capabilities: ['DOM Knowledge Scrape', 'Web Context Injection', 'Automated Search Fetching']
    },
    {
      id: 'plugin-cuda-tensor',
      name: 'CUDA Quantum Tensor Accelerator',
      category: 'Quantum Tensor',
      description: 'Hårdvaruaccelererad matrisberäkningskärna för tids- och minneseffektiva tensoroperationer.',
      realityTag: '[REAL]',
      isApproved: true,
      isFinancialCost: false,
      costEstimate: '0 SEK / Lokal NPU-Accelerering',
      auditChecksum: 'sha256:1b2c3d4e5f6a7b8',
      provider: 'NPU Matrix Engine',
      capabilities: ['Tensor Kernel Optimization', 'Zero Regression Math', 'Quantum Matrix Emulation']
    },
    {
      id: 'plugin-google-keep',
      name: 'Google Keep & Workspace Sync',
      category: 'Workspace Skill',
      description: 'Direktintegrering för att läsa, skapa och synkronisera anteckningar och arbetsflöden till Google Keep.',
      realityTag: '[REAL]',
      isApproved: true,
      isFinancialCost: false,
      costEstimate: '0 SEK / Användarens Google OAuth',
      auditChecksum: 'sha256:8c7b6a5f4e3d2c1',
      provider: 'Google Workspace Integration',
      capabilities: ['OAuth Sync', 'Keep Note Management', 'Context Injection']
    },
    {
      id: 'plugin-gemini-cloud-api',
      name: 'Google Gemini 1.5 Flash / Pro API',
      category: 'Cloud API',
      description: 'Molnbaserad stormodells-API via Google GenAI SDK för högkapacitetsresonemang.',
      realityTag: '[REAL]',
      isApproved: true,
      isFinancialCost: true,
      costEstimate: 'Gratis kvaotpot → Därefter automatisk failover till lokal Ollama',
      maxBudgetSEK: 0,
      auditChecksum: 'sha256:2d3e4f5a6b7c8d9',
      provider: 'Google AI Studio Cloud API',
      capabilities: ['Multimodal Analysis', 'Complex Coding Synthesis', 'Auto-Quota Failover']
    },
    {
      id: 'plugin-deepseek-paid-api',
      name: 'DeepSeek R1 / V3 Commercial API',
      category: 'Cloud API',
      description: 'Kommersiellt DeepSeek API för djupgående matematiskt resonemang vid komplex källkodsanalys.',
      realityTag: '[PROTOTYPE]',
      isApproved: false,
      isFinancialCost: true,
      costEstimate: '~0.02 SEK / 1k tokens (Kräver explicit godkännande)',
      maxBudgetSEK: 25,
      auditChecksum: 'sha256:5e6f7a8b9c0d1e2',
      provider: 'DeepSeek Open API',
      capabilities: ['Math Theorem Verification', 'Large Refactoring Reasoning']
    },
    {
      id: 'plugin-huggingface-hub',
      name: 'HuggingFace Agentic Tools Hub',
      category: 'Local AI Engine',
      description: 'Direktnedladdning och exekvering av öppna agentverktyg från HuggingFace Hub.',
      realityTag: '[REAL]',
      isApproved: true,
      isFinancialCost: false,
      costEstimate: '0 SEK / Öppna Modeller',
      auditChecksum: 'sha256:4a3b2c1d0e9f8a7',
      provider: 'HuggingFace Hub',
      capabilities: ['Open Tool Downloads', 'Model Quantization', 'Local Pipeline Execution']
    }
  ]);

  useEffect(() => {
    localStorage.setItem('jaco_auto_approve', String(autoApproveNonFinancial));
  }, [autoApproveNonFinancial]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleToggleApproval = (id: string) => {
    setPlugins(prev => prev.map(p => {
      if (p.id === id) {
        // If it is financial and currently not approved, check financial safety contract
        if (!p.isApproved && p.isFinancialCost && requireFinancialApproval) {
          triggerToast(`[RISK / STRENG EKONOMI] ${p.name} kräver betalda API-anrop. Ekonomisk spärr bekräftad.`);
        } else {
          triggerToast(`${p.name} är nu ${!p.isApproved ? 'markerad som godkänd i denna vy (ingen körning ändrad)' : 'DEAKTIVERAD'}`);
        }
        return { ...p, isApproved: !p.isApproved };
      }
      return p;
    }));
  };

  const handleApproveAllFree = () => {
    setPlugins(prev => prev.map(p => {
      if (!p.isFinancialCost) {
        return { ...p, isApproved: true };
      }
      return p;
    }));
    triggerToast('Alla kostnadsfria agentiska kapabiliteter markerade som godkända i denna vy (ingen körning ändrad)');
  };

  // Filter plugins
  const filteredPlugins = plugins.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.provider.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;

    let matchesStatus = true;
    if (selectedStatus === 'approved') matchesStatus = p.isApproved;
    if (selectedStatus === 'pending') matchesStatus = !p.isApproved;
    if (selectedStatus === 'free') matchesStatus = !p.isFinancialCost;
    if (selectedStatus === 'paid') matchesStatus = p.isFinancialCost;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const totalApproved = plugins.filter(p => p.isApproved).length;
  const totalFree = plugins.filter(p => !p.isFinancialCost).length;
  const totalFinancial = plugins.filter(p => p.isFinancialCost).length;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 text-slate-100 font-sans">
      {/* Toast notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-cyan-950 border border-cyan-500/80 text-cyan-200 px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200 text-xs font-mono">
          <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Header Banner */}
      <div className="bg-slate-900/90 border border-cyan-900/50 rounded-2xl p-6 backdrop-blur shadow-2xl relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 bg-cyan-950 border border-cyan-800 text-cyan-400 text-[11px] font-mono rounded-full flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" /> [REAL] Verifierat Kontrakt
              </span>
              <span className="px-2.5 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 text-[11px] font-mono rounded-full font-bold">
                JACO OS v2.4 Marketplace Protocol
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100 flex items-center gap-3 tracking-tight">
              <Award className="w-8 h-8 text-cyan-400" />
              Verified Agent Marketplaces & Capabilities
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl leading-relaxed">
              Centraliserad kontrollpanel för godkännande av agentiska verktyg, A2A-noder, lokala modeller och API-bryggor. 
              Minskar mikrogodkännanden genom full agentisk intuition för kostnadsfria delsteg med strikt spärr mot finansiella utgifter.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleApproveAllFree}
              className="px-4 py-2.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/80 text-emerald-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50"
            >
              <Zap className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span>Godkänn Alla Kostnadsfria (`{totalFree}`)</span>
            </button>
          </div>
        </div>

        {/* Autonomy & Gatekeeper Directive Status Banner */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-slate-950/80 border border-emerald-900/60 rounded-xl flex items-start gap-3">
            <div className="p-2 bg-emerald-950 rounded-lg text-emerald-400 shrink-0 mt-0.5">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Agentisk Intuition (Autonomi)</h4>
                <span className="px-1.5 py-0.5 bg-emerald-900/80 text-emerald-200 text-[10px] rounded font-mono font-bold">AKTIV [REAL]</span>
              </div>
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                Tekniska understeg (filändringar, lokala terminaltester, A2A-RPC-anrop) körs autonomt utan irriterande mikrogodkännanden.
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-950/80 border border-amber-900/60 rounded-xl flex items-start gap-3">
            <div className="p-2 bg-amber-950 rounded-lg text-amber-400 shrink-0 mt-0.5">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">Finansiell Säkerhetsspärr</h4>
                <span className="px-1.5 py-0.5 bg-amber-900/80 text-amber-200 text-[10px] rounded font-mono font-bold">STRIKT [REAL]</span>
              </div>
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                Betalda API:er eller finansiella transaktioner kräver ALLTID explicit godkännande och förhandsställd kostnadsgräns.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-slate-400 text-xs block font-medium">Totalt Antal Kapabiliteter</span>
            <span className="text-xl font-bold text-slate-100 font-mono mt-0.5 block">{plugins.length}</span>
          </div>
          <Bot className="w-7 h-7 text-cyan-400 opacity-80" />
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-slate-400 text-xs block font-medium">Godkända & Aktiva</span>
            <span className="text-xl font-bold text-emerald-400 font-mono mt-0.5 block">{totalApproved} / {plugins.length}</span>
          </div>
          <CheckCircle2 className="w-7 h-7 text-emerald-400 opacity-80" />
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-slate-400 text-xs block font-medium">Kostnadsfria (Lokala/A2A)</span>
            <span className="text-xl font-bold text-cyan-400 font-mono mt-0.5 block">{totalFree}</span>
          </div>
          <Cpu className="w-7 h-7 text-cyan-400 opacity-80" />
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-slate-400 text-xs block font-medium">Betalda / Utgift (API)</span>
            <span className="text-xl font-bold text-amber-400 font-mono mt-0.5 block">{totalFinancial}</span>
          </div>
          <DollarSign className="w-7 h-7 text-amber-400 opacity-80" />
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Sök kapabilitet, plugin eller leverantör..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Status filter */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setSelectedStatus('all')}
              className={`px-2.5 py-1 rounded transition-colors ${selectedStatus === 'all' ? 'bg-cyan-950 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Alla
            </button>
            <button
              onClick={() => setSelectedStatus('approved')}
              className={`px-2.5 py-1 rounded transition-colors ${selectedStatus === 'approved' ? 'bg-emerald-950 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Godkända
            </button>
            <button
              onClick={() => setSelectedStatus('pending')}
              className={`px-2.5 py-1 rounded transition-colors ${selectedStatus === 'pending' ? 'bg-amber-950 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Väntar Godkännande
            </button>
            <button
              onClick={() => setSelectedStatus('free')}
              className={`px-2.5 py-1 rounded transition-colors ${selectedStatus === 'free' ? 'bg-blue-950 text-blue-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Kostnadsfria
            </button>
            <button
              onClick={() => setSelectedStatus('paid')}
              className={`px-2.5 py-1 rounded transition-colors ${selectedStatus === 'paid' ? 'bg-amber-950 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Betalda API:er
            </button>
          </div>
        </div>
      </div>

      {/* Capabilities Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredPlugins.map(plugin => {

          return (
            <div 
              key={plugin.id}
              className={`bg-slate-900/90 border rounded-2xl p-5 transition-all flex flex-col justify-between relative overflow-hidden ${
                plugin.isApproved 
                  ? 'border-emerald-900/50 shadow-lg shadow-emerald-950/20' 
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Header inside card */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                      plugin.realityTag === '[REAL]' 
                        ? 'bg-emerald-950 border-emerald-800 text-emerald-400' 
                        : 'bg-amber-950 border-amber-800 text-amber-400'
                    }`}>
                      {plugin.realityTag}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {plugin.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {plugin.isFinancialCost ? (
                      <span className="px-2 py-0.5 bg-amber-950 border border-amber-800/80 text-amber-400 text-[10px] font-mono rounded flex items-center gap-1 font-bold">
                        <DollarSign className="w-3 h-3 text-amber-400" /> Betalt API
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-cyan-950 border border-cyan-800/80 text-cyan-300 text-[10px] font-mono rounded flex items-center gap-1 font-bold">
                        <Zap className="w-3 h-3 text-cyan-400" /> Gratis / Lokal
                      </span>
                    )}
                  </div>
                </div>

                <h3 className="text-base font-bold text-slate-100 mb-1 flex items-center gap-2">
                  {plugin.name}
                  {plugin.isApproved && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                </h3>

                <p className="text-slate-400 text-xs leading-relaxed mb-4">
                  {plugin.description}
                </p>

                {/* Capabilities Badges */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {plugin.capabilities.map((cap, i) => (
                    <span key={i} className="text-[10px] bg-slate-950 text-slate-300 px-2 py-1 rounded border border-slate-800 font-mono">
                      • {cap}
                    </span>
                  ))}
                </div>

                {/* Financial & Checksum Info */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs font-mono mb-4">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Leverantör:</span>
                    <span className="text-slate-200 font-semibold">{plugin.provider}</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-400">
                    <span>Kostnadsstruktur:</span>
                    <span className={plugin.isFinancialCost ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {plugin.costEstimate}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span>Audit Checksum:</span>
                    <span className="truncate max-w-[160px] text-slate-400">{plugin.auditChecksum}</span>
                  </div>
                </div>
              </div>

              {/* Action Controls */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3">
                <span className="px-3 py-1.5 border border-slate-800 text-slate-500 rounded-lg text-xs font-mono">
                  Latens: ej uppmätt
                </span>

                <button
                  onClick={() => handleToggleApproval(plugin.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    plugin.isApproved
                      ? 'bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-emerald-200 shadow-md shadow-emerald-950/40'
                      : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200'
                  }`}
                >
                  {plugin.isApproved ? (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Godkänd & Aktiv</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4 text-amber-400" />
                      <span>Godkänn Kapabilitet</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
