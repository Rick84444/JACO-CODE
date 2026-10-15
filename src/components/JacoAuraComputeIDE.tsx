import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Braces,
  Database,
  FileCode2,
  Folder,
  Network,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  X,
  Terminal,
  Wrench,
  Command,
  ExternalLink,
} from 'lucide-react';
import { CodeFile, DeviceTelemetry, OllamaModel } from '../types';
import { AURA_PRODUCT_TOOLS, findAuraProductTools, type AuraProductTool } from '../lib/auraToolRegistry';

interface JacoAuraComputeIDEProps {
  telemetry: DeviceTelemetry;
  models: OllamaModel[];
  codeFiles?: CodeFile[];
  onSelectTab?: (tab: string) => void;
  onRunTerminalCommand?: (cmd: string) => void;
}

interface WorkbenchAgent {
  agentId: string;
  name: string;
  type: string;
  role: string | null;
  status: string;
  liveSessions: number;
  lastSeenAt: string | null;
  capabilities: Record<string, unknown>;
  tools: string[];
}

interface WorkbenchProvider {
  id: string;
  kind: string;
  baseUrl: string;
  apiKeyEnv: string | null;
  defaultModel: string;
  credentialConfigured: boolean;
  credentialRequired: boolean;
  active: boolean;
  status: 'ACTIVE' | 'REGISTERED' | string;
  createdAt?: string;
}

interface WorkbenchSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  authorNodeId: string;
  checksum: string;
  installedAt: string | null;
  enabled: boolean;
  status: string;
  source: 'continuum-runtime' | 'a2a-package' | string;
  intents?: string[];
  substrates?: string[];
}

interface WorkbenchTool {
  id: string;
  source: 'agent-card' | 'mission-contract';
  owner: string;
  available: boolean;
}

interface WorkbenchActivity {
  id: string;
  at: string | null;
  source: string;
  type: string;
  verified: boolean | null;
  message: string | null;
  payload: any;
}


interface OperatorApproval {
  id: string;
  kind: 'ACTION' | 'JOB' | 'MISSION' | 'MANDATE' | string;
  source: string;
  title: string;
  status: string;
  risk: string;
  reason: string;
  createdAt: string | null;
  actions: string[];
  details: Record<string, any>;
}

interface ApprovalCenterSnapshot {
  schema: 'jaco.operator-approval-center/v1';
  count: number;
  actionRequired: boolean;
  items: OperatorApproval[];
  activeMandates: Array<{ id: string; name: string; mission: string; expiresAt: string }>;
}

interface WorkbenchSnapshot {
  success: boolean;
  schema: 'jaco.aura-workbench/v1';
  observedAt: string;
  workplace: {
    reachable: boolean;
    status: string;
    agents: WorkbenchAgent[];
    error: string | null;
  };
  seer: {
    phase: string | null;
    activeModule: string | null;
    provider: string | null;
    model: string | null;
    primaryGoal: string | null;
    blocker: string | null;
    latestVerifiedProgress: string | null;
    updatedAt: string | null;
  };
  mission: any | null;
  runtime: {
    running: boolean;
    workers: any[];
    dispatchPressure: any;
  };
  providers: WorkbenchProvider[];
  skills: WorkbenchSkill[];
  skillRuntime: {
    schema?: string;
    recentEvents?: any[];
    catalog?: { count?: number; active?: number; candidate?: number };
    jit?: Record<string, any>;
    optimizer?: Record<string, any>;
  };
  tools: WorkbenchTool[];
  approvals: ApprovalCenterSnapshot;
  activity: WorkbenchActivity[];
}

interface WorkspaceFile {
  path: string;
  size: number;
}

interface FileResponse {
  success: boolean;
  path: string;
  content: string;
  size: number;
  language: string;
}

type SidebarView = 'explorer' | 'agents' | 'tools' | 'providers';
type TerminalMode = 'human' | 'raw';

const json = async (response: Response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || data?.detail || `HTTP_${response.status}`);
  }
  return data;
};

const formatTime = (value: string | null | undefined) => {
  if (!value) return '--:--:--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
};

const humanizeActivity = (event: WorkbenchActivity) => {
  const payload = event.payload || {};
  const action = payload?.action || payload?.receipt || payload;
  const type = String(event.type || '');
  const verified = event.verified === true;

  if (type === 'NOVA_ACTION_STARTED') {
    return `Nova började köra verktyget ${action?.type || 'okänt verktyg'} för missionen.`;
  }
  if (type === 'NOVA_ACTION_RESULT') {
    return verified || payload?.verified === true
      ? `Nova avslutade ${payload?.type || action?.type || 'åtgärden'} och fick en verifierad receipt.`
      : `Nova avslutade ${payload?.type || action?.type || 'åtgärden'} utan verifierad receipt.`;
  }
  if (type === 'NOVA_PLANNING_RESULT') {
    return payload?.error
      ? `Nova-planeringen stoppades: ${payload.error}.`
      : 'Nova tog fram nästa steg för den aktiva missionen.';
  }
  if (type === 'NOVA_OPERATOR_RESOLUTION') {
    return `Operatören satte missionen till ${payload?.decision || 'nytt läge'}.`;
  }
  if (type === 'governor.graph_created') {
    return `SEER skapade autonomt en ny Mission Graph: ${payload?.title || payload?.goal || 'utan titel'}.`;
  }
  if (type === 'governor.skipped') {
    return `SEER avstod från att skapa nytt arbete: ${payload?.reason || 'inget nytt arbete behövdes'}.`;
  }
  if (type === 'mission_graph.node.reconcile_terminal') {
    return `SEER verifierade en Mission Graph-nod som ${payload?.outcome || 'terminal'}.`;
  }
  if (type.includes('provider') && event.message) {
    return `Provider-händelse: ${event.message}`;
  }
  if (event.message) return event.message;
  return `${event.source}: ${type || 'händelse'}`;
};

