import React, { useState, useEffect } from 'react';
import { 
  Rocket, Sparkles, Send, CheckCircle2, AlertTriangle, FileJson, 
  Download, Layers, RefreshCw, Cpu, Code2, Bot, ShieldCheck, Terminal,
  HardDrive, History, ArrowRight, Play, FileCode, Check, Zap, ShoppingBag,
  Store, Star, DownloadCloud, Search, Filter, Coins, Plus, Eye, Code,
  Shield, GitBranch, Server, ExternalLink, X, Laptop, CheckCircle, PackageCheck,
  Share2, Globe, Network, Loader2, Activity, GitCommit, GitPullRequest
} from 'lucide-react';
import { CodeFile, DeviceTelemetry, MarketplaceSkillItem } from '../types';
import { A2AWorkflowDashboard } from './A2AWorkflowDashboard';
import { 
  createGitSavepoint, 
  fetchGitBridgeStatus, 
  fetchSavepointHistory, 
  revertToSavepoint, 
  GitSavepointCommit, 
  GitBridgeStatus 
} from '../utils/gitBridge';

interface AntigravityMissionPacket {
  id: string;
  timestamp: string;
  missionPrompt: string;
  agentModel: string;
  summary: string;
  steps: {
    id: string;
    title: string;
    description: string;
    status: 'completed' | 'pending' | 'failed';
    type?: string;
  }[];
  generatedPatch?: {
    targetFilePath: string;
    description: string;
    code: string;
  };
  savedPath?: string;
}

interface AntigravityBridgeStudioProps {
  codeFiles: CodeFile[];
  activeFilePath: string;
  telemetry: DeviceTelemetry;
  onUpdateCodeFile?: (path: string, content: string) => void;
  onRunTerminalCommand?: (cmd: string) => void;
  onExportCheckpoint?: () => void;
}

