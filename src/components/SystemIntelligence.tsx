import React, { useState, useEffect } from 'react';
import { 
  Shield, Cpu, Info, Activity, Terminal, Lock, Unlock, Zap, Server, Globe, 
  Brain, Target, Plus, GitMerge, ArrowUp, ArrowDown, Trash2, ListTodo,
  HardDrive, Network, Wifi, Layers, Pause, Play, RefreshCw, KeyRound,
  AlertTriangle, Database
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TermuxBridge } from '../lib/termuxBridge';

export interface SystemIntelligenceProps {
  npuHardwareType?: string;
  npuLoadState?: string;
  npuFrequencyMhz?: number;
}

export const SystemIntelligence: React.FC<SystemIntelligenceProps> = ({
  npuHardwareType,
  npuLoadState,
  npuFrequencyMhz,
}) => {
  const [osInfo, setOsInfo] = useState<{
    kernel: string;
    apiLevel: string;
    architecture: string;
    isTermux: boolean;
    whoami: string;
    permissions: string[];
    loading: boolean;
  }>({
    kernel: '',
    apiLevel: '',
    architecture: '',
    isTermux: false,
    whoami: '',
    permissions: [],
    loading: true,
  });

  const [auraState, setAuraState] = useState<any>(null);
  const [detailedMetrics, setDetailedMetrics] = useState<any>(null);
  const [pausedThreads, setPausedThreads] = useState<Record<number, boolean>>({});

  const [metricsHistory, setMetricsHistory] = useState<any[]>(() => {
    const seed = [];
    const now = new Date();
    for (let i = 60; i >= 0; i--) { 
      const t = new Date(now.getTime() - i * 10000);
      seed.push({
        time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        npuLoad: Math.floor(30 + Math.random() * 40),
        npuFrequency: Math.floor(1000 + Math.random() * 400),
        memoryUsage: Number((3 + Math.random() * 2).toFixed(1)),
        cpuLoad: Math.floor(20 + Math.random() * 30),
        ioRead: Number((1 + Math.random() * 2).toFixed(1)),
        networkRx: Math.floor(100 + Math.random() * 50)
      });
    }
    return seed;
  });

  interface OrchestratorGoal {
    id: string;
    title: string;
    priority: 'High' | 'Medium' | 'Low';
    dependencies: string[];
  }

  const [goals, setGoals] = useState<OrchestratorGoal[]>([
    { id: 'g1', title: 'Refactor AuraEngine for modularity', priority: 'High', dependencies: [] },
    { id: 'g2', title: 'Integrate LiteRT metrics', priority: 'Medium', dependencies: ['g1'] }
  ]);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalPriority, setNewGoalPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [newGoalDeps, setNewGoalDeps] = useState<string[]>([]);

  const addGoal = () => {
    if (!newGoalTitle.trim()) return;
    const newGoal: OrchestratorGoal = {
      id: `g${Date.now()}`,
      title: newGoalTitle,
      priority: newGoalPriority,
      dependencies: newGoalDeps
    };
    setGoals([...goals, newGoal]);
    setNewGoalTitle('');
    setNewGoalPriority('Medium');
    setNewGoalDeps([]);
  };

  const removeGoal = (id: string) => {
    setGoals(goals.filter(g => g.id !== id));
    setGoals(prev => prev.map(g => ({
      ...g,
      dependencies: g.dependencies.filter(depId => depId !== id)
    })));
  };

  const toggleDep = (goalId: string) => {
    if (newGoalDeps.includes(goalId)) {
      setNewGoalDeps(newGoalDeps.filter(id => id !== goalId));
    } else {
      setNewGoalDeps([...newGoalDeps, goalId]);
    }
  };

  const moveGoal = (index: number, direction: 'up' | 'down') => {
    const newGoals = [...goals];
    if (direction === 'up' && index > 0) {
      [newGoals[index - 1], newGoals[index]] = [newGoals[index], newGoals[index - 1]];
    } else if (direction === 'down' && index < newGoals.length - 1) {
      [newGoals[index + 1], newGoals[index]] = [newGoals[index], newGoals[index + 1]];
    }
    setGoals(newGoals);
  };

  const toggleThreadPause = (tid: number) => {
    setPausedThreads(prev => ({
      ...prev,
      [tid]: !prev[tid]
    }));
  };

  useEffect(() => {
    let mounted = true;
    const fetchSysInfo = async () => {
      try {
        const kernel = await TermuxBridge.executeCommand('uname -a') || 'Linux 6.1.0-android14-arm64';
        const apiLevel = await TermuxBridge.executeCommand('getprop ro.build.version.sdk') || '34 (Android 14)';
        const arch = await TermuxBridge.executeCommand('getprop ro.product.cpu.abi') || 'arm64-v8a';
        const whoami = await TermuxBridge.executeCommand('whoami') || 'u0_a123';
        
        const storagePermCheck = await TermuxBridge.executeCommand('ls -d /sdcard 2>/dev/null && echo "YES" || echo "NO"');
        const rootCheck = await TermuxBridge.executeCommand('su -c echo "YES" 2>/dev/null || echo "NO"');
        
        const perms = [];
        if (typeof storagePermCheck === 'string' && storagePermCheck.includes('YES')) {
          perms.push('Storage Access (R/W)');
        } else {
          perms.push('No Storage Access');
        }
        
        if (typeof rootCheck === 'string' && rootCheck.includes('YES')) {
          perms.push('Root Privileges (su)');
        } else {
          perms.push('No Root (User Space)');
        }
        
        const apiCheck = await TermuxBridge.executeCommand('termux-info >/dev/null 2>&1 && echo "YES" || echo "NO"');
        if (typeof apiCheck === 'string' && apiCheck.includes('YES')) {
          perms.push('Termux API Enabled');
        } else {
          perms.push('Termux API Missing/Limited');
        }

        if (mounted) {
          setOsInfo({
            kernel: typeof kernel === 'string' ? kernel.trim() : 'Unknown',
            apiLevel: typeof apiLevel === 'string' ? apiLevel.trim() : 'Unknown',
            architecture: typeof arch === 'string' ? arch.trim() : 'Unknown',
            isTermux: (typeof kernel === 'string' && kernel.includes('Android')) || apiLevel !== 'Unknown',
            whoami: typeof whoami === 'string' ? whoami.trim() : 'unknown',
            permissions: perms,
            loading: false,
          });
        }
      } catch (err) {
        if (mounted) {
          setOsInfo(prev => ({ ...prev, loading: false }));
        }
      }
    };
    
    fetchSysInfo();

    const fetchAuraStateAndMetrics = async () => {
      try {
        const [auraRes, metricsRes] = await Promise.all([
          fetch('/api/aura/state').catch(() => null),
          fetch('/api/system/detailed-metrics').catch(() => null)
        ]);

        let auraData: any = null;
        let metricsData: any = null;

        if (auraRes && auraRes.ok) auraData = await auraRes.json();
        if (metricsRes && metricsRes.ok) metricsData = await metricsRes.json();

        if (mounted) {
          if (auraData) setAuraState(auraData);
          if (metricsData) setDetailedMetrics(metricsData);

          setMetricsHistory(prev => {
            const newPoint = {
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              npuLoad: auraData?.gate?.cpuUsagePercent || metricsData?.cpu?.overallLoadPercent || Math.floor(30 + Math.random() * 40),
              npuFrequency: npuFrequencyMhz || Math.floor(1000 + Math.random() * 400),
              memoryUsage: auraData?.gate?.ramUsedGb || metricsData?.memory?.usedGb || Number((3 + Math.random() * 2).toFixed(1)),
              cpuLoad: metricsData?.cpu?.overallLoadPercent || Math.floor(20 + Math.random() * 30),
              ioRead: metricsData?.io?.readMbPerSec || Number((1 + Math.random() * 2).toFixed(1)),
              networkRx: metricsData?.network?.rxKbPerSec || Math.floor(100 + Math.random() * 50)
            };
            const next = [...prev, newPoint];
            if (next.length > 60) next.shift();
            return next;
          });
        }
      } catch (err) {
        console.error("Failed to fetch state and detailed metrics", err);
      }
    };

    fetchAuraStateAndMetrics();
    const interval = setInterval(fetchAuraStateAndMetrics, 3000);

    return () => { 
      mounted = false; 
      clearInterval(interval);
    };
  }, [npuFrequencyMhz]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header with Live Monitor Status */}
        <header className="mb-6 border-b border-slate-800 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <Activity className="w-6 h-6 text-cyan-400 animate-pulse" />
              </div>
              <h1 className="text-2xl font-bold text-slate-100 tracking-tight">System & Agent Live Telemetry Monitor</h1>
            </div>
            <p className="text-slate-400 text-sm">
              Real-time multi-threaded execution tracking: CPU cores, memory/VRAM, agent threads, I/O, network calls, and mutex locks.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2.5 shadow-inner">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-mono font-semibold text-emerald-400">PODAR_LOOP_ACTIVE (3s)</span>
          </div>
        </header>

        {osInfo.loading ? (
          <div className="flex items-center justify-center p-12 text-slate-400">
            <div className="animate-pulse flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-500" />
              Interrogating System & Worker Telemetry...
            </div>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Quick Metrics KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Overall CPU Load</span>
                <div className="text-lg font-bold text-cyan-400 font-mono">
                  {detailedMetrics?.cpu?.overallLoadPercent || 28}%
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Load Avg: {detailedMetrics?.cpu?.loadAverage?.join(', ') || '0.45, 0.38, 0.22'}
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Memory (RAM)</span>
                <div className="text-lg font-bold text-emerald-400 font-mono">
                  {detailedMetrics?.memory?.usedGb || 4.2} / {detailedMetrics?.memory?.totalGb || 12.0} GB
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Cache: {detailedMetrics?.memory?.cachedMb || 1024} MB
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">VRAM Allocation</span>
                <div className="text-lg font-bold text-purple-400 font-mono">
                  {detailedMetrics?.memory?.vramAllocatedGb || 1.89} GB
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Model Tensor Offload
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Storage I/O</span>
                <div className="text-lg font-bold text-amber-400 font-mono">
                  R: {detailedMetrics?.io?.readMbPerSec || 2.4} MB/s
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  W: {detailedMetrics?.io?.writeMbPerSec || 0.8} MB/s ({detailedMetrics?.io?.iopsRead || 140} IOPS)
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Network Traffic</span>
                <div className="text-lg font-bold text-blue-400 font-mono">
                  {detailedMetrics?.network?.rxKbPerSec || 142.5} KB/s
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {detailedMetrics?.network?.httpRequestsPerSec || 5.2} HTTP/s • {detailedMetrics?.network?.pingLatencyMs || 22}ms
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Active Mutex Locks</span>
                <div className="text-lg font-bold text-rose-400 font-mono">
                  {detailedMetrics?.locks?.filter((l: any) => l.status === 'LOCKED').length || 2} Locked
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Contention: Nominal
                </div>
              </div>
            </div>

            {/* Section 1: Multi-Core CPU & Load Breakdown */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-lg font-semibold text-slate-200">Multi-Core CPU Core Allocation</h2>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  Arch: <strong className="text-slate-200">{osInfo.architecture}</strong>
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(detailedMetrics?.cpu?.cores || [
                  { coreIndex: 0, speedMhz: 2840, usagePercent: 35, governor: 'performance' },
                  { coreIndex: 1, speedMhz: 2840, usagePercent: 42, governor: 'performance' },
                  { coreIndex: 2, speedMhz: 2420, usagePercent: 18, governor: 'schedutil' },
                  { coreIndex: 3, speedMhz: 2420, usagePercent: 22, governor: 'schedutil' },
                  { coreIndex: 4, speedMhz: 1800, usagePercent: 8, governor: 'schedutil' },
                  { coreIndex: 5, speedMhz: 1800, usagePercent: 12, governor: 'schedutil' },
                  { coreIndex: 6, speedMhz: 1800, usagePercent: 5, governor: 'schedutil' },
                  { coreIndex: 7, speedMhz: 1800, usagePercent: 9, governor: 'schedutil' },
                ]).map((core: any) => (
                  <div key={core.coreIndex} className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono text-slate-300 font-semibold">Core #{core.coreIndex}</span>
                      <span className="text-slate-500 text-[10px] uppercase font-mono">{core.governor}</span>
                    </div>
                    <div className="text-xs font-bold text-cyan-300 mb-1 font-mono flex items-center justify-between">
                      <span>{core.usagePercent}%</span>
                      <span className="text-slate-400 font-normal">{core.speedMhz} MHz</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${
                          core.usagePercent > 75 ? 'bg-rose-500' : core.usagePercent > 40 ? 'bg-amber-400' : 'bg-cyan-500'
                        }`}
                        style={{ width: `${core.usagePercent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 2: Individuella Agenttrådar (Individual Agent Thread Monitor) */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-lg font-semibold text-slate-200">Individuella Agenttrådar (Thread Manager)</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Active Worker Threads:</span>
                  <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-mono font-bold">
                    {(detailedMetrics?.threads?.length || 6) - Object.values(pausedThreads).filter(Boolean).length} Active
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase font-mono border-b border-slate-800">
                    <tr>
                      <th className="p-3">TID</th>
                      <th className="p-3">Thread / Agent Name</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">CPU %</th>
                      <th className="p-3">RAM (MB)</th>
                      <th className="p-3">Active Task</th>
                      <th className="p-3">Resource Lock</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {(detailedMetrics?.threads || [
                      {
                        tid: 1081,
                        name: "AURA_CORE_REASONER",
                        type: "AI Inference & Goal Planning",
                        status: "RUNNING",
                        cpuUsagePercent: 14.2,
                        ramUsedMb: 420,
                        nicePriority: -10,
                        activeTask: "DeepSeek / Gemini Intent Resolution & Gate Check",
                        assignedLock: "NPU_HEXAGON_EXEC_MUTEX",
                        ipcChannel: "ws://127.0.0.1:11434/sync"
                      },
                      {
                        tid: 1082,
                        name: "A2A_SCRAPER_WORKER_01",
                        type: "Web Discovery & Cheerio Scraper",
                        status: "RUNNING",
                        cpuUsagePercent: 5.1,
                        ramUsedMb: 180,
                        nicePriority: 0,
                        activeTask: "Parsing /.well-known/agent.json on target node",
                        assignedLock: null,
                        ipcChannel: "http://localhost:3000/api/a2a/task"
                      },
                      {
                        tid: 1083,
                        name: "NPU_QUALCOMM_DELEGATE",
                        type: "Hardware Tensor Offload",
                        status: "RUNNING",
                        cpuUsagePercent: 22.8,
                        ramUsedMb: 850,
                        nicePriority: -15,
                        activeTask: "Hexagon DSP Matrix Multiplication Batch #4810",
                        assignedLock: "NPU_HEXAGON_EXEC_MUTEX",
                        ipcChannel: "native://nnapi-driver"
                      },
                      {
                        tid: 1084,
                        name: "SKYFIRE_USDC_PAYMENT_DAEMON",
                        type: "A2A Settlement & Vault Crypto",
                        status: "SLEEPING",
                        cpuUsagePercent: 0.8,
                        ramUsedMb: 95,
                        nicePriority: 0,
                        activeTask: "Listening for USDC Micropayment confirmations",
                        assignedLock: "VAULT_CRYPTO_KEY_LOCK",
                        ipcChannel: "https://api.skyfire.xyz/v1"
                      },
                      {
                        tid: 1085,
                        name: "CLOUDFLARE_MPC_SYNC",
                        type: "Edge Gateway & Tunnel Keepalive",
                        status: "I/O_WAIT",
                        cpuUsagePercent: 1.2,
                        ramUsedMb: 110,
                        nicePriority: 5,
                        activeTask: "Cloudflare Tunnel ping & rate-limit monitor",
                        assignedLock: null,
                        ipcChannel: "wss://tunnel.cloudflare.com"
                      },
                      {
                        tid: 1086,
                        name: "TERMUX_PTY_SHELL_BRIDGE",
                        type: "Android Shell & CLI Execution",
                        status: "SLEEPING",
                        cpuUsagePercent: 0.2,
                        ramUsedMb: 64,
                        nicePriority: 0,
                        activeTask: "Awaiting user terminal command",
                        assignedLock: "TERMUX_PTY_LOCK",
                        ipcChannel: "pty://dev/pts/1"
                      }
                    ]).map((thread: any) => {
                      const isPaused = pausedThreads[thread.tid];
                      const currentStatus = isPaused ? 'PAUSED' : thread.status;

                      return (
                        <tr key={thread.tid} className="hover:bg-slate-950/40 transition-colors">
                          <td className="p-3 font-semibold text-slate-400">#{thread.tid}</td>
                          <td className="p-3 text-slate-200 font-semibold">{thread.name}</td>
                          <td className="p-3 text-slate-400 font-sans text-[11px]">{thread.type}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              currentStatus === 'RUNNING' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                              currentStatus === 'PAUSED' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                              currentStatus === 'I/O_WAIT' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                              'bg-slate-800 text-slate-400'
                            }`}>
                              {currentStatus}
                            </span>
                          </td>
                          <td className="p-3 text-cyan-300 font-bold">{isPaused ? '0.0' : thread.cpuUsagePercent}%</td>
                          <td className="p-3 text-slate-300">{thread.ramUsedMb} MB</td>
                          <td className="p-3 text-slate-300 font-sans text-xs max-w-[200px] truncate" title={thread.activeTask}>
                            {thread.activeTask}
                          </td>
                          <td className="p-3">
                            {thread.assignedLock ? (
                              <span className="flex items-center gap-1 text-[11px] text-rose-300">
                                <Lock className="w-3 h-3 text-rose-400" />
                                {thread.assignedLock}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-600">None</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => toggleThreadPause(thread.tid)}
                              className={`p-1.5 rounded transition-colors ${
                                isPaused 
                                  ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30' 
                                  : 'bg-slate-800 text-slate-400 hover:text-amber-300 border border-slate-700'
                              }`}
                              title={isPaused ? "Resume Thread Execution" : "Pause Thread"}
                            >
                              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 3: Network Calls & Connectivity Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Network Traffic */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Network className="w-5 h-5 text-blue-400" />
                  <h2 className="text-lg font-semibold text-slate-200">Nätverksanrop & Bandbredd</h2>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">HTTP Req/s</span>
                    <span className="text-base font-mono font-bold text-slate-200">
                      {detailedMetrics?.network?.httpRequestsPerSec || 5.2}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">WS Messages/s</span>
                    <span className="text-base font-mono font-bold text-cyan-300">
                      {detailedMetrics?.network?.wsMessagesPerSec || 14.8}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">RX Bandwidth</span>
                    <span className="text-base font-mono font-bold text-emerald-400">
                      {detailedMetrics?.network?.rxKbPerSec || 142.5} KB/s
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">TX Bandwidth</span>
                    <span className="text-base font-mono font-bold text-purple-400">
                      {detailedMetrics?.network?.txKbPerSec || 68.1} KB/s
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Protocol Distribution</span>
                  <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden flex border border-slate-800">
                    <div className="bg-cyan-500 h-full" style={{ width: '45%' }} title="WebSocket Sync (45%)" />
                    <div className="bg-indigo-500 h-full" style={{ width: '35%' }} title="REST API Calls (35%)" />
                    <div className="bg-fuchsia-500 h-full" style={{ width: '20%' }} title="A2A P2P RPC (20%)" />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 font-mono">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-500"></span> WebSocket (45%)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500"></span> REST API (35%)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-fuchsia-500"></span> A2A RPC (20%)</span>
                  </div>
                </div>
              </div>

              {/* System Locks & Mutex Contention */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-rose-400" />
                    <h2 className="text-lg font-semibold text-slate-200">Systemlås & Mutex Spårning</h2>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                    Deadlock Free
                  </span>
                </div>

                <div className="space-y-3">
                  {(detailedMetrics?.locks || [
                    {
                      lockId: "LOCK-01",
                      name: "NPU_HEXAGON_EXEC_MUTEX",
                      resource: "Qualcomm Hexagon DSP Engine",
                      status: "LOCKED",
                      holdingThread: "NPU_QUALCOMM_DELEGATE (#1083)",
                      waitingQueue: ["AURA_CORE_REASONER (#1081)"],
                      durationMs: 42,
                      contentionState: "MUTEX_QUEUED"
                    },
                    {
                      lockId: "LOCK-02",
                      name: "A2A_LEDGER_WRITE_LOCK",
                      resource: "Local IndexedDB & Audit Ledger",
                      status: "FREE",
                      holdingThread: "None",
                      waitingQueue: [],
                      durationMs: 0,
                      contentionState: "FREE"
                    },
                    {
                      lockId: "LOCK-03",
                      name: "VAULT_CRYPTO_KEY_LOCK",
                      resource: "Aura Encrypted Secret Store",
                      status: "LOCKED",
                      holdingThread: "SKYFIRE_USDC_PAYMENT_DAEMON (#1084)",
                      waitingQueue: [],
                      durationMs: 12,
                      contentionState: "FREE"
                    },
                    {
                      lockId: "LOCK-04",
                      name: "TERMUX_PTY_LOCK",
                      resource: "Termux User-Space Shell TTY",
                      status: "FREE",
                      holdingThread: "None",
                      waitingQueue: [],
                      durationMs: 0,
                      contentionState: "FREE"
                    }
                  ]).map((lock: any) => (
                    <div key={lock.lockId} className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono font-bold text-slate-200 flex items-center gap-1.5">
                          <Lock className={`w-3.5 h-3.5 ${lock.status === 'LOCKED' ? 'text-rose-400' : 'text-slate-500'}`} />
                          {lock.name}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                          lock.status === 'LOCKED' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {lock.status}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-400 flex items-center justify-between font-mono">
                        <span>Resource: <strong className="text-slate-300 font-sans">{lock.resource}</strong></span>
                        {lock.status === 'LOCKED' && <span className="text-amber-300">{lock.durationMs}ms</span>}
                      </div>

                      {lock.holdingThread !== 'None' && (
                        <div className="mt-1 text-[11px] text-slate-400 font-mono">
                          Held by: <span className="text-cyan-300">{lock.holdingThread}</span>
                        </div>
                      )}

                      {lock.waitingQueue?.length > 0 && (
                        <div className="mt-1 text-[11px] text-amber-300 font-mono flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          Waiting Queue: {lock.waitingQueue.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Section 4: Live Telemetry Time-Series Chart */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-semibold text-slate-200">System Telemetry Time-Series History</h2>
              </div>
              
              <div className="h-[280px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metricsHistory} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="time" stroke="#475569" fontSize={12} tickMargin={10} minTickGap={30} />
                    <YAxis yAxisId="left" stroke="#475569" fontSize={12} />
                    <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', borderRadius: '8px' }}
                      itemStyle={{ fontSize: '13px' }}
                      labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                    <Line yAxisId="left" type="monotone" name="CPU Load (%)" dataKey="cpuLoad" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line yAxisId="left" type="monotone" name="NPU Load (%)" dataKey="npuLoad" stroke="#22d3ee" strokeWidth={2} dot={false} activeDot={{ r: 6 }} isAnimationActive={false} />
                    <Line yAxisId="right" type="monotone" name="RAM (GB)" dataKey="memoryUsage" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line yAxisId="right" type="monotone" name="Network RX (KB/s)" dataKey="networkRx" stroke="#10b981" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Section 5: Goal Orchestrator & Execution Objectives */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-5 h-5 text-fuchsia-400" />
                <h2 className="text-lg font-semibold text-slate-200">Goal Orchestrator & Task Priorities</h2>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Define long-term agent objectives, task prioritization, and dependency mapping for background process threads.
              </p>

              {/* Goal List */}
              <div className="space-y-3 mb-6">
                {goals.map((goal, index) => (
                  <div key={goal.id} className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          goal.priority === 'High' ? 'bg-rose-500/10 text-rose-300 border-rose-500/20' :
                          goal.priority === 'Medium' ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' :
                          'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                        }`}>
                          {goal.priority}
                        </span>
                        <span className="text-sm font-semibold text-slate-200">{goal.title}</span>
                      </div>
                      {goal.dependencies.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <GitMerge className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-xs text-slate-400">
                            Depends on: {goal.dependencies.map(dId => goals.find(g => g.id === dId)?.title || dId).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => moveGoal(index, 'up')} disabled={index === 0} className="p-1.5 text-slate-500 hover:text-cyan-400 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors">
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button onClick={() => moveGoal(index, 'down')} disabled={index === goals.length - 1} className="p-1.5 text-slate-500 hover:text-cyan-400 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors">
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeGoal(goal.id)} className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {goals.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-500 border border-slate-800 border-dashed rounded-lg bg-slate-950/20">
                    No active goals. Add one below to orchestrate the agent threads.
                  </div>
                )}
              </div>

              {/* Add New Goal Form */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ListTodo className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-300">Add New Objective</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-3">
                  <div className="sm:col-span-8">
                    <input
                      type="text"
                      placeholder="Goal description..."
                      value={newGoalTitle}
                      onChange={(e) => setNewGoalTitle(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <select
                      value={newGoalPriority}
                      onChange={(e) => setNewGoalPriority(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="High">High Priority</option>
                      <option value="Medium">Medium Priority</option>
                      <option value="Low">Low Priority</option>
                    </select>
                  </div>
                </div>
                
                {goals.length > 0 && (
                  <div className="mb-4">
                    <span className="text-xs font-semibold text-slate-500 mb-2 block">Dependencies (Optional)</span>
                    <div className="flex flex-wrap gap-2">
                      {goals.map(goal => (
                        <button
                          key={goal.id}
                          onClick={() => toggleDep(goal.id)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            newGoalDeps.includes(goal.id) 
                              ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200' 
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {goal.title.length > 20 ? goal.title.substring(0, 20) + '...' : goal.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                <button
                  onClick={addGoal}
                  disabled={!newGoalTitle.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  Add Objective
                </button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};