const statusClass = (status: string | null | undefined) => {
  const value = String(status || 'UNKNOWN').toUpperCase();
  if (['READY', 'ONLINE', 'AVAILABLE', 'RUNNING', 'ACTIVE', 'OBSERVED', 'DONE', 'VERIFIED'].includes(value)) {
    return 'text-emerald-300 border-emerald-900/70 bg-emerald-950/30';
  }
  if (['BLOCKED', 'DEGRADED', 'FAILED', 'ERROR', 'UNAVAILABLE', 'OFFLINE'].includes(value)) {
    return 'text-amber-300 border-amber-900/70 bg-amber-950/30';
  }
  return 'text-slate-300 border-slate-700 bg-slate-900/60';
};

const languageLabel = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase();
  return ({
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    js: 'JavaScript',
    mjs: 'JavaScript Module',
    json: 'JSON',
    md: 'Markdown',
    css: 'CSS',
    html: 'HTML',
    sh: 'Shell',
    ps1: 'PowerShell',
    py: 'Python',
  } as Record<string, string>)[ext || ''] || 'Text';
};

export const JacoAuraComputeIDE: React.FC<JacoAuraComputeIDEProps> = ({ onSelectTab }) => {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileView, setFileView] = useState<FileResponse | null>(null);
  const [sidebar, setSidebar] = useState<SidebarView>('explorer');
  const [terminalMode, setTerminalMode] = useState<TerminalMode>('human');
  const [query, setQuery] = useState('');
  const [goal, setGoal] = useState('');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [missionSubmitting, setMissionSubmitting] = useState(false);
  const [missionNotice, setMissionNotice] = useState<string | null>(null);
  const [showApprovals, setShowApprovals] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [toolQuery, setToolQuery] = useState('');
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [probeReceipts, setProbeReceipts] = useState<Record<string, any>>({});
  const [providerBusy, setProviderBusy] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState({
    id: '',
    baseUrl: '',
    apiKeyEnv: '',
    defaultModel: '',
  });

  const refresh = async () => {
    try {
      const [workbench, workspaceFiles] = await Promise.all([
        fetch('/api/aura/workbench', { cache: 'no-store' }).then(json),
        fetch('/api/aura/workbench/files', { cache: 'no-store' }).then(json),
      ]);
      setSnapshot(workbench);
      setFiles(Array.isArray(workspaceFiles?.files) ? workspaceFiles.files : []);
      setRuntimeError(null);
      if (!selectedFile && workspaceFiles?.files?.[0]?.path) setSelectedFile(workspaceFiles.files[0].path);
    } catch (error: any) {
      setRuntimeError(error?.message || String(error));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setFileView(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/aura/workbench/file?path=${encodeURIComponent(selectedFile)}`, { cache: 'no-store' })
      .then(json)
      .then(data => { if (!cancelled) setFileView(data); })
      .catch(error => {
        if (!cancelled) {
          setFileView({
            success: false,
            path: selectedFile,
            content: `File unavailable: ${error?.message || String(error)}`,
            size: 0,
            language: 'text',
          });
        }
      });
    return () => { cancelled = true; };
  }, [selectedFile]);

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return files.filter(file => !needle || file.path.toLowerCase().includes(needle)).slice(0, 500);
  }, [files, query]);

  const filteredProductTools = useMemo(() => findAuraProductTools(toolQuery), [toolQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setShowCommandPalette(true);
      }
      if (event.key === 'Escape') setShowCommandPalette(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activity = snapshot?.activity || [];
  const mission = snapshot?.mission || null;
  const missionPhase = String(mission?.phase || mission?.status || 'NO ACTIVE MISSION');

  const openProductTool = (tool: AuraProductTool) => {
    setShowCommandPalette(false);
    setToolQuery('');
    setMissionNotice(`Opened tool: ${tool.title}`);
    onSelectTab?.(tool.surface);
  };

  const submitComposer = async () => {
    const trimmed = goal.trim();
    if (!trimmed || missionSubmitting) return;

    if (trimmed === '/tools' || trimmed === '>') {
      setToolQuery('');
      setShowCommandPalette(true);
      return;
    }

    if (trimmed.startsWith('>')) {
      const toolSearch = trimmed.slice(1).trim();
      const matches = findAuraProductTools(toolSearch);
      if (matches.length === 1) {
        setGoal('');
        openProductTool(matches[0]);
        return;
      }
      setToolQuery(toolSearch);
      setShowCommandPalette(true);
      setMissionNotice(matches.length ? `Select one of ${matches.length} matching tools.` : 'No matching tool. Search Tool Fabric.');
      return;
    }

    await startGoal();
  };

  const startGoal = async () => {
    const trimmed = goal.trim();
    if (!trimmed || missionSubmitting) return;
    setMissionSubmitting(true);
    setMissionNotice(null);
    try {
      const data = await fetch('/api/aura/workbench/start-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed }),
      }).then(json);
      setGoal('');
      setMissionNotice(`Canonical SEER goal activated: ${data?.goal?.id || 'unknown id'}`);
      await refresh();
    } catch (error: any) {
      setMissionNotice(`Goal was not activated: ${error?.message || String(error)}`);
    } finally {
      setMissionSubmitting(false);
    }
  };

  const resolveApproval = async (approval: OperatorApproval, decision: string) => {
    const busyKey = `${approval.id}:${decision}`;
    if (approvalBusy) return;
    setApprovalBusy(busyKey);
    setRuntimeError(null);
    try {
      await fetch(`/api/aura/workbench/approvals/${encodeURIComponent(approval.id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          note: `Operator decision from Aura Approval Center: ${decision}`,
        }),
      }).then(json);
      await refresh();
    } catch (error: any) {
      setRuntimeError(error?.message || String(error));
    } finally {
      setApprovalBusy(null);
    }
  };

  const approvalLabel = (action: string) => ({
    approve: 'Approve',
    reject: 'Reject',
    confirm: 'Confirm result',
    resume: 'Resume',
    cancel: 'Cancel mission',
  } as Record<string, string>)[action] || action;

  const registerProvider = async () => {
    if (!providerForm.id.trim() || !providerForm.baseUrl.trim()) return;
    setProviderBusy('register');
    try {
      await fetch('/api/aura/workbench/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: providerForm.id.trim(),
          baseUrl: providerForm.baseUrl.trim(),
          apiKeyEnv: providerForm.apiKeyEnv.trim() || null,
          defaultModel: providerForm.defaultModel.trim(),
        }),
      }).then(json);
      setProviderForm({ id: '', baseUrl: '', apiKeyEnv: '', defaultModel: '' });
      await refresh();
    } catch (error: any) {
      setRuntimeError(error?.message || String(error));
    } finally {
      setProviderBusy(null);
    }
  };

  const probeProvider = async (id: string) => {
    setProviderBusy(id);
    try {
      const data = await fetch(`/api/aura/workbench/providers/${encodeURIComponent(id)}/probe`, {
        method: 'POST',
      }).then(json);
      setProbeReceipts(current => ({ ...current, [id]: data.receipt }));
    } catch (error: any) {
      setProbeReceipts(current => ({ ...current, [id]: { ok: false, error: error?.message || String(error) } }));
    } finally {
      setProviderBusy(null);
    }
  };

  const renderSidebar = () => {
    if (sidebar === 'explorer') {
      return (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Explorer</span><span>{files.length}</span>
          </div>
          <div className="px-2 pb-2">
            <div className="flex items-center gap-2 bg-[#1f1f1f] border border-[#3a3a3a] rounded px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Filter files"
                className="w-full bg-transparent outline-none text-xs text-slate-200"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {filteredFiles.map(file => (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file.path)}
                className={`w-full flex items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-[#2a2d2e] ${selectedFile === file.path ? 'bg-[#37373d] text-white' : 'text-slate-300'}`}
              >
                <FileCode2 className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                <span className="truncate">{file.path}</span>
              </button>
            ))}
          </div>
        </>
      );
    }

    if (sidebar === 'agents') {
      return (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400">Workplace agents</div>
          <div className="flex-1 overflow-auto px-2 space-y-2">
            {(snapshot?.workplace?.agents || []).map(agent => (
              <div key={agent.agentId} className="border border-[#333] bg-[#1d1d1d] rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-xs truncate">{agent.name}</strong>
                  <span className={`text-[9px] border rounded px-1.5 py-0.5 ${statusClass(agent.status)}`}>{agent.status}</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{agent.role || agent.type || agent.agentId}</div>
                <div className="text-[10px] text-slate-400 mt-2">{agent.liveSessions} live session(s)</div>
              </div>
            ))}
            {!snapshot?.workplace?.agents?.length && <div className="text-xs text-slate-500 p-2">No Workplace agents observed.</div>}
          </div>
        </>
      );
    }

    if (sidebar === 'tools') {
      return (
        <>
          <div className="px-3 py-2 border-b border-[#292929]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-slate-400">Tool Fabric</span>
              <button
                onClick={() => setShowCommandPalette(true)}
                className="text-[9px] border border-[#3a3a3a] rounded px-1.5 py-0.5 text-slate-400 hover:text-white"
              >
                Ctrl⇧P
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 bg-[#1f1f1f] border border-[#3a3a3a] rounded px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                value={toolQuery}
                onChange={event => setToolQuery(event.target.value)}
                placeholder="Search capabilities, commands, integrations…"
                className="w-full bg-transparent outline-none text-xs text-slate-200"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-600">Product capabilities · {filteredProductTools.length}</div>
            {filteredProductTools.map(tool => (
              <button
                key={tool.id}
                onClick={() => openProductTool(tool)}
                className="w-full text-left px-3 py-2 border-b border-[#292929] hover:bg-[#252526]"
              >
                <div className="flex items-center gap-2">
                  <Wrench className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="text-xs text-slate-200 truncate">{tool.title}</span>
                  <ExternalLink className="w-3 h-3 text-slate-600 ml-auto shrink-0" />
                </div>
                <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">{tool.description}</div>
                <div className="flex items-center gap-2 mt-1.5 text-[9px]">
                  <span className="text-cyan-500">{tool.command}</span>
                  <span className="text-slate-600">{tool.category}</span>
                  <span className={tool.authority === 'REVIEW' ? 'text-amber-400' : tool.authority === 'VERIFY' ? 'text-violet-400' : 'text-emerald-500'}>{tool.authority}</span>
                </div>
              </button>
            ))}

            <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-600 border-t border-[#333]">
              Installed skills · {snapshot?.skills?.length ?? 0}
            </div>
            {(snapshot?.skills || []).map(skill => (
              <div key={skill.id} className="px-3 py-2 border-b border-[#292929]">
                <div className="flex items-center gap-2">
                  <Braces className={`w-3 h-3 ${skill.enabled ? 'text-emerald-400' : 'text-slate-600'}`} />
                  <span className="text-xs text-slate-200 truncate">{skill.name || skill.id}</span>
                  <span className={`ml-auto text-[8px] ${skill.enabled ? 'text-emerald-400' : 'text-amber-500'}`}>{skill.status}</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 truncate">v{skill.version || '?'} · {skill.source === 'continuum-runtime' ? 'Continuum Skill Runtime' : (skill.authorNodeId || 'A2A')}</div>
              </div>
            ))}
            {!snapshot?.skills?.length && <div className="px-3 py-2 text-[10px] text-slate-600">No skill manifests observed · Skill Runtime catalog {snapshot?.skillRuntime?.catalog?.count ?? 0}.</div>}
            {snapshot?.skillRuntime && <div className="px-3 py-2 text-[9px] text-slate-500 border-b border-[#292929]">Skill Runtime · {snapshot.skillRuntime.catalog?.active ?? 0} active · {snapshot.skillRuntime.catalog?.candidate ?? 0} candidate</div>}

            <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-600 border-t border-[#333]">
              Runtime-advertised tools · {snapshot?.tools?.length ?? 0}
            </div>
            {(snapshot?.tools || []).map(tool => (
              <div key={`${tool.source}:${tool.owner}:${tool.id}`} className="px-3 py-2 border-b border-[#292929]">
                <div className="flex items-center gap-2">
                  <Wrench className="w-3 h-3 text-violet-400" />
                  <span className="text-xs text-slate-200">{tool.id}</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{tool.owner} · {tool.source} · {tool.available ? 'available' : 'unavailable'}</div>
              </div>
            ))}
          </div>
        </>
      );
    }

    return (
      <>
        <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400">Providers</div>
        <div className="flex-1 overflow-auto px-2 space-y-2">
          {(snapshot?.providers || []).map(provider => {
            const receipt = probeReceipts[provider.id];
            return (
              <div key={provider.id} className="border border-[#333] bg-[#1d1d1d] rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <strong className="text-xs">{provider.id}</strong>
                    <span className={`text-[8px] border rounded px-1 ${statusClass(provider.status)}`}>{provider.status}</span>
                  </div>
                  <button
                    onClick={() => void probeProvider(provider.id)}
                    disabled={providerBusy === provider.id}
                    className="text-[10px] border border-[#444] px-2 py-1 rounded hover:bg-[#2b2b2b] disabled:opacity-40"
                  >
                    {providerBusy === provider.id ? 'Probing…' : 'Probe'}
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 truncate">{provider.baseUrl}</div>
                <div className="grid grid-cols-2 gap-1 mt-2 text-[10px]">
                  <span>model</span><span className="text-slate-300 truncate">{provider.defaultModel || 'not set'}</span>
                  <span>credential</span><span className={provider.credentialRequired ? (provider.credentialConfigured ? 'text-emerald-300' : 'text-amber-400') : 'text-slate-400'}>{provider.credentialRequired ? (provider.credentialConfigured ? 'configured' : 'missing') : 'not required'}</span>
                </div>
                {receipt && (
                  <div className={`mt-2 text-[10px] border rounded p-1.5 ${statusClass(receipt.ok ? 'VERIFIED' : 'FAILED')}`}>
                    {receipt.ok ? `probe OK · ${receipt.latencyMs ?? '?'} ms · ${receipt.models?.length ?? 0} model(s)` : `probe failed · ${receipt.error || receipt.status || 'unknown'}`}
                  </div>
                )}
              </div>
            );
          })}

          <div className="border border-[#333] bg-[#181818] rounded p-2 space-y-2">
            <div className="text-xs font-semibold">Connect provider</div>
            <input value={providerForm.id} onChange={e => setProviderForm(v => ({ ...v, id: e.target.value }))} placeholder="provider id" className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none" />
            <input value={providerForm.baseUrl} onChange={e => setProviderForm(v => ({ ...v, baseUrl: e.target.value }))} placeholder="OpenAI-compatible base URL" className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none" />
            <input value={providerForm.defaultModel} onChange={e => setProviderForm(v => ({ ...v, defaultModel: e.target.value }))} placeholder="default model" className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none" />
            <input value={providerForm.apiKeyEnv} onChange={e => setProviderForm(v => ({ ...v, apiKeyEnv: e.target.value }))} placeholder="credential env name, e.g. MY_API_KEY" className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none" />
            <p className="text-[10px] text-slate-500">Secrets are never entered here; only an environment-variable reference is stored.</p>
            <button onClick={() => void registerProvider()} disabled={providerBusy === 'register'} className="w-full bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-2 py-1.5 text-xs font-semibold">
              {providerBusy === 'register' ? 'Connecting…' : 'Register provider'}
            </button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="h-[calc(100vh-3rem)] min-h-[680px] bg-[#02070c] text-[#d5d9df] font-sans flex flex-col overflow-hidden">
      <div
        className="h-12 border-b border-cyan-950/80 flex items-center justify-between px-3 shrink-0 relative overflow-hidden"
        style={{ background: 'linear-gradient(90deg,#02070c 0%,#06111a 46%,#02070c 100%)' }}
      >
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
        <div className="flex items-center gap-3 min-w-0 relative z-10">
          <img
            src="/branding/jaco-logo.webp"
            alt="JACO IDE"
            className="h-9 w-auto object-contain drop-shadow-[0_0_14px_rgba(56,189,248,.5)] shrink-0"
          />
          <div className="h-7 w-px bg-cyan-900/70 hidden md:block" />
          <div className="min-w-0 hidden md:block">
            <div className="text-[9px] tracking-[0.24em] text-cyan-200/80">AUTONOMOUS DEVELOPMENT ENVIRONMENT</div>
            <div className="text-[8px] text-slate-600 truncate">Aura · SEER · Durable Nova · MCP · Remote · Evidence</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <button
            onClick={() => setShowCommandPalette(true)}
            className="border border-[#3a3a3a] rounded px-2 py-0.5 flex items-center gap-1.5 text-slate-300 hover:text-white hover:border-cyan-800"
            title="Open Tool Fabric command palette (Ctrl+Shift+P)"
          >
            <Command className="w-3 h-3" />
            Tools {AURA_PRODUCT_TOOLS.length}
          </button>
          <button
            onClick={() => setShowApprovals(true)}
            className={`border rounded px-2 py-0.5 flex items-center gap-1.5 ${snapshot?.approvals?.count ? 'text-amber-200 border-amber-700 bg-amber-950/40' : 'text-emerald-300 border-emerald-900/70 bg-emerald-950/30'}`}
            title="All operator decisions in one place"
          >
            <ShieldAlert className="w-3 h-3" />
            Approvals {snapshot?.approvals?.count ?? 0}
          </button>
          <span className={`border rounded px-2 py-0.5 ${statusClass(snapshot?.workplace?.reachable ? snapshot.workplace.status : 'UNAVAILABLE')}`}>
            Workplace {snapshot?.workplace?.reachable ? snapshot.workplace.status : 'UNAVAILABLE'}
          </span>
          <button onClick={() => void refresh()} className="p-1.5 hover:bg-[#2a2d2e] rounded" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-[#2b2b2b] bg-[#111820] px-3 py-3 shrink-0">
        <form
          onSubmit={event => { event.preventDefault(); void submitComposer(); }}
          className="max-w-6xl mx-auto"
        >
          <div className="flex items-center gap-2">
            <div className="shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">JACO Composer</div>
              <div className="text-[9px] text-slate-500">Goal by default · &gt;tool opens a capability · Ctrl⇧P searches Tool Fabric</div>
            </div>
            <span className="text-cyan-400 font-mono text-sm ml-2">jaco&gt;</span>
            <input
              value={goal}
              onChange={event => setGoal(event.target.value)}
              placeholder="Skriv ett mål, eller >git / >models / >diagnostics / >memory …"
              className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 outline-none text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-700"
            />
            <button
              disabled={!goal.trim() || missionSubmitting}
              className="bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-4 py-2 text-[11px] font-semibold flex items-center gap-1.5"
            >
              {missionSubmitting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Start goal
            </button>
          </div>
          {missionNotice && <div className="text-[10px] text-slate-400 mt-1.5 ml-[230px]">{missionNotice}</div>}
        </form>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="w-12 bg-[#050b11] border-r border-[#123047] flex flex-col items-center py-2 gap-1 shrink-0">
          {([
            ['explorer', Folder, 'Explorer'],
            ['agents', Bot, 'Agents'],
            ['tools', Wrench, 'Tools'],
            ['providers', PlugZap, 'Providers'],
          ] as const).map(([id, Icon, title]) => (
            <button
              key={id}
              onClick={() => setSidebar(id)}
              title={title}
              className={`w-10 h-10 flex items-center justify-center border-l-2 ${sidebar === id ? 'text-white border-cyan-400 bg-[#252526]' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
            >
              <Icon className="w-5 h-5" />
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => onSelectTab?.('setup')} title="Settings" className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-300">
            <Settings2 className="w-5 h-5" />
          </button>
        </div>

        <aside className="w-64 md:w-72 bg-[#050b11] border-r border-[#123047] flex flex-col min-h-0 shrink-0">
          {renderSidebar()}
        </aside>

        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="h-9 border-b border-[#2b2b2b] bg-[#181818] flex items-center">
            <div className="h-full px-3 flex items-center gap-2 bg-[#1e1e1e] border-t border-t-cyan-500 text-xs min-w-0 max-w-[70%]">
              <FileCode2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">{selectedFile || 'runtime-overview.md'}</span>
            </div>
          </div>

          <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)_300px] bg-[#1e1e1e]">
            <div className="min-h-0 overflow-auto">
              {fileView ? (
                <>
                  <div className="h-8 px-4 border-b border-[#2b2b2b] flex items-center justify-between text-[10px] text-slate-500 sticky top-0 bg-[#1e1e1e]">
                    <span>{fileView.path}</span>
                    <span>{languageLabel(fileView.path)} · {fileView.size} bytes · READ ONLY</span>
                  </div>
                  <pre className="p-4 text-[12px] leading-5 font-mono whitespace-pre overflow-auto min-h-full text-[#d4d4d4]">{fileView.content}</pre>
                </>
              ) : (
                <div className="p-4 space-y-4 bg-[#02070c] min-h-full">
                  <div className="relative min-h-[220px] border border-cyan-950/70 rounded-lg overflow-hidden bg-[#03080d]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_42%,rgba(14,165,233,.14),transparent_35%),linear-gradient(90deg,#03080d,#06111a_52%,#03080d)]" />
                    <img
                      src="/branding/jaco-orb.webp"
                      alt="JACO cognitive runtime sphere"
                      className="absolute right-[4%] top-1/2 -translate-y-1/2 h-[92%] w-auto object-contain opacity-95 select-none pointer-events-none"
                      style={{
                        filter: 'saturate(1.12) contrast(1.08)',
                        WebkitMaskImage: 'radial-gradient(ellipse at center,#000 62%,transparent 98%)',
                        maskImage: 'radial-gradient(ellipse at center,#000 62%,transparent 98%)',
                      }}
                    />
                    <div className="relative z-10 p-5 max-w-[56%]">
                      <div className="text-[9px] tracking-[0.24em] text-cyan-300">JACO COGNITIVE RUNTIME</div>
                      <h2 className="mt-2 text-lg font-semibold text-white">Runtime overview</h2>
                      <p className="mt-2 text-[11px] leading-5 text-slate-400">One operator goal → SEER → durable Nova execution → real tools → verified evidence → memory.</p>
                      <div className="mt-4 flex flex-wrap gap-2 text-[9px]">
                        <span className="border border-emerald-900/70 bg-emerald-950/25 text-emerald-300 rounded px-2 py-1">LEVEL 5 AUTHORITY</span>
                        <span className="border border-cyan-900/70 bg-cyan-950/25 text-cyan-300 rounded px-2 py-1">PAYMENT = OPERATOR GATE</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-cyan-400" />
                    <h2 className="text-sm font-semibold text-white">Live runtime truth</h2>
                  </div>
                  {runtimeError && <div className="border border-red-900 bg-red-950/20 rounded p-3 text-xs text-red-300">{runtimeError}</div>}
                  <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                    <div className="border border-[#333] rounded p-3 bg-[#181818]"><div className="text-[10px] text-slate-500">SEER phase</div><div className="mt-1 text-sm text-white">{snapshot?.seer?.phase || 'unobserved'}</div></div>
                    <div className="border border-[#333] rounded p-3 bg-[#181818]"><div className="text-[10px] text-slate-500">Provider / model</div><div className="mt-1 text-sm text-white">{snapshot?.seer?.provider || 'unobserved'} / {snapshot?.seer?.model || 'unobserved'}</div></div>
                    <div className="border border-[#333] rounded p-3 bg-[#181818]"><div className="text-[10px] text-slate-500">Mission</div><div className="mt-1 text-sm text-white">{missionPhase}</div></div>
                    <div className="border border-[#333] rounded p-3 bg-[#181818]"><div className="text-[10px] text-slate-500">Observed agents</div><div className="mt-1 text-sm text-white">{snapshot?.workplace?.agents?.length ?? 0}</div></div>
                  </div>
                </div>
              )}
            </div>

            <div className="min-h-0 border-t border-[#333] bg-[#181818] flex flex-col">
              <div className="h-9 px-3 flex items-center justify-between border-b border-[#2b2b2b] shrink-0">
                <div className="flex items-center gap-4 text-[11px]">
                  <button className="text-white border-b border-cyan-400 h-9 flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5" />TERMINAL</button>
                  <button onClick={() => setTerminalMode('human')} className={terminalMode === 'human' ? 'text-white' : 'text-slate-500'}>HUMAN</button>
                  <button onClick={() => setTerminalMode('raw')} className={terminalMode === 'raw' ? 'text-white' : 'text-slate-500'}>RAW EVENTS</button>
                </div>
                <div className="text-[10px] text-slate-500">{snapshot?.observedAt ? `observed ${formatTime(snapshot.observedAt)}` : 'not observed'}</div>
              </div>

              <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-5">
                {activity.length ? activity.slice(-80).map(event => (
                  <div key={event.id} className="flex gap-2">
                    <span className="text-slate-600 shrink-0">{formatTime(event.at)}</span>
                    <span className={event.verified === true ? 'text-emerald-400' : event.verified === false ? 'text-amber-400' : 'text-slate-500'}>
                      {event.verified === true ? '✓' : event.verified === false ? '!' : '·'}
                    </span>
                    <span className="text-slate-300 break-words">
                      {terminalMode === 'human' ? humanizeActivity(event) : JSON.stringify({ source: event.source, type: event.type, verified: event.verified, payload: event.payload })}
                    </span>
                  </div>
                )) : (
                  <div className="text-slate-500">No runtime activity observed yet.</div>
                )}
              </div>

              <div className="border-t border-[#2b2b2b] px-3 py-2 text-[10px] text-slate-500 flex items-center justify-between">
                <span>Goal activation is centralized in the Canonical Start Prompt above.</span>
                <button onClick={() => setShowApprovals(true)} className="text-cyan-400 hover:text-cyan-300">
                  Approval Center · {snapshot?.approvals?.count ?? 0}
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="hidden xl:flex w-72 bg-[#050b11] border-l border-[#123047] flex-col min-h-0">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 border-b border-[#2b2b2b]">Runtime inspector</div>
          <div className="p-3 space-y-3 overflow-auto text-xs">
            <div className="border border-[#333] rounded p-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold"><Activity className="w-3.5 h-3.5 text-cyan-400" />Current mission</div>
              <div className="mt-2 text-[10px] text-slate-500 break-all">{mission?.id || 'No active mission'}</div>
              {mission && <>
                <div className="mt-2">{mission.goal}</div>
                <div className="mt-2 flex gap-2"><span className={`border rounded px-1.5 py-0.5 text-[9px] ${statusClass(mission.status)}`}>{mission.status}</span><span className="text-slate-500">{mission.phase || ''}</span></div>
              </>}
            </div>
            <div className="border border-[#333] rounded p-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />Latest verified progress</div>
              <div className="mt-2 text-[11px] text-slate-400">{snapshot?.seer?.latestVerifiedProgress || 'No verified progress reported.'}</div>
            </div>
            <div className="border border-[#333] rounded p-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold"><Network className="w-3.5 h-3.5 text-violet-400" />SEER</div>
              <div className="grid grid-cols-2 gap-y-1 mt-2 text-[10px]">
                <span className="text-slate-500">phase</span><span>{snapshot?.seer?.phase || 'unobserved'}</span>
                <span className="text-slate-500">module</span><span>{snapshot?.seer?.activeModule || 'unobserved'}</span>
                <span className="text-slate-500">blocker</span><span className="break-words">{snapshot?.seer?.blocker || 'none observed'}</span>
              </div>
            </div>
            <div className="border border-[#333] rounded p-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold"><Database className="w-3.5 h-3.5 text-sky-400" />Evidence</div>
              <div className="mt-2 flex items-center justify-between text-[10px]"><span>activity rows</span><span>{activity.length}</span></div>
              <div className="mt-1 flex items-center justify-between text-[10px]"><span>verified receipts</span><span>{Array.isArray(mission?.receipts) ? mission.receipts.filter((r: any) => r?.verified).length : 0}</span></div>
            </div>
          </div>
        </aside>
      </div>

      {showCommandPalette && (
        <div className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4">
          <div className="w-full max-w-2xl bg-[#111820] border border-[#3a414b] rounded-lg shadow-2xl overflow-hidden">
            <div className="p-3 border-b border-[#30363d] flex items-center gap-2">
              <Command className="w-4 h-4 text-cyan-400" />
              <input
                autoFocus
                value={toolQuery}
                onChange={event => setToolQuery(event.target.value)}
                placeholder="Search JACO capabilities…"
                className="flex-1 bg-transparent outline-none text-sm text-slate-100 placeholder:text-slate-600"
              />
              <button onClick={() => setShowCommandPalette(false)} className="p-1 text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              {filteredProductTools.map(tool => (
                <button
                  key={tool.id}
                  onClick={() => openProductTool(tool)}
                  className="w-full text-left px-4 py-3 border-b border-[#252b33] hover:bg-[#1d2530] flex items-start gap-3"
                >
                  <Wrench className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{tool.title}</span>
                      <span className="text-[9px] text-cyan-500">{tool.command}</span>
                      <span className="text-[9px] text-slate-600">{tool.category}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">{tool.description}</div>
                  </div>
                  <span className={`text-[9px] mt-0.5 ${tool.authority === 'REVIEW' ? 'text-amber-400' : tool.authority === 'VERIFY' ? 'text-violet-400' : 'text-emerald-500'}`}>{tool.authority}</span>
                </button>
              ))}
              {!filteredProductTools.length && (
                <div className="p-6 text-center text-xs text-slate-500">No capability matches “{toolQuery}”.</div>
              )}
            </div>
            <div className="px-4 py-2 bg-[#0d1117] text-[9px] text-slate-600 flex justify-between">
              <span>Capabilities stay functional; legacy surfaces are hidden behind Tool Fabric during migration.</span>
              <span>Esc closes</span>
            </div>
          </div>
        </div>
      )}

      {showApprovals && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="h-full w-full max-w-xl bg-[#111820] border-l border-[#30363d] shadow-2xl flex flex-col">
            <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Approval Center
                  <span className={`text-[10px] rounded border px-1.5 py-0.5 ${snapshot?.approvals?.count ? 'border-amber-700 text-amber-300' : 'border-emerald-800 text-emerald-300'}`}>
                    {snapshot?.approvals?.count ?? 0} action required
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">All real operator gates. Machine review and autonomous ALLOW actions are not shown here.</div>
              </div>
              <button onClick={() => setShowApprovals(false)} className="p-2 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-3 border-b border-[#252b33] bg-[#0d1117]">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Active autonomy mandates</div>
              <div className="mt-1 text-xs text-slate-300">
                {snapshot?.approvals?.activeMandates?.length
                  ? snapshot.approvals.activeMandates.map(m => `${m.name} · expires ${formatTime(m.expiresAt)}`).join(' · ')
                  : 'No active signed mandate observed.'}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3">
              {(snapshot?.approvals?.items || []).map(approval => (
                <div key={approval.id} className="border border-[#343b45] bg-[#161b22] rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400">{approval.kind}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${approval.risk === 'HIGH' || approval.risk === 'CRITICAL' ? 'border-red-900 text-red-300' : 'border-amber-900 text-amber-300'}`}>{approval.risk}</span>
                      </div>
                      <div className="text-xs font-semibold text-white mt-2 break-words">{approval.title}</div>
                      <div className="text-[10px] text-slate-400 mt-1 leading-4">{approval.reason}</div>
                    </div>
                    <span className="text-[9px] text-slate-600 shrink-0">{approval.source}</span>
                  </div>

                  <div className="mt-3 border border-[#2b3139] rounded bg-[#0d1117] p-2">
                    <div className="text-[9px] uppercase text-slate-600 mb-1">What changes / evidence</div>
                    <pre className="text-[10px] leading-4 text-slate-400 whitespace-pre-wrap break-words overflow-hidden">{JSON.stringify(approval.details || {}, null, 2)}</pre>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {approval.actions.map(action => {
                      const busy = approvalBusy === `${approval.id}:${action}`;
                      const positive = ['approve','confirm','resume'].includes(action);
                      return (
                        <button
                          key={action}
                          onClick={() => void resolveApproval(approval, action)}
                          disabled={Boolean(approvalBusy)}
                          className={`text-[10px] rounded px-3 py-1.5 border disabled:opacity-40 ${positive ? 'bg-[#0e639c] border-[#1177bb] text-white' : 'border-[#4a4f57] text-slate-300 hover:bg-[#252a31]'}`}
                        >
                          {busy ? 'Working…' : approvalLabel(action)}
                        </button>
                      );
                    })}
                    {!approval.actions.length && (
                      <span className="text-[10px] text-amber-300">Configuration is required; this item cannot be blindly approved.</span>
                    )}
                  </div>
                </div>
              ))}

              {!snapshot?.approvals?.items?.length && (
                <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center text-slate-500">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-3" />
                  <div className="text-sm text-slate-300">No operator decisions pending</div>
                  <div className="text-[10px] mt-1">JACO is not waiting for an approval in any aggregated runtime gate.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="h-6 bg-[#007acc] text-white px-3 flex items-center justify-between text-[10px] shrink-0">
        <div className="flex items-center gap-3">
          <span>JACO Workbench</span>
          <span>{snapshot?.runtime?.running ? 'runtime running' : 'runtime not observed running'}</span>
          <span>{snapshot?.providers?.filter(provider => provider.active).length ?? 0} active · {snapshot?.providers?.length ?? 0} provider(s)</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{AURA_PRODUCT_TOOLS.length} product capabilities · {snapshot?.tools?.length ?? 0} runtime tool(s) · {snapshot?.skills?.filter(skill => skill.enabled).length ?? 0}/{snapshot?.skills?.length ?? 0} executable skill(s) · Skill Runtime {snapshot?.skillRuntime?.catalog?.count ?? 0}</span>
          <span>{runtimeError ? 'degraded' : 'live observation'}</span>
        </div>
      </div>
    </div>
  );
};

export default JacoAuraComputeIDE;