export const AntigravityBridgeStudio: React.FC<AntigravityBridgeStudioProps> = ({
  codeFiles,
  activeFilePath,
  telemetry,
  onUpdateCodeFile,
  onRunTerminalCommand,
  onExportCheckpoint
}) => {
  // Main Studio View Mode
  const [activeStudioTab, setActiveStudioTab] = useState<'bridge' | 'marketplace' | 'deployed' | 'agentcard' | 'a2a_dashboard' | 'git_bridge'>('a2a_dashboard');

  // Git-Bridge Savepoint Repository State
  const [gitSavepoints, setGitSavepoints] = useState<GitSavepointCommit[]>([]);
  const [gitStatus, setGitStatus] = useState<GitBridgeStatus | null>(null);
  const [isCreatingSavepoint, setIsCreatingSavepoint] = useState<boolean>(false);
  const [manualCommitMsg, setManualCommitMsg] = useState<string>('');

  // Mission Dispatcher State
  const [missionPrompt, setMissionPrompt] = useState<string>(
    'Analysera källkoden, refaktorisera prestandakritiska delar och säkerställ fullständig typsäkerhet och felhantering.'
  );
  const [selectedAgentModel, setSelectedAgentModel] = useState<string>('antigravity-preview-05-2026');
  const [includeWorkspaceContext, setIncludeWorkspaceContext] = useState<boolean>(true);
  const [autoSaveCheckpoint, setAutoSaveCheckpoint] = useState<boolean>(true);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [activeMissionResult, setActiveMissionResult] = useState<AntigravityMissionPacket | null>(null);
  const [missionHistory, setMissionHistory] = useState<AntigravityMissionPacket[]>([]);
  const [appliedPatchId, setAppliedPatchId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Multi-Marketplace AgentCard Publisher State
  const [cardName, setCardName] = useState<string>('JACO Master Node Agent');
  const [cardVersion, setCardVersion] = useState<string>('2.5.0');
  const [cardDesc, setCardDesc] = useState<string>(
    'Självförbättrande autonoma agent-nod med Ollama NPU-accelererad slutledning, OpenClaw-verktyg och P2P A2A-handelsstöd.'
  );
  const [cardPrice, setCardPrice] = useState<number>(0);
  const [cardLicense, setCardLicense] = useState<'A2A Royalty-Free' | 'P2P Per-Call License' | 'Open-Source P2P'>('A2A Royalty-Free');
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(['jaco-p2p', 'openclaw-hub', 'huggingface', 'fetch-ai']);
  const [customPeerUrl, setCustomPeerUrl] = useState<string>('https://peer-node-99.a2a.net/invoke');
  const [isPublishingCard, setIsPublishingCard] = useState<boolean>(false);
  const [publishedCardResult, setPublishedCardResult] = useState<any | null>(null);

  // Marketplace & Ollama Deployer State
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkillItem[]>([]);
  const [userCredits, setUserCredits] = useState<number>(250);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Alla');
  const [inspectingSkill, setInspectingSkill] = useState<MarketplaceSkillItem | null>(null);
  const [deployingSkill, setDeployingSkill] = useState<MarketplaceSkillItem | null>(null);
  const [deployStep, setDeployStep] = useState<number>(0);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [showPublishModal, setShowPublishModal] = useState<boolean>(false);

  // Additional P2P Skill Trading State
  const [sortBy, setSortBy] = useState<'reputation' | 'downloads' | 'price' | 'newest'>('reputation');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [newSkillLicense, setNewSkillLicense] = useState<'A2A Royalty-Free' | 'P2P Per-Call License' | 'Open-Source P2P'>('A2A Royalty-Free');
  const [creditNotice, setCreditNotice] = useState<string | null>(null);

  // System Secrets Audit State
  const [showSecretsModal, setShowSecretsModal] = useState<boolean>(false);
  const [secretsAuditData, setSecretsAuditData] = useState<any | null>(null);

  const fetchSecretsAudit = async () => {
    try {
      const res = await fetch('/api/system/secrets-check');
      if (res.ok) {
        const data = await res.json();
        setSecretsAuditData(data);
      }
    } catch (err) {
      console.error("Error fetching secrets audit:", err);
    }
  };

  const handleTopUpCredits = () => {
    setUserCredits(prev => prev + 100);
    setCreditNotice("+100 A2A Credits påfyllda!");
    setTimeout(() => setCreditNotice(null), 3500);
  };

  // New Skill Form State
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillTagline, setNewSkillTagline] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState<MarketplaceSkillItem['category']>('LLM & Ollama');
  const [newSkillPrice, setNewSkillPrice] = useState<number>(0);
  const [newSkillModelfile, setNewSkillModelfile] = useState('FROM qwen2.5-coder:7b\nPARAMETER temperature 0.2\nSYSTEM "Du är en specialiserad agent för lokala Ollama-miljön."');

  // Fetch past missions
  const fetchPastMissions = async () => {
    try {
      const res = await fetch('/api/antigravity/missions');
      if (res.ok) {
        const data = await res.json();
        if (data.missions && Array.isArray(data.missions)) {
          setMissionHistory(data.missions.reverse());
        }
      }
    } catch (err) {
      console.warn("Could not fetch past Antigravity missions:", err);
    }
  };

  // Fetch Marketplace skills from backend
  const fetchMarketplaceSkills = async () => {
    try {
      const res = await fetch('/api/marketplace/skills');
      if (res.ok) {
        const data = await res.json();
        if (data.skills) setMarketplaceSkills(data.skills);
        if (data.credits !== undefined) setUserCredits(data.credits);
      }
    } catch (err) {
      console.warn("Could not fetch Marketplace skills:", err);
    }
  };

  const refreshGitBridge = async () => {
    try {
      const statusData = await fetchGitBridgeStatus();
      setGitStatus(statusData);
      const historyData = await fetchSavepointHistory();
      setGitSavepoints(historyData);
    } catch (err) {
      console.warn("Could not refresh GitBridge status:", err);
    }
  };

  const handleManualSavepointCommit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsCreatingSavepoint(true);
    try {
      const msg = manualCommitMsg.trim() || 'Savepoint: Manuellt sparad workspace baseline';
      const res = await createGitSavepoint({
        targetFilePath: activeFilePath,
        commitMessage: msg,
        description: 'Manuellt skapad Git Savepoint från Antigravity Studio'
      });
      if (res && res.savepoint) {
        setStatusMessage(`[GIT SAVEPOINT CREATED] ${res.message}`);
        setManualCommitMsg('');
        await refreshGitBridge();
      }
    } catch (err: any) {
      console.error('Manual savepoint commit error:', err);
    } finally {
      setIsCreatingSavepoint(false);
    }
  };

  const handleRevertSavepoint = async (commitHash: string) => {
    const res = await revertToSavepoint(commitHash);
    if (res && res.success) {
      setStatusMessage(`[SAVEPOINT REVERTED] ${res.message}`);
      if (res.targetFilePath && res.code && onUpdateCodeFile) {
        onUpdateCodeFile(res.targetFilePath, res.code);
      }
      await refreshGitBridge();
    }
  };

  useEffect(() => {
    fetchPastMissions();
    fetchMarketplaceSkills();
    refreshGitBridge();
  }, []);

  // Dispatch mission through Antigravity Bridge
  const handleDispatchMission = async () => {
    if (!missionPrompt.trim() || isSending) return;
    setIsSending(true);
    setStatusMessage('Sänder uppdrag via Antigravity-bryggan med workspace checkpoint...');

    try {
      const res = await fetch('/api/antigravity/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionPrompt,
          agentModel: selectedAgentModel,
          includeWorkspaceContext,
          targetFilePath: activeFilePath
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        const packet: AntigravityMissionPacket = {
          id: data.missionId,
          timestamp: data.timestamp || new Date().toLocaleTimeString('sv-SE'),
          missionPrompt,
          agentModel: data.agentModel || selectedAgentModel,
          summary: data.summary,
          steps: data.steps || [],
          generatedPatch: data.generatedPatch,
          savedPath: data.savedPath
        };

        setActiveMissionResult(packet);
        setMissionHistory(prev => [packet, ...prev]);
        setStatusMessage(`[SUCCESS] Uppdrag ${data.missionId} slutfört av Antigravity!`);

        // Automatically create a Git-Bridge Savepoint commit for workflow patch!
        if (data.generatedPatch) {
          createGitSavepoint({
            targetFilePath: data.generatedPatch.targetFilePath,
            code: data.generatedPatch.code,
            description: data.generatedPatch.description || missionPrompt,
            patchId: data.missionId,
            commitMessage: `Savepoint: Workflow patch genererad för ${data.generatedPatch.targetFilePath || 'workspace'}`
          }).then(spRes => {
            if (spRes && spRes.savepoint) {
              refreshGitBridge();
            }
          });
        }

        if (autoSaveCheckpoint && onExportCheckpoint) {
          onExportCheckpoint();
        }
      } else {
        setStatusMessage(`[ERROR] Misslyckades: ${data.error || 'Okänt fel'}`);
      }
    } catch (err: any) {
      console.error('Antigravity dispatch error:', err);
      setStatusMessage(`[EXCEPTION] Fel vid kommunikation med Antigravity-bryggan: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  // Deploy / Buy Skill to local Ollama environment
  const handleStartDeploySkill = async (skill: MarketplaceSkillItem) => {
    setDeployingSkill(skill);
    setDeployStep(1);
    setDeployLog([
      `[1/4] Ansluter till lokal Ollama node (http://localhost:11434)...`,
      `[1/4] Autentiserar A2A nod-kontrakt med ${skill.author}...`
    ]);

    setTimeout(() => {
      setDeployStep(2);
      setDeployLog(prev => [
        ...prev,
        `[2/4] Hämtar Modelfile & Manifest JSON för '${skill.name}'...`,
        `[2/4] Verifierar hårdvarukrav: ${skill.requirements.join(', ')}...`
      ]);
    }, 1000);

    setTimeout(() => {
      setDeployStep(3);
      setDeployLog(prev => [
        ...prev,
        `[3/4] Kompilerar instruktioner till lokal Ollama Modelfile...`,
        `[3/4] Registrerar agent plugin i JACO Agentic Synthesizer Registry...`
      ]);
    }, 2200);

    setTimeout(async () => {
      try {
        const res = await fetch('/api/marketplace/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skillId: skill.id })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.skills) setMarketplaceSkills(data.skills);
          if (data.marketplaceSkills) setMarketplaceSkills(data.marketplaceSkills);
          if (data.creditsRemaining !== undefined) setUserCredits(data.creditsRemaining);
        }
      } catch {}

      setDeployStep(4);
      setDeployLog(prev => [
        ...prev,
        `[4/4] [SUCCESS] Skill '${skill.name}' v${skill.version} har köpts & distribuerats till din Ollama-miljö!`
      ]);
      fetchMarketplaceSkills();
    }, 3400);
  };

  // Publish new skill
  const handlePublishNewSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkillName.trim() || !newSkillTagline.trim() || !newSkillDesc.trim()) return;

    try {
      const res = await fetch('/api/marketplace/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSkillName.trim(),
          tagline: newSkillTagline.trim(),
          description: newSkillDesc.trim(),
          category: newSkillCategory,
          priceCredits: newSkillPrice,
          modelfileContent: newSkillModelfile,
          licenseType: newSkillLicense,
          peerNodeId: "node-a2a-my-local-01",
          reputationScore: 100.0,
          verifiedPeer: true
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.marketplaceSkills) setMarketplaceSkills(data.marketplaceSkills);
        setShowPublishModal(false);
        setNewSkillName('');
        setNewSkillTagline('');
        setNewSkillDesc('');
        fetchMarketplaceSkills();
      }
    } catch {}
  };

  // Multi-Marketplace AgentCard Publisher Handler
  const handlePublishAgentCardToAll = async () => {
    setIsPublishingCard(true);
    try {
      const res = await fetch('/api/a2a/publish-agentcard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: cardName,
          version: cardVersion,
          description: cardDesc,
          priceCredits: cardPrice,
          licenseType: cardLicense,
          targetMarketplaces: selectedMarkets,
          customPeerUrl
        })
      });
      if (res.ok) {
        const data = await res.json();
        setPublishedCardResult(data);
        fetchMarketplaceSkills();
      }
    } catch (err) {
      console.error("Error publishing agent card:", err);
    } finally {
      setIsPublishingCard(false);
    }
  };

  const handleDownloadAgentCardJson = () => {
    const cardData = publishedCardResult?.agentCard || {
      schemaVersion: "1.0.0-A2A",
      nodeId: "node-jaco-os-master-01",
      name: cardName,
      version: cardVersion,
      description: cardDesc,
      license: cardLicense,
      capabilities: [
        "A2A-RPC Task Delegation",
        "Ollama Local LLM AST Parsing",
        "Snapdragon NPU Tensor Acceleration",
        "OpenClaw Web Execution"
      ],
      endpoints: {
        agentCardUrl: "/api/a2a/agentcard.json",
        invokeUrl: "/api/a2a/invoke"
      }
    };
    const blob = new Blob([JSON.stringify(cardData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agentcard.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Apply generated code patch
  const handleApplyPatch = async (patch: { targetFilePath: string; code: string; description: string }) => {
    if (onUpdateCodeFile && patch.targetFilePath && patch.code) {
      onUpdateCodeFile(patch.targetFilePath, patch.code);
      setAppliedPatchId(patch.targetFilePath);

      try {
        const res = await createGitSavepoint({
          targetFilePath: patch.targetFilePath,
          code: patch.code,
          description: patch.description || 'Workflow patch tillämpad från Antigravity Studio',
          commitMessage: `Savepoint: Patch tillämpad på ${patch.targetFilePath}`
        });
        if (res && res.savepoint) {
          setGitSavepoints(prev => [res.savepoint, ...prev.filter(x => x.id !== res.savepoint.id)]);
          setStatusMessage(`[PATCH APPLIED & SAVEPOINT COMMITTED] Commit ${res.savepoint.hash} skapad i lokalt Git-arkiv för ${patch.targetFilePath}!`);
          refreshGitBridge();
          return;
        }
      } catch (err) {
        console.warn("Git Savepoint auto-commit error:", err);
      }

      setStatusMessage(`[PATCH APPLIED] Koden har uppdaterats i ${patch.targetFilePath}`);
    }
  };

  // Download mission packet JSON
  const handleDownloadPacket = (packet: AntigravityMissionPacket) => {
    const jsonStr = JSON.stringify(packet, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antigravity-mission-${packet.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter & sort marketplace skills for P2P agent skill trading
  const filteredMarketplaceSkills = marketplaceSkills
    .filter(skill => {
      const matchesCategory = selectedCategory === 'Alla' || skill.category === selectedCategory;
      const matchesSearch = !searchQuery.trim() || 
        skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (skill.peerNodeId && skill.peerNodeId.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesTradeType = tradeTypeFilter === 'all' ||
        (tradeTypeFilter === 'free' && skill.priceCredits === 0) ||
        (tradeTypeFilter === 'paid' && skill.priceCredits > 0);

      return matchesCategory && matchesSearch && matchesTradeType;
    })
    .sort((a, b) => {
      if (sortBy === 'reputation') {
        const repA = a.reputationScore ?? a.rating * 20;
        const repB = b.reputationScore ?? b.rating * 20;
        return repB - repA;
      }
      if (sortBy === 'downloads') {
        const volA = a.tradingVolume ?? a.downloadsCount;
        const volB = b.tradingVolume ?? b.downloadsCount;
        return volB - volA;
      }
      if (sortBy === 'price') {
        return a.priceCredits - b.priceCredits;
      }
      return 0;
    });

  const deployedCount = marketplaceSkills.filter(s => s.status === 'DEPLOYED').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 text-slate-100 font-sans">
      {/* Top Banner Header with Navigation Tabs */}
      <div className="bg-gradient-to-r from-slate-950 via-cyan-950/80 to-slate-950 border border-cyan-500/40 rounded-xl p-5 shadow-[0_0_25px_rgba(34,211,238,0.15)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-cyan-950 border border-cyan-400/50 flex items-center justify-center text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
              <Rocket className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100 font-sans tracking-tight">
                  Antigravity Studio & Agent Marketplace
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40">
                  Ollama A2A Ready
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Köp och distribuera färdiga agentic skills, modelfiles och drivrutiner till din lokala Ollama-miljö.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/80 border border-amber-500/50 text-amber-300 text-xs font-mono font-bold">
              <Coins className="w-4 h-4 text-amber-400" />
              <span>{userCredits} A2A Credits</span>
            </div>

            {onExportCheckpoint && (
              <button
                onClick={onExportCheckpoint}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 text-xs font-mono font-semibold border border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.25)] transition-all"
                title="Spara hela workspacet till en JSON-checkpoint"
              >
                <FileJson className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">Exportera Checkpoint</span>
              </button>
            )}
          </div>
        </div>

        {/* Studio View Navigation Buttons */}
        <div className="flex flex-wrap gap-2 pt-4 mt-4 border-t border-cyan-900/40 relative z-10">
          <button
            onClick={() => setActiveStudioTab('a2a_dashboard')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeStudioTab === 'a2a_dashboard'
                ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Activity className="w-4 h-4 text-cyan-300 animate-pulse" />
            <span>⚡ A2A Workflow Telemetri</span>
          </button>

          <button
            onClick={() => setActiveStudioTab('marketplace')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeStudioTab === 'marketplace'
                ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(34,211,238,0.4)]'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Store className="w-4 h-4" />
            <span>Agent Skill Marketplace ({marketplaceSkills.length})</span>
          </button>

          <button
            onClick={() => setActiveStudioTab('deployed')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeStudioTab === 'deployed'
                ? 'bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <PackageCheck className="w-4 h-4 text-emerald-300" />
            <span>Mina Distribuerade Plugins ({deployedCount})</span>
          </button>

          <button
            onClick={() => setActiveStudioTab('bridge')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeStudioTab === 'bridge'
                ? 'bg-purple-500 text-slate-950 shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Rocket className="w-4 h-4" />
            <span>Antigravity Uppdragsbrygga</span>
          </button>

          <button
            onClick={() => setActiveStudioTab('agentcard')}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeStudioTab === 'agentcard'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.4)]'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Share2 className="w-4 h-4 text-amber-300" />
            <span>🌐 Autonom AgentCard Publicerare</span>
          </button>

          <button
            onClick={() => {
              setActiveStudioTab('git_bridge');
              refreshGitBridge();
            }}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activeStudioTab === 'git_bridge'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <GitCommit className="w-4 h-4 text-emerald-300" />
            <span>🌳 Git-Bridge Savepoints ({gitSavepoints.length})</span>
          </button>

          <button
            onClick={() => {
              fetchSecretsAudit();
              setShowSecretsModal(true);
            }}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/40 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all"
            title="Granska konfigurerade API-nycklar och secrets"
          >
            <Shield className="w-4 h-4 text-amber-400" />
            <span>🔑 API Secrets Status</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: AGENT SKILL MARKETPLACE & P2P TRADING */}
      {activeStudioTab === 'marketplace' && (
        <div className="space-y-6">
          {/* P2P Network Trading Overview Header */}
          <div className="bg-slate-900/90 border border-cyan-900/70 rounded-xl p-4 shadow-xl space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-950 p-3 rounded-lg border border-cyan-900/40">
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Server className="w-3 h-3 text-cyan-400" /> P2P Noder Online
                </div>
                <div className="text-base font-bold font-mono text-cyan-300 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>24 Aktiva Noder</span>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-purple-900/40">
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Store className="w-3 h-3 text-purple-400" /> A2A P2P Handlar
                </div>
                <div className="text-base font-bold font-mono text-purple-300 mt-1">
                  1,840 Transaktioner
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-emerald-900/40">
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" /> P2P Trust Score
                </div>
                <div className="text-base font-bold font-mono text-emerald-300 mt-1">
                  99.2% Verifierat
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-amber-900/50 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1 text-amber-400 font-bold">
                    <Coins className="w-3 h-3" /> A2A Plånbok
                  </span>
                  <button
                    onClick={handleTopUpCredits}
                    className="text-[9px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/40 font-bold transition-colors"
                  >
                    + Fyll på (+100)
                  </button>
                </div>
                <div className="text-base font-bold font-mono text-amber-300 mt-1">
                  {userCredits} A2A Credits
                </div>
              </div>
            </div>

            {creditNotice && (
              <div className="p-2 bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-xs font-mono rounded text-center animate-fade-in">
                {creditNotice}
              </div>
            )}
          </div>

          {/* Marketplace Filter, Search & Sorting Toolbar */}
          <div className="bg-slate-900/90 border border-cyan-900/60 rounded-xl p-4 shadow-lg space-y-3">
            <div className="flex flex-col md:flex-row items-center justify-between gap-3">
              {/* Search input */}
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Sök skill, nod-ID, modelfile, NPU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Trade Type & Sorting Controls */}
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-between md:justify-end">
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
                  <span className="text-[10px] text-slate-500 px-1">Handel:</span>
                  {(['all', 'free', 'paid'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setTradeTypeFilter(type)}
                      className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold transition-colors ${
                        tradeTypeFilter === type
                          ? 'bg-cyan-600 text-slate-950'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {type === 'all' ? 'Alla' : type === 'free' ? 'Gratis' : 'Betalda'}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
                  <span className="text-[10px] text-slate-500 px-1">Sortera:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="bg-transparent text-cyan-300 text-xs focus:outline-none font-bold"
                  >
                    <option value="reputation">Högst P2P Rykte</option>
                    <option value="downloads">Mest Handlade</option>
                    <option value="price">Lägst Pris</option>
                  </select>
                </div>

                {/* Publish Custom Skill Button */}
                <button
                  onClick={() => setShowPublishModal(true)}
                  className="px-3 py-2 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-md"
                >
                  <Plus className="w-4 h-4" />
                  <span>Sälj/Publicera Skill</span>
                </button>
              </div>
            </div>

            {/* Category Pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80">
              <span className="text-[11px] font-mono text-slate-400 mr-2 flex items-center gap-1">
                <Filter className="w-3 h-3" /> Kategori:
              </span>
              {[
                'Alla',
                'LLM & Ollama',
                'Code & AST',
                'Hardware & NPU',
                'Git & Cloudflare',
                'Security & Audit',
                'API & Integration'
              ].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${
                    selectedCategory === cat
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/60 font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Marketplace Grid with Peer-to-Peer Agent Skill Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMarketplaceSkills.map((skill) => {
              const reputationPct = skill.reputationScore ?? (skill.rating * 20);
              const isFree = skill.priceCredits === 0;

              return (
                <div
                  key={skill.id}
                  className="bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-5 space-y-3.5 shadow-md hover:shadow-cyan-500/10 transition-all flex flex-col justify-between relative group"
                >
                  <div className="space-y-2.5">
                    {/* Header: Category & Peer Reputation Badge */}
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-slate-950 text-cyan-300 border border-slate-800 uppercase font-bold">
                        {skill.category}
                      </span>
                      
                      {/* P2P Reputation Badge */}
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 font-bold">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>{reputationPct}% P2P Trust</span>
                      </div>
                    </div>

                    {/* Title & Seller Peer Node */}
                    <div>
                      <h3 className="text-sm font-bold text-slate-100 flex items-center justify-between gap-2">
                        <span>{skill.name}</span>
                        <span className="text-[10px] font-mono text-slate-400 font-normal">v{skill.version}</span>
                      </h3>
                      <div className="flex items-center justify-between mt-1 text-[11px] font-mono text-slate-400">
                        <span className="text-cyan-400 flex items-center gap-1">
                          <Bot className="w-3 h-3" /> {skill.author}
                        </span>
                        {skill.peerNodeId && (
                          <span className="text-[10px] text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                            {skill.peerNodeId}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Tagline & Description */}
                    <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium">
                      {skill.tagline}
                    </p>

                    <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
                      {skill.description}
                    </p>

                    {/* Trade stats bar */}
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
                      <span className="flex items-center gap-1 text-slate-300">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {skill.rating} / 5.0
                      </span>
                      <span>{skill.tradingVolume ?? skill.downloadsCount} P2P Handlar</span>
                      <span className="text-cyan-400">{skill.licenseType || 'A2A Royalty-Free'}</span>
                    </div>

                    {/* Requirements Badges */}
                    <div className="flex flex-wrap gap-1">
                      {skill.requirements.map((req, idx) => (
                        <span key={idx} className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                          {req}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Price & One-Click Install Action Buttons */}
                  <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-400">P2P Pris:</span>
                      <span className="font-bold text-amber-300 flex items-center gap-1">
                        {isFree ? (
                          <span className="text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                            GRATIS
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-300 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                            <Coins className="w-3.5 h-3.5 text-amber-400" />
                            <span>{skill.priceCredits} A2A Credits</span>
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Buttons: One-Click Install & Inspect */}
                    <div className="grid grid-cols-12 gap-2">
                      <button
                        onClick={() => setInspectingSkill(skill)}
                        className="col-span-4 py-2 bg-slate-950 hover:bg-slate-800 text-slate-300 text-xs font-mono rounded-lg border border-slate-800 flex items-center justify-center gap-1 transition-colors"
                        title="Visa P2P Rykte & Modelfile Källkod"
                      >
                        <Eye className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Info</span>
                      </button>

                      {/* Prominent ONE-CLICK INSTALL Button */}
                      <button
                        onClick={() => handleStartDeploySkill(skill)}
                        disabled={skill.status === 'DEPLOYED'}
                        className={`col-span-8 py-2 text-xs font-mono font-bold rounded-lg border flex items-center justify-center gap-1.5 transition-all shadow-md ${
                          skill.status === 'DEPLOYED'
                            ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 cursor-default'
                            : 'bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.3)]'
                        }`}
                      >
                        {skill.status === 'DEPLOYED' ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span>Installerad i Ollama</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 text-slate-950 fill-slate-950" />
                            <span>⚡ Enklicks-Installera</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: MY DEPLOYED OLLAMA PLUGINS */}
      {activeStudioTab === 'deployed' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono font-bold text-slate-200 flex items-center gap-2">
              <PackageCheck className="w-4 h-4 text-emerald-400" />
              Aktiva Distribuerade Plugins i Din Lokala Ollama-Miljö ({deployedCount})
            </span>
            <span className="text-xs font-mono text-cyan-400">
              Ollama Host: http://localhost:11434
            </span>
          </div>

          <div className="space-y-3">
            {marketplaceSkills.filter(s => s.status === 'DEPLOYED').length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-500 font-mono">
                Inga agentic skills har distribuerats till din lokala Ollama-miljö ännu. Bläddra i Marketplace för att aktivera plugins.
              </div>
            ) : (
              marketplaceSkills.filter(s => s.status === 'DEPLOYED').map((skill) => (
                <div key={skill.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100 text-sm">{skill.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono font-bold">
                        AKTIV I OLLAMA
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Distribuerad: {skill.deployedAt || 'Nyss'}
                    </span>
                  </div>

                  <p className="text-slate-300 text-xs">{skill.tagline}</p>

                  <div className="bg-slate-900 p-2.5 rounded border border-slate-800 font-mono text-[11px] text-slate-300 space-y-1">
                    <div className="text-cyan-400 font-bold">Ollama Modelfile Inställningar:</div>
                    <pre className="text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap">
                      {skill.modelfileContent || 'FROM qwen2.5-coder:7b'}
                    </pre>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setInspectingSkill(skill)}
                      className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-mono rounded border border-slate-700"
                    >
                      Inspektera Kod & Schema
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: ANTIGRAVITY MISSION BRIDGE */}
      {activeStudioTab === 'bridge' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Dispatch Panel (7 cols) */}
          <div className="lg:col-span-7 bg-slate-900/90 border border-cyan-900/60 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-cyan-900/40 pb-3">
              <span className="text-xs font-mono font-semibold text-cyan-300 flex items-center gap-2">
                <Bot className="w-4 h-4 text-cyan-400" />
                1. Formulera Antigravity-Uppdrag
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Källkod: {codeFiles.length} filer
              </span>
            </div>

            <div>
              <label className="text-[11px] font-mono text-slate-400 block mb-1.5">
                Snabba Uppdragstermer:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Refaktorisera källkod & typsäkerhet',
                  'Prestandaoptimera NPU-matriser',
                  'Generera automatiserade enhetstester',
                  'Bygg en ny funktion & koppla till UI',
                  'Verifiera felhantering i alla API:er'
                ].map((template, idx) => (
                  <button
                    key={idx}
                    onClick={() => setMissionPrompt(template)}
                    className="px-2.5 py-1 rounded bg-slate-950 hover:bg-cyan-950 text-slate-300 hover:text-cyan-200 border border-slate-800 hover:border-cyan-500/40 text-xs font-sans transition-colors text-left"
                  >
                    + {template}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-mono font-medium text-slate-300 block mb-1.5">
                Uppdragsbeskrivning (Prompt till Antigravity):
              </label>
              <textarea
                rows={5}
                value={missionPrompt}
                onChange={(e) => setMissionPrompt(e.target.value)}
                placeholder="Beskriv vad du vill att Antigravity-agenten ska utföra i projektet..."
                className="w-full bg-slate-950 border border-cyan-900/80 rounded-lg p-3 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 leading-relaxed resize-y"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">
                  Målagent / Modell:
                </label>
                <select
                  value={selectedAgentModel}
                  onChange={(e) => setSelectedAgentModel(e.target.value)}
                  className="w-full bg-slate-950 border border-cyan-900/80 rounded-lg px-3 py-2 text-xs font-mono text-cyan-200 focus:outline-none focus:border-cyan-400"
                >
                  <option value="antigravity-preview-05-2026">antigravity-preview-05-2026 (Antigravity Agent)</option>
                  <option value="gemini-3.6-flash">gemini-3.6-flash (Snabbt svar)</option>
                  <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Djup resonemang)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">
                  Aktiv Filkontext:
                </label>
                <div className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 truncate">
                  {activeFilePath || 'src/App.tsx'}
                </div>
              </div>
            </div>

            {statusMessage && (
              <div className={`p-3 rounded-lg border text-xs font-mono leading-relaxed ${
                statusMessage.includes('[SUCCESS]') || statusMessage.includes('[PATCH APPLIED]')
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  : statusMessage.includes('[ERROR]') || statusMessage.includes('[EXCEPTION]')
                  ? 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                  : 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300'
              }`}>
                {statusMessage}
              </div>
            )}

            <button
              onClick={handleDispatchMission}
              disabled={isSending || !missionPrompt.trim()}
              className="w-full py-3 bg-gradient-to-r from-cyan-600 via-teal-600 to-cyan-600 hover:from-cyan-500 hover:to-teal-500 disabled:opacity-50 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all flex items-center justify-center gap-2"
            >
              {isSending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Exekverar Uppdrag i Antigravity...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 text-slate-950" />
                  <span>Skicka Uppdrag via Antigravity-bryggan</span>
                </>
              )}
            </button>
          </div>

          {/* Result Output (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-900/90 border border-cyan-900/60 rounded-xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-cyan-900/40 pb-3">
                <span className="text-xs font-mono font-semibold text-cyan-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  2. Exekveringsresultat
                </span>
                {activeMissionResult && (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    SLUTFÖRD
                  </span>
                )}
              </div>

              {activeMissionResult ? (
                <div className="space-y-4">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs font-mono space-y-1">
                    <div className="flex justify-between text-slate-400 text-[11px]">
                      <span>Uppdrags-ID: <strong className="text-cyan-300">{activeMissionResult.id}</strong></span>
                      <span>{activeMissionResult.timestamp}</span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-mono font-bold text-slate-300 mb-1">Sammanfattning:</h4>
                    <p className="text-xs text-slate-200 leading-relaxed bg-slate-950 p-3 rounded-lg border border-cyan-950">
                      {activeMissionResult.summary}
                    </p>
                  </div>

                  {activeMissionResult.generatedPatch && (
                    <div className="p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-lg space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono text-cyan-300 font-bold">
                        <span className="flex items-center gap-1.5">
                          <Code2 className="w-4 h-4 text-cyan-400" />
                          Genererad Kodändring
                        </span>
                      </div>
                      <button
                        onClick={() => handleApplyPatch(activeMissionResult.generatedPatch!)}
                        className="w-full py-2 bg-cyan-900 text-cyan-200 font-bold text-xs rounded border border-cyan-500/50"
                      >
                        Applicera Patch på {activeMissionResult.generatedPatch.targetFilePath}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg space-y-2">
                  <Bot className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400">Ingen aktiv exekvering. Skicka ett uppdrag till Antigravity till vänster.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: AUTONOMOUS AGENTCARD MULTI-MARKETPLACE PUBLISHER */}
      {activeStudioTab === 'agentcard' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-slate-900/90 border border-amber-500/50 rounded-xl p-5 shadow-xl space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-amber-400" />
                  <h2 className="text-base font-bold text-slate-100 font-mono">
                    Autonom Multi-Marketplace AgentCard Publicerare
                  </h2>
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40 text-[10px] font-mono font-bold">
                    A2A Protocol v1.0
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-sans leading-relaxed">
                  Skapa ett standardiserat <code className="text-amber-300 font-mono">agentcard.json</code>-manifest och publicera din autonomt verksamma agent direkt till flera globala agentmarknadsplatser samtidigt.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadAgentCardJson}
                  className="px-3 py-2 bg-slate-950 hover:bg-slate-800 text-slate-200 text-xs font-mono font-bold rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors"
                  title="Ladda ner agentcard.json filen"
                >
                  <DownloadCloud className="w-4 h-4 text-amber-400" />
                  <span>Spara agentcard.json</span>
                </button>
              </div>
            </div>

            {/* Target Networks Summary Badges */}
            <div className="pt-3 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <Store className="w-3.5 h-3.5 text-cyan-400" /> JACO P2P
                </span>
                <span className="text-emerald-400 font-bold">Aktiv Nod</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5 text-purple-400" /> OpenClaw Hub
                </span>
                <span className="text-emerald-400 font-bold">RPC Redo</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-amber-400" /> Hugging Face
                </span>
                <span className="text-emerald-400 font-bold">Agent Registry</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <Network className="w-3.5 h-3.5 text-emerald-400" /> Fetch.ai uAgents
                </span>
                <span className="text-emerald-400 font-bold">Almanacka Sync</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Form & Marketplace Selector */}
            <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg text-xs font-sans">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-2">
                <Bot className="w-4 h-4 text-amber-400" />
                <span>1. Konfigurera AgentCard Manifest & Monetisering</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-slate-300 font-mono text-[11px] block">Agent Namn</label>
                  <input
                    type="text"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded p-2 text-xs font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-mono text-[11px] block">Version</label>
                  <input
                    type="text"
                    value={cardVersion}
                    onChange={(e) => setCardVersion(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded p-2 text-xs font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-mono text-[11px] block">Beskrivning & Huvudsyfte</label>
                <textarea
                  rows={3}
                  value={cardDesc}
                  onChange={(e) => setCardDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded p-2 text-xs font-sans focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-300 font-mono text-[11px] block">P2P Licensmodell</label>
                  <select
                    value={cardLicense}
                    onChange={(e) => setCardLicense(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-purple-300 text-xs font-mono rounded p-2 focus:outline-none"
                  >
                    <option value="A2A Royalty-Free">A2A Royalty-Free</option>
                    <option value="P2P Per-Call License">P2P Per-Call License</option>
                    <option value="Open-Source P2P">Open-Source P2P</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-mono text-[11px] block">Pris (A2A Credits per anrop)</label>
                  <input
                    type="number"
                    value={cardPrice}
                    onChange={(e) => setCardPrice(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 text-amber-300 text-xs font-mono rounded p-2 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Target Marketplaces Checkboxes */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <label className="text-slate-200 font-mono font-bold text-xs flex items-center justify-between">
                  <span>Välj Målmarknadsplatser för Autonom Publicering:</span>
                  <span className="text-[10px] text-amber-400">{selectedMarkets.length} Valda</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
                  {[
                    { id: 'jaco-p2p', label: 'JACO P2P Agent Network', desc: 'Lokalt A2A-nätverk & plånbok' },
                    { id: 'openclaw-hub', label: 'OpenClaw Agent Hub', desc: 'Remote execution CLI & RPC' },
                    { id: 'huggingface', label: 'Hugging Face Agent Registry', desc: 'Global agent model hub' },
                    { id: 'fetch-ai', label: 'Fetch.ai / uAgents Mesh', desc: 'uAgent Almanacka discovery' },
                    { id: 'custom-mesh', label: 'Custom A2A Peer Mesh', desc: 'Sänd direkt till anpassad peer url' }
                  ].map((m) => {
                    const isChecked = selectedMarkets.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`p-2.5 rounded-lg border cursor-pointer flex items-start gap-2.5 transition-all ${
                          isChecked
                            ? 'bg-amber-950/40 border-amber-500/60 text-slate-100'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSelectedMarkets(selectedMarkets.filter(x => x !== m.id));
                            } else {
                              setSelectedMarkets([...selectedMarkets, m.id]);
                            }
                          }}
                          className="mt-0.5 accent-amber-500"
                        />
                        <div>
                          <span className="font-bold block text-xs">{m.label}</span>
                          <span className="text-[10px] text-slate-400 font-sans block">{m.desc}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {selectedMarkets.includes('custom-mesh') && (
                  <div className="mt-2 p-2 bg-slate-950 border border-slate-800 rounded space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 block">Anpassad Peer Endpoint URL:</label>
                    <input
                      type="text"
                      value={customPeerUrl}
                      onChange={(e) => setCustomPeerUrl(e.target.value)}
                      placeholder="https://peer-agent.network/a2a/invoke"
                      className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono rounded p-1.5 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Action Button */}
              <div className="pt-3">
                <button
                  onClick={handlePublishAgentCardToAll}
                  disabled={isPublishingCard || selectedMarkets.length === 0}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-mono font-bold text-xs rounded-xl shadow-[0_0_20px_rgba(245,158,11,0.3)] flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isPublishingCard ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sänder & Registrerar på Alla Valda Marknadsplatser...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 fill-slate-950" />
                      <span>🚀 Autonomt Generera & Publicera AgentCard till Alla Marknadsplatser</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Right Column: Live AgentCard Preview & Sync Results */}
            <div className="lg:col-span-5 space-y-4">
              {/* AgentCard JSON Manifest Preview */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2.5 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-300">
                    <FileCode className="w-4 h-4" />
                    <span>Förhandsgranskning: agentcard.json</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">A2A Spec v1.0</span>
                </div>

                <pre className="p-3 bg-slate-950 rounded-lg text-[10px] font-mono text-cyan-300 overflow-x-auto max-h-64 border border-slate-800 leading-relaxed">
{JSON.stringify(publishedCardResult?.agentCard || {
  schemaVersion: "1.0.0-A2A",
  nodeId: "node-jaco-os-master-01",
  name: cardName,
  version: cardVersion,
  description: cardDesc,
  license: cardLicense,
  capabilities: [
    "A2A-RPC Task Delegation",
    "Ollama Local LLM AST Parsing",
    "Snapdragon NPU Tensor Acceleration",
    "OpenClaw Web Execution"
  ],
  endpoints: {
    agentCardUrl: "/api/a2a/agentcard.json",
    invokeUrl: "/api/a2a/invoke"
  },
  cryptographicSignature: "0x8F9a42E8...ECDSA256_VERIFIED"
}, null, 2)}
                </pre>
              </div>

              {/* Sync Results Console */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-200">
                    <Network className="w-4 h-4 text-emerald-400" />
                    <span>Publiceringsstatus för Marknadsplatser</span>
                  </div>
                  {publishedCardResult && (
                    <span className="text-[10px] font-mono text-emerald-400 font-bold">
                      {publishedCardResult.timestamp}
                    </span>
                  )}
                </div>

                {publishedCardResult ? (
                  <div className="space-y-2">
                    {publishedCardResult.syncResults?.map((res: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-1 text-xs font-mono"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            {res.marketplace}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                            {res.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-sans">{res.details}</p>
                        <div className="flex items-center justify-between text-[9px] text-slate-500 pt-1 border-t border-slate-900">
                          <span>Tx: {res.transactionId}</span>
                          <a
                            href={res.verifiedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-400 hover:underline flex items-center gap-0.5"
                          >
                            <span>Verifiera</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center border border-dashed border-slate-800 rounded-lg space-y-1 text-xs font-mono text-slate-400">
                    <Share2 className="w-6 h-6 text-slate-600 mx-auto" />
                    <p>Klicka på knappen för att starta autonom distribution.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 5: A2A WORKFLOW TELEMETRY DASHBOARD */}
      {activeStudioTab === 'a2a_dashboard' && (
        <A2AWorkflowDashboard />
      )}

      {/* INSPECT SKILL & PEER REPUTATION MODAL */}
      {inspectingSkill && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl text-xs font-sans">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Store className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100">{inspectingSkill.name}</h3>
                  <p className="text-[11px] font-mono text-cyan-400 flex items-center gap-2">
                    <span>Av {inspectingSkill.author}</span>
                    <span>•</span>
                    <span>v{inspectingSkill.version}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectingSkill(null)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* P2P Seller & Reputation Metadata Box */}
            <div className="bg-slate-950 p-3 rounded-lg border border-cyan-900/40 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
              <div>
                <span className="text-slate-500 block text-[9px] uppercase">P2P Säljar-Nod</span>
                <span className="text-cyan-300 font-bold">{inspectingSkill.peerNodeId || 'node-a2a-peer-01'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[9px] uppercase">P2P Trust Score</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  {inspectingSkill.reputationScore ?? (inspectingSkill.rating * 20)}%
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[9px] uppercase">Kryptografisk Signatur</span>
                <span className="text-purple-300 font-bold">ECDSA-256 Valid</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[9px] uppercase">Licensmodell</span>
                <span className="text-amber-300 font-bold">{inspectingSkill.licenseType || 'A2A Royalty-Free'}</span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-slate-300 mb-1">Beskrivning:</h4>
              <p className="text-slate-300 leading-relaxed font-sans">{inspectingSkill.description}</p>
            </div>

            <div className="space-y-1">
              <h4 className="font-bold text-cyan-300 font-mono">Modelfile Konfiguration (Ollama):</h4>
              <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-200 whitespace-pre-wrap overflow-x-auto">
                {inspectingSkill.modelfileContent || 'FROM qwen2.5:7b'}
              </pre>
            </div>

            <div className="space-y-1">
              <h4 className="font-bold text-cyan-300 font-mono">Plugin TypeScript Källkod:</h4>
              <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-emerald-300 whitespace-pre-wrap overflow-x-auto">
                {inspectingSkill.pluginCode}
              </pre>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-between items-center">
              <div className="font-bold font-mono">
                <span className="text-slate-400 text-[11px] block">P2P Pris:</span>
                <span className="text-amber-300 text-sm">
                  {inspectingSkill.priceCredits === 0 ? '0 Credits (GRATIS)' : `${inspectingSkill.priceCredits} A2A Credits`}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setInspectingSkill(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-mono text-xs font-semibold"
                >
                  Stäng
                </button>
                {inspectingSkill.status !== 'DEPLOYED' && (
                  <button
                    onClick={() => {
                      const target = inspectingSkill;
                      setInspectingSkill(null);
                      handleStartDeploySkill(target);
                    }}
                    className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-mono font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-md"
                  >
                    <Zap className="w-4 h-4 text-slate-950 fill-slate-950" />
                    <span>⚡ Enklicks-Installera Nu</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DEPLOYMENT PROGRESS MODAL */}
      {deployingSkill && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/50 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs font-mono">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <DownloadCloud className="w-6 h-6 text-cyan-400 animate-bounce" />
              <div>
                <h3 className="text-sm font-bold text-slate-100">Distribuerar till Lokal Ollama</h3>
                <p className="text-[11px] text-slate-400">{deployingSkill.name}</p>
              </div>
            </div>

            {/* Deployment Log Stream */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5 max-h-48 overflow-y-auto">
              {deployLog.map((log, idx) => (
                <div key={idx} className={`text-[11px] ${log.includes('[SUCCESS]') ? 'text-emerald-400 font-bold' : 'text-cyan-300'}`}>
                  {log}
                </div>
              ))}
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-cyan-500 h-full transition-all duration-500"
                style={{ width: `${deployStep * 25}%` }}
              />
            </div>

            <div className="flex justify-end pt-2">
              {deployStep === 4 ? (
                <button
                  onClick={() => {
                    setDeployingSkill(null);
                    setDeployStep(0);
                    setActiveStudioTab('deployed');
                  }}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg transition-colors"
                >
                  Slutfört - Visa Mina Plugins
                </button>
              ) : (
                <span className="text-slate-400 text-[11px] flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  Installerar modelfile...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 6: GIT-BRIDGE SAVEPOINT REPOSITORY */}
      {activeStudioTab === 'git_bridge' && (
        <div className="space-y-6 animate-fade-in">
          {/* Header Card */}
          <div className="bg-slate-900/90 border border-emerald-900/70 rounded-xl p-5 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <GitBranch className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <span>Antigravity Git-Bridge Repository</span>
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      [REAL] Auto-Savepoint Enabled
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Övervakar automatiskt arbetsflödes-patchar i workspace och skapar Savepoint commits i det lokala Git-arkivet.
                  </p>
                </div>
              </div>

              <button
                onClick={refreshGitBridge}
                className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>Uppdatera Status</span>
              </button>
            </div>

            {/* Git Stats Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">Git Gren (Branch)</div>
                <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{gitStatus?.branch || 'main'}</span>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">Totalt Savepoint Commits</div>
                <div className="text-sm font-bold font-mono text-cyan-300 mt-0.5">
                  {gitSavepoints.length} commits
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">Status för Workspacet</div>
                <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${gitStatus?.clean ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                  <span>{gitStatus?.clean ? 'Rent (Inga osparade ändringar)' : `${gitStatus?.uncommittedChangesCount || 1} modifierade filer`}</span>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">Senaste Savepoint</div>
                <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">
                  {gitStatus?.lastSavepointAt || gitSavepoints[0]?.timestamp || 'Nyligen'}
                </div>
              </div>
            </div>

            {/* Manual Savepoint Commit Form */}
            <form onSubmit={handleManualSavepointCommit} className="pt-2 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={manualCommitMsg}
                onChange={e => setManualCommitMsg(e.target.value)}
                placeholder="Skriv ett manuellt Savepoint commit-meddelande (t.ex. 'Savepoint: Refaktorerade UI och fixade varningar')..."
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isCreatingSavepoint}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold font-mono rounded-lg text-xs flex items-center justify-center gap-2 shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all"
              >
                {isCreatingSavepoint ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                ) : (
                  <GitCommit className="w-4 h-4 text-slate-950" />
                )}
                <span>Skapa Savepoint Commit</span>
              </button>
            </form>
          </div>

          {/* Savepoint History Log */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2 font-mono">
                <History className="w-4 h-4 text-cyan-400" />
                <span>Savepoint Commit Historik ({gitSavepoints.length})</span>
              </h4>
              <span className="text-[11px] font-mono text-slate-400">
                Klicka på 'Återställ' för att gå tillbaka till en tidigare Savepoint.
              </span>
            </div>

            <div className="space-y-3">
              {gitSavepoints.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-slate-500 border border-dashed border-slate-800 rounded-lg">
                  Inga Savepoint commits har skapats ännu. Tillämpa en patch för att skapa ett automatiskt Savepoint!
                </div>
              ) : (
                gitSavepoints.map(sp => (
                  <div
                    key={sp.id}
                    className={`p-4 rounded-xl border transition-all ${
                      sp.status === 'REVERTED'
                        ? 'bg-slate-950/40 border-slate-800/60 opacity-60'
                        : 'bg-slate-950 border-slate-800/80 hover:border-emerald-500/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1.5 max-w-2xl">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 text-xs font-mono font-bold rounded">
                            {sp.hash}
                          </code>
                          <span className="text-xs font-bold font-sans text-slate-100">
                            {sp.message}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                            {sp.status}
                          </span>
                        </div>

                        {sp.description && (
                          <p className="text-xs text-slate-400 font-sans">
                            {sp.description}
                          </p>
                        )}

                        <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pt-1">
                          <span className="flex items-center gap-1">
                            <Bot className="w-3 h-3 text-cyan-400" />
                            <span>{sp.author}</span>
                          </span>

                          {sp.targetFilePath && (
                            <span className="flex items-center gap-1 text-amber-300">
                              <FileCode className="w-3 h-3" />
                              <span>{sp.targetFilePath}</span>
                            </span>
                          )}

                          <span className="text-slate-400">{sp.timestamp}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRevertSavepoint(sp.hash)}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                          title="Återställ koden till detta Savepoint"
                        >
                          <History className="w-3.5 h-3.5 text-amber-400" />
                          <span>Återställ till Savepoint</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* PUBLISH CUSTOM SKILL MODAL */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handlePublishNewSkill} className="bg-slate-900 border border-cyan-500/40 rounded-xl max-w-xl w-full p-5 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" /> Publicera Ny Skill till A2A Marketplace
              </h3>
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-slate-300 block mb-1">Namn på Skill</label>
                <input
                  type="text"
                  required
                  placeholder="t.ex. Ollama CyberAudit Pro"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded p-2 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1">Kort Tagline</label>
                <input
                  type="text"
                  required
                  placeholder="t.ex. Automatisk säkerhetskontroll för lokala portar."
                  value={newSkillTagline}
                  onChange={(e) => setNewSkillTagline(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded p-2 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1">Detaljerad Beskrivning</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Beskriv vad din skill utför..."
                  value={newSkillDesc}
                  onChange={(e) => setNewSkillDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded p-2 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1">Kategori</label>
                  <select
                    value={newSkillCategory}
                    onChange={(e) => setNewSkillCategory(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-cyan-300 text-xs rounded p-2 focus:outline-none"
                  >
                    <option value="LLM & Ollama">LLM & Ollama</option>
                    <option value="Code & AST">Code & AST</option>
                    <option value="Hardware & NPU">Hardware & NPU</option>
                    <option value="Git & Cloudflare">Git & Cloudflare</option>
                    <option value="Security & Audit">Security & Audit</option>
                    <option value="API & Integration">API & Integration</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 block mb-1">P2P Licens</label>
                  <select
                    value={newSkillLicense}
                    onChange={(e) => setNewSkillLicense(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-purple-300 text-xs rounded p-2 focus:outline-none"
                  >
                    <option value="A2A Royalty-Free">A2A Royalty-Free</option>
                    <option value="P2P Per-Call License">P2P Per-Call License</option>
                    <option value="Open-Source P2P">Open-Source P2P</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 block mb-1">Pris (A2A Credits)</label>
                  <input
                    type="number"
                    min={0}
                    value={newSkillPrice}
                    onChange={(e) => setNewSkillPrice(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 text-amber-300 text-xs rounded p-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-mono">Modelfile Innehåll (Ollama)</label>
                <textarea
                  rows={4}
                  value={newSkillModelfile}
                  onChange={(e) => setNewSkillModelfile(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-emerald-300 font-mono text-[11px] rounded p-2 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                className="px-4 py-1.5 bg-slate-800 text-slate-200 rounded font-semibold"
              >
                Avbryt
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded"
              >
                Publicera Skill
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SECRETS & API KEYS STATUS AUDIT MODAL */}
      {showSecretsModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/50 rounded-2xl p-6 max-w-2xl w-full space-y-4 shadow-2xl font-sans">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-slate-100 font-mono">
                  🔑 JACO System Secrets & API Keys Audit
                </h3>
              </div>
              <button
                onClick={() => setShowSecretsModal(false)}
                className="text-slate-400 hover:text-slate-100 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Automatisk verifiering av miljövariabler och API-nycklar inlästa i runtime via <code className="text-amber-300 font-mono">process.env</code>.
            </p>

            {secretsAuditData ? (
              <div className="space-y-3">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="text-slate-400">Totalt Identifierade Nycklar: </span>
                    <span className="text-amber-300 font-bold">{secretsAuditData.totalConfigured} / {secretsAuditData.totalChecked} Active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Gemini AI Engine: </span>
                    <span className={secretsAuditData.hasGeminiClient ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                      {secretsAuditData.hasGeminiClient ? "[REAL] Ansluten" : "[EJE_KONFIGURERAD]"}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {secretsAuditData.secrets?.map((s: any) => (
                    <div
                      key={s.key}
                      className={`p-3 rounded-lg border flex items-center justify-between text-xs font-mono transition-all ${
                        s.configured
                          ? 'bg-slate-950/80 border-emerald-500/40'
                          : 'bg-slate-950/40 border-slate-800/80 opacity-70'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-200">{s.label}</span>
                          <code className="text-[10px] text-slate-500">({s.key})</code>
                        </div>
                        <span className="text-[10px] text-slate-400 font-sans block">{s.service}</span>
                      </div>

                      <div className="text-right space-y-1">
                        <span
                          className={`inline-block text-[10px] px-2 py-0.5 rounded font-bold ${
                            s.configured
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-slate-900 text-slate-500 border border-slate-800'
                          }`}
                        >
                          {s.configured ? '[REAL] Aktiv' : 'Ej angiven'}
                        </span>
                        {s.configured && (
                          <span className="block text-[10px] text-amber-300 font-mono">
                            {s.maskedPreview}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs font-mono text-slate-400">
                Laddar miljövariabler...
              </div>
            )}

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>Märkning: [REAL] verifierat i runtime</span>
              <button
                onClick={() => setShowSecretsModal(false)}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition-colors"
              >
                Stäng Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
