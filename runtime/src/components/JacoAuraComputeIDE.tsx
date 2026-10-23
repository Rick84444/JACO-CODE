import { MissionReview } from './MissionReview';
import { ConnectionsWorkspace } from './ConnectionsWorkspace';
import { readAuraResponse as json, acknowledgeSavedDraft } from '../lib/auraApi.mjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  BookOpen,
  Braces,
  CircleDollarSign,
  MonitorSmartphone,
  Database,
  FileCode2,
  Folder,
  GitBranch,
  Hammer,
  Network,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  ChevronLeft,
  ListChecks,
  LogOut,
  MoreHorizontal,
  X,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { AuraEditorFile } from './AuraCodeEditor';
const AuraCodeEditor = React.lazy(() => import('./AuraCodeEditor').then(module => ({default:module.AuraCodeEditor})));
import { AuraChatPanel, useAuraChatSession, type AuraSelectedTool } from './AuraChatPanel';
import { AuraCommandPalette } from './AuraCommandPalette';
import { CognitiveWorkspace, type CognitiveCanvas } from './CognitiveWorkspace';
const AuraAgentWorkspace = React.lazy(() => import('./AuraAgentBoard').then(module => ({ default: module.AuraAgentWorkspace })));
import { CognitiveGameboard } from './CognitiveGameboard';
import { VoiceChannel } from './VoiceChannel';
import { CognitiveEvidence } from './CognitiveEventCard';
import { CognitivePreview } from './CognitivePreview';
import { AuraLiveStage } from './AuraLiveStage';
import { MissionCard } from './MissionCard';
import { auraStageCandidate, auraMaterialKind, stageFileAllowed } from '../lib/auraStage.mjs';
import { auraPresence } from '../lib/auraPresence.mjs';
import { useCognitiveLive, type CognitiveEvent } from '../hooks/useCognitiveLive';
import { toCognitiveEvent, liveWorkspaceStatus } from '../lib/cognitiveEvents.mjs';
import { JacoWordmark } from './JacoWordmark';
import { AuraRepositoryTree } from './AuraRepositoryTree';
import { AuraProjectPicker } from './AuraProjectPicker';
import { canSwitchProject } from '../lib/auraProject.mjs';
import { readWorkspaceDrafts, writeWorkspaceDrafts } from '../lib/auraRecovery.mjs';
import { AuraIntegrationsPanel } from './AuraIntegrationsPanel';
import { NovaPlannerCard } from './NovaPlannerCard';
import { ActivationCard, useActivationReport } from './ActivationCard';
import { RevenueView } from './RevenueView';
import { SkillsView } from './SkillsView';
import { ProviderConnect } from './ProviderConnect';
import { EconomicBudgetPanel } from './EconomicBudgetPanel';
import { DevicesView } from './DevicesView';
import { McpServersPanel, type McpCallRecord } from './McpServersPanel';
import { describeNovaResult, describeNovaTask, type NovaMissionSummary } from '../lib/novaActivityText';
import { AURA_PRODUCT_TOOLS, type AuraProductTool } from '../lib/auraToolRegistry';


interface WorkbenchAgent {
  agentId: string;
  name: string;
  type: string;
  role: string | null;
  status: string;
  liveSessions: number;
  lastSeenAt: string | null;
  capabilities: Record<string, unknown>;
  permissions: Record<string, boolean>;
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
  status: 'ACTIVE' | 'REGISTERED' | 'DISABLED' | string;
  roles?: string[];
  disabled?: boolean;
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
  missionId?: string | null;
  missionGoal?: string | null;
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
  missions?: NovaMissionSummary[];
  runtime: {
    running: boolean;
    workers: any[];
    dispatchPressure: any;
  };
  providers: WorkbenchProvider[];
  skills: WorkbenchSkill[];
  skillFiles?: number;
  skillRuntime: {
    schema?: string;
    activeExecutions?: number;
    recentEvents?: any[];
    catalog?: { count?: number; active?: number; candidate?: number };
    jit?: Record<string, any>;
    optimizer?: Record<string, any>;
  };
  tools: WorkbenchTool[];
  git: {
    available: boolean;
    branch: string | null;
    tracking: string | null;
    ahead: number;
    behind: number;
    dirty: boolean;
    changes: Array<{ path: string; index: string; worktree: string; status: string }>;
    error?: string;
  };
  mcp: {
    schema: string;
    providers: Array<{
      id: string;
      name: string;
      endpoint: string;
      role: string;
      status: string;
      transport?: 'stdio' | 'http';
      credentialEnv?: string;
      health?: any;
      observation?: any;
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
        readOnly: boolean;
        agentAllowed?: boolean;
      }>;
      error: string | null;
      icon?: string;
      agentAccess?: 'off' | 'read' | 'write';
      deny?: string[];
      builtIn?: boolean;
      stats?: { calls: number; failures: number; refused: number; lastCall: McpCallRecord | null };
    }>;
    recentCalls?: McpCallRecord[];
    sources: Array<{
      id: string;
      repoUrl: string;
      requestedRef: string | null;
      resolvedSha: string;
      status: string;
      importedAt: string;
      manifest: {
        packageName: string | null;
        packageVersion: string | null;
        dependencies: number;
        candidateFiles: string[];
      };
    }>;
  };
  integrations: {
    schema: 'jaco.aura-integration-fabric/v1';
    git: { state: string; branch: string | null; dirty: boolean; changeCount: number; error: string | null };
    remote: { state: string; bridge: string; mutationGate: string | null; ready: boolean; windowsObserved: number; error: string | null };
    cdp: { state: string; bridge: string; targetCount: number; error: string | null };
    vscode: { state: string; mcpConfigured: boolean; configPath: string | null; windowCount: number; windows: any[]; evidenceSource: string; note: string };
    chatgpt: { state: string; gatewayConfigured: boolean; matches: Array<{ kind: string; name: string; status: string | null }>; note: string };
  };
  approvals: ApprovalCenterSnapshot;
  activity: WorkbenchActivity[];
}

interface WorkspaceFile {
  path: string;
  size: number;
}

interface FileResponse extends AuraEditorFile {
  success: boolean;
}

type SidebarView = 'explorer' | 'source-control' | 'tools' | 'skills' | 'devices' | 'providers' | 'revenue';
type TerminalMode = 'human' | 'raw';
type BottomPanel = 'missions' | 'terminal' | 'problems' | 'output' | 'evidence';



const formatTime = (value: string | null | undefined) => {
  if (!value) return '--:--:--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
};

const humanizeActivity = (event: WorkbenchActivity) =>
  toCognitiveEvent(event)?.text || String(event.message || event.type).replace(/\b(SEER|Nova|Aura)\b/g, 'JACO');

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

export const JacoAuraComputeIDE: React.FC = () => {
  const chatSession = useAuraChatSession();
  const activation = useActivationReport();
  const cognitiveLive = useCognitiveLive();
  const [workspaceView, setWorkspaceView] = useState<CognitiveCanvas>('conversation');
  const [workspacePinned, setWorkspacePinned] = useState(false);
  const [focusedEvent, setFocusedEvent] = useState<CognitiveEvent|null>(null);
  const [stageSaveBusy, setStageSaveBusy] = useState(false);
  const [stageSaveNotice, setStageSaveNotice] = useState<string|null>(null);
  const chooseWorkspace = (view:CognitiveCanvas) => {
    if(view === 'stage') setWorkspacePinned(false);
    else if(view !== 'conversation') setWorkspacePinned(true);
    setWorkspaceView(view);
  };
  const [codeOpened,setCodeOpened]=useState(false);
  useEffect(()=>{if(workspaceView==='code')setCodeOpened(true);},[workspaceView]);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<CognitiveEvent|null>(null);
  const [projectName, setProjectName] = useState('Arbetsyta');
  const [projectRoot,setProjectRoot] = useState('');
  const [draftStorageError,setDraftStorageError] = useState<string|null>(null);
  const [draftNotice,setDraftNotice] = useState<string|null>(null);
  const recoveryWritable=useRef(false);
  useEffect(() => {
    let active=true;
    fetch('/api/aura/workbench/project').then(json).then(data=>{
      if(active && data.root) {
        setProjectName(String(data.root).replace(/\\/g,'/').split('/').filter(Boolean).at(-1) || 'Arbetsyta');
        restoreDrafts(String(data.root),true);
      }
    }).catch(()=>{if(active)setDraftStorageError('Projektets källa kunde inte läsas. Utkast kan inte sparas eller återställas säkert.');});
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSidePanelOpen(false);};
    window.addEventListener('keydown',close);
    return()=>{active=false;window.removeEventListener('keydown',close);};
  }, []);
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  // Bumped when the operator opens another project so the lazily cached tree starts over.
  const [projectKey, setProjectKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Record<string, FileResponse>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [externalFile, setExternalFile] = useState<FileResponse|null>(null);
  const documentsRef=useRef(documents), draftsRef=useRef(drafts);
  documentsRef.current=documents; draftsRef.current=drafts;
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const restoreDrafts=(root:string,initial=false)=>{
    recoveryWritable.current=false;
    setDraftStorageError(null);setDraftNotice(null);
    try {
      // Persistent per-origin/per-project recovery. Nothing is transmitted by this mechanism.
      const saved=readWorkspaceDrafts(window.localStorage,root);
      setDocuments(current=>initial?{...saved.documents,...current}:saved.documents);
      setDrafts(current=>initial?{...saved.drafts,...current}:saved.drafts);
      const paths=Object.keys(saved.drafts);
      setOpenFiles(current=>initial?[...new Set([...current,...paths])]:paths);
      setSelectedFile(current=>initial&&current?current:paths[0]||null);
      if(paths.length)setDraftNotice('Lokala utkast återställda. Kontrollera filversionen före sparning.');
      recoveryWritable.current=true;
    }catch{
      // Do not overwrite an unreadable existing archive with blank data.
      if(!initial){setDocuments({});setDrafts({});setSelectedFile(null);setOpenFiles([]);}
      setDraftStorageError('Utkasten kunde inte återställas. Sparad data lämnas orörd; kopiera nuvarande ändringar innan omladdning.');
    }
    setProjectRoot(root);
  };
  useEffect(()=>{
    if(!projectRoot||!recoveryWritable.current)return;
    try{
      writeWorkspaceDrafts(window.localStorage,projectRoot,'',drafts,documents);
      setDraftStorageError(null);
    }catch{
      setDraftStorageError('Webbläsarens lokala utkast kunde inte sparas. Spara projektfilen eller exportera arbetet innan omladdning.');
    }
  },[projectRoot,drafts,documents]);
  useEffect(()=>{
    if(canSwitchProject(drafts,documents))return;
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',protect);
    return()=>window.removeEventListener('beforeunload',protect);
  },[drafts,documents]);
  // The conversation remains mounted while the operator inspects code or evidence.
  const openChat = () => { setWorkspaceView('conversation'); setSidePanelOpen(false); window.dispatchEvent(new Event('jaco:aura:focus')); };
  const [connectionsTab,setConnectionsTab]=useState('models');
  const [sidebar, setSidebar] = useState<SidebarView>('explorer');
  const [terminalMode, setTerminalMode] = useState<TerminalMode>('human');
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>('missions');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<AuraSelectedTool | null>(null);
  const [mcpGitUrl, setMcpGitUrl] = useState('');
  const [mcpGitRef, setMcpGitRef] = useState('');
  const [mcpImportBusy, setMcpImportBusy] = useState(false);
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null);
  const configureHuggingFace = async (enabled: boolean, tokenEnv: string) => {
    setMcpStarting('huggingface'); setIntegrationNotice(null);
    try {
      await fetch('/api/aura/workbench/mcp/huggingface', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, tokenEnv }) }).then(json);
      if (enabled) {
        const result = await fetch('/api/aura/workbench/mcp/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({providerId:'huggingface'}) }).then(json);
        setIntegrationNotice(`Hugging Face ansluten. ${result.tools?.length ?? 0} verktyg upptäckta.`);
      } else setIntegrationNotice('Hugging Face frånkopplad.');
    } catch (error: any) { setIntegrationNotice(`Hugging Face kunde inte anslutas: ${error?.message || String(error)}`); }
    finally { setMcpStarting(null); void refresh(); }
  };
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalNotice, setTerminalNotice] = useState<string | null>(null);
  const [reviewMissionId,setReviewMissionId] = useState<string|null>(null);
  const [gitDiff, setGitDiff] = useState<{ path: string; worktree: string; staged: string } | null>(null);
  const [gitActionNotice, setGitActionNotice] = useState<string | null>(null);
  const [gitCommitMessage, setGitCommitMessage] = useState('');
  const [gitBusy, setGitBusy] = useState<string | null>(null);
  const [githubAuth, setGithubAuth] = useState<{ available: boolean; accounts: string[]; credentialStored: boolean; loginInProgress: boolean; lastError: string | null } | null>(null);
  const refreshGithubAuth = async () => {
    try {
      const result = await fetch('/api/aura/workbench/github/auth').then(json);
      setGithubAuth(result);
    } catch (error: any) { setGitActionNotice(`GitHub status: ${error?.message || String(error)}`); }
  };
  const loginGithub = async () => {
    try {
      const result = await fetch('/api/aura/workbench/github/login', { method: 'POST' }).then(json);
      setGitActionNotice(result.started ? 'GitHub login opened in your browser. Refresh the account status after signing in.' : result.reason);
      await refreshGithubAuth();
    } catch (error: any) { setGitActionNotice(/NOT_FOUND/.test(error?.message || '') ? 'GitHub-inloggning saknas i den körande backend-versionen. Uppdatera och starta om Aura-servern; omladdning av GUI:t räcker inte.' : `GitHub login: ${error?.message || String(error)}`); }
  };
  const [fileMutation, setFileMutation] = useState<{ mode: 'create' | 'rename' | 'delete'; value: string } | null>(null);
  const [fileMutationBusy, setFileMutationBusy] = useState(false);
  const [fileMutationNotice, setFileMutationNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [goal, setGoal] = useState('');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [missionSubmitting, setMissionSubmitting] = useState(false);
  const [missionNotice, setMissionNotice] = useState<string | null>(null);
  const [showApprovals, setShowApprovals] = useState(false);
  useEffect(() => {
    if (!showApprovals) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowApprovals(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showApprovals]);

  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [probeReceipts, setProbeReceipts] = useState<Record<string, any>>({});
  const [useResult, setUseResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [providerBusy, setProviderBusy] = useState<string | null>(null);

  // The file list changes rarely and is expensive; the snapshot is cheap and drives live state.
  const refresh = async ({ includeFiles = true }: { includeFiles?: boolean } = {}) => {
    const [workbenchResult, filesResult] = await Promise.allSettled([
      fetch('/api/aura/workbench', { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(json),
      includeFiles ? fetch('/api/aura/workbench/files', { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(json) : Promise.resolve(null),
    ]);
    if (workbenchResult.status === 'rejected') throw workbenchResult.reason;
    setSnapshot(workbenchResult.value);
    setConnectionError(null);
    const workspaceFiles = filesResult.status === 'fulfilled' ? filesResult.value : null;
    if(filesResult.status === 'rejected') setRuntimeError('Projektfilerna kunde inte läsas: '+String(filesResult.reason?.message || filesResult.reason));
    if (workspaceFiles) {
      // Conversation is the primary IDE surface. Repository discovery must not steal focus by
      // auto-opening the first file; files only become active after an explicit operator action.
      setFiles(Array.isArray(workspaceFiles?.files) ? workspaceFiles.files : []);
    }
  };

  // Adaptive polling: 3 s while visible, 20 s in a background tab, exponential backoff on
  // errors / 429 so several open tabs and the agents never exhaust the shared API limit.
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let delay = 3000;
    let tick = 0;
    let polling = false;
    const loop = async () => {
      if (stopped || polling) return;
      polling = true;
      const hidden = document.visibilityState === 'hidden';
      try {
        await refresh({ includeFiles: tick % 7 === 0 });
        delay = 3000;
      } catch (error: any) {
        setConnectionError(error?.message || String(error));
        delay = Math.min(delay * 2, 30_000);
      }
      polling = false;
      tick += 1;
      if (!stopped) timer = window.setTimeout(loop, hidden ? Math.max(delay, 20_000) : delay);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      window.clearTimeout(timer);
      void loop();
    };
    void loop();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!selectedFile || documents[selectedFile]) return;
    let cancelled = false;
    fetch(`/api/aura/workbench/file?path=${encodeURIComponent(selectedFile)}`, { cache: 'no-store' })
      .then(json)
      .then(data => {
        if (!cancelled) setDocuments(current => ({ ...current, [selectedFile]: data }));
      })
      .catch(error => {
        if (!cancelled) {
          setRuntimeError(`Unable to open ${selectedFile}: ${error?.message || String(error)}`);
        }
      });
    return () => { cancelled = true; };
  }, [selectedFile, documents]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const fileView = selectedFile ? documents[selectedFile] || null : null;
  // Keep the initialized editor while another file loads. The old file is hidden
  // until the requested document arrives, so it cannot receive accidental edits.
  const lastEditorFile = useRef<FileResponse|null>(null);
  // Preview/Gameboard selects context without changing Monaco's mounted model.
  // Update the active editor model only in the code workspace; hidden editor DOM remains stable.
  if ((workspaceView === 'code' && fileView) || !selectedFile) lastEditorFile.current = fileView;
  const editorFile = workspaceView === 'code' ? (fileView || lastEditorFile.current) : lastEditorFile.current;

  const openFile = (path: string) => {
    setWorkspacePinned(true);
    setWorkspaceView('code');
    setSidePanelOpen(false);
    setSelectedFile(path);
    setOpenFiles(current => current.includes(path) ? current : [...current, path]);
  };

  const closeFile = (path: string) => {
    setOpenFiles(current => {
      const next = current.filter(item => item !== path);
      if (selectedFile === path) {
        const index = current.indexOf(path);
        setSelectedFile(next[Math.max(0, index - 1)] || next[0] || null);
      }
      return next;
    });
  };

  const updateDraft = (path: string, content: string) => {
    setDrafts(current => ({ ...current, [path]: content }));
  };

  const handleSaved = (next: AuraEditorFile) => {
    setDocuments(current => ({
      ...current,
      [next.path]: { success: true, ...next },
    }));
    setDrafts(current => acknowledgeSavedDraft(current, next));
  };

  const runFileMutation = async () => {
    if (!fileMutation || fileMutationBusy) return;
    setFileMutationBusy(true);
    setFileMutationNotice(null);
    try {
      if (fileMutation.mode === 'create') {
        const nextPath = fileMutation.value.trim().replace(/\\/g, '/');
        if (!nextPath) throw new Error('File path is required.');
        const created = await fetch('/api/aura/workbench/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: nextPath, content: '' }),
        }).then(json);
        setDocuments(current => ({
          ...current,
          [nextPath]: { success: true, ...created, content: '' },
        }));
        setOpenFiles(current => current.includes(nextPath) ? current : [...current, nextPath]);
        setSelectedFile(nextPath);
        setFileMutationNotice(`Created ${nextPath}`);
      } else if (fileMutation.mode === 'rename') {
        if (!selectedFile || !fileView?.hash) throw new Error('Open the source file before renaming it.');
        const nextPath = fileMutation.value.trim().replace(/\\/g, '/');
        if (!nextPath) throw new Error('New file path is required.');
        await fetch('/api/aura/workbench/file/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: selectedFile, to: nextPath, expectedHash: fileView.hash }),
        }).then(json);
        const renamed = await fetch(`/api/aura/workbench/file?path=${encodeURIComponent(nextPath)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(json);
        setDocuments(current => {
          const next = { ...current };
          delete next[selectedFile];
          next[nextPath] = renamed;
          return next;
        });
        setDrafts(current => {
          const next = { ...current };
          const draft = next[selectedFile];
          delete next[selectedFile];
          if (draft !== undefined) next[nextPath] = draft;
          return next;
        });
        setOpenFiles(current => current.map(path => path === selectedFile ? nextPath : path));
        setSelectedFile(nextPath);
        setFileMutationNotice(`Renamed to ${nextPath}`);
      } else {
        if (!selectedFile || !fileView?.hash) throw new Error('Open the file before deleting it.');
        const deleting = selectedFile;
        await fetch('/api/aura/workbench/file/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: deleting, expectedHash: fileView.hash }),
        }).then(json);
        setDocuments(current => {
          const next = { ...current };
          delete next[deleting];
          return next;
        });
        setDrafts(current => {
          const next = { ...current };
          delete next[deleting];
          return next;
        });
        setOpenFiles(current => current.filter(path => path !== deleting));
        setSelectedFile(null);
        setFileMutationNotice(`Deleted ${deleting}`);
      }
      setFileMutation(null);
      await refresh();
    } catch (error: any) {
      setFileMutationNotice(error?.message || String(error));
    } finally {
      setFileMutationBusy(false);
    }
  };

  // Starts a stdio MCP server in JACO's MCP host, then refreshes so its tools appear.
  const [mcpStarting, setMcpStarting] = useState<string | null>(null);
  const startMcpServer = async (providerId: string) => {
    setMcpStarting(providerId);
    try {
      await fetch('/api/aura/workbench/mcp/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId }) }).then(json);
      await refresh();
    } catch (error: any) {
      setRuntimeError(`${providerId}: ${error?.message || String(error)}`);
    } finally {
      setMcpStarting(null);
    }
  };

  const importMcpFromGit = async () => {
    const repoUrl = mcpGitUrl.trim();
    if (!repoUrl || mcpImportBusy) return;
    setMcpImportBusy(true);
    setRuntimeError(null);
    try {
      const data = await fetch('/api/aura/workbench/mcp/import-git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, ref: mcpGitRef.trim() || null }),
      }).then(json);
      setMcpGitUrl('');
      setMcpGitRef('');
      setMissionNotice(`MCP source staged: ${data?.source?.id || repoUrl}. Approval is required before activation.`);
      setShowApprovals(true);
      await refresh();
    } catch (error: any) {
      setRuntimeError(error?.message || String(error));
    } finally {
      setMcpImportBusy(false);
    }
  };

  const selectAgentTool = (agent: WorkbenchAgent, toolName: string) => {
    setSelectedTool({
      kind: 'agent',
      id: `agent:${agent.agentId}:${toolName}`,
      label: agent.name,
      agentId: agent.agentId,
      agentName: agent.name,
      toolName,
      readOnly: false,
    });
  };

  const selectMcpTool = (provider: WorkbenchSnapshot['mcp']['providers'][number], tool: WorkbenchSnapshot['mcp']['providers'][number]['tools'][number]) => {
    setSelectedTool({
      kind: 'mcp',
      id: `mcp:${provider.id}:${tool.name}`,
      label: provider.name,
      provider: provider.id,
      toolName: tool.name,
      inputSchema: tool.inputSchema,
      readOnly: tool.readOnly,
    });
  };

  const selectSkillTool = (skill: WorkbenchSkill) => {
    setSelectedTool({
      kind: 'skill',
      id: `skill:${skill.id}`,
      label: skill.name || skill.id,
      skillId: skill.id,
      skillSource: skill.source,
      toolName: skill.id,
      readOnly: false,
    });
  };

  const selectMcpToolByName = (providerId: string, toolName: string) => {
    const provider = snapshot?.mcp?.providers?.find(item => item.id === providerId);
    const tool = provider?.tools?.find(item => item.name === toolName);
    setSidebar('tools');
    if (provider && tool && provider.status === 'READY') {
      selectMcpTool(provider, tool);
      return true;
    }
    setRuntimeError(`${providerId}.${toolName} is not currently observed as available.`);
    return false;
  };

  const openTool = (tool: AuraProductTool) => {
    setSidePanelOpen(true);
    if (tool.id === 'git.source-control') {
      setSidebar('source-control');
      return;
    }
    if (tool.id === 'mcp.fabric') {
      setSidebar('tools');
      return;
    }
    if (tool.id === 'remote.control') {
      void selectMcpToolByName('remote', 'remote_status');
      return;
    }
    if (tool.id === 'browser.cdp') {
      void selectMcpToolByName('cdp', 'nova_targets');
      return;
    }
    if (tool.id === 'editor.vscode') {
      void selectMcpToolByName('remote', 'remote_windows');
      return;
    }
    if (tool.id === 'chatgpt.connector') {
      setSidebar('tools');
      return;
    }
    if (tool.id === 'evidence.receipts') {
      setSidePanelOpen(false); setWorkspaceView('evidence');
      return;
    }
    if (tool.id === 'terminal.open') {
      setSidePanelOpen(false); setWorkspaceView('code'); setShowTerminal(true); setBottomPanel('terminal');
      return;
    }
  };

  const loadGitDiff = async (path: string) => {
    setGitBusy(`diff:${path}`);
    setGitActionNotice(null);
    try {
      const data = await fetch(`/api/aura/workbench/git/diff?path=${encodeURIComponent(path)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(json);
      setWorkspaceView('code'); setSidePanelOpen(false); setShowTerminal(true);
      setGitDiff({ path: data.path, worktree: data.worktree || '', staged: data.staged || '' });
      setBottomPanel('output');
    } catch (error: any) {
      setGitActionNotice(`Diff unavailable: ${error?.message || String(error)}`);
    } finally {
      setGitBusy(null);
    }
  };

  const queueGitAction = async (action: string, payload: Record<string, unknown> = {}) => {
    if (gitBusy) return;
    setGitBusy(action);
    setGitActionNotice(null);
    try {
      const data = await fetch('/api/aura/workbench/git/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      }).then(json);
      setGitActionNotice(data.success
        ? `${action} executed · ${data.actionId || 'action'}`
        : `${action} failed · ${data.actionId || 'action'}`);
      if (action === 'commit') setGitCommitMessage('');
      await refresh();
    } catch (error: any) {
      setGitActionNotice(`Git action not queued: ${error?.message || String(error)}`);
    } finally {
      setGitBusy(null);
    }
  };

  const runTerminalCommand = async () => {
    const command = terminalCommand.trim();
    if (!command) return;
    setTerminalNotice(null);
    try {
      const data = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      }).then(json);
      setTerminalNotice(`${data.status === 'executed' ? 'Executed' : 'Failed'} · ${data.actionId || 'action'}${data.result?.output ? ` · ${String(data.result.output).slice(0, 180)}` : ''}`);
      setTerminalCommand('');
      setBottomPanel('terminal');
      await refresh();
    } catch (error: any) {
      setTerminalNotice(error?.message || String(error));
    }
  };

  const activity = snapshot?.activity || [];
  // The server-redacted live contract is the only source for the conversational event feed.
  // Workbench activity repeats these events under different IDs and belongs in the raw dock only.
  const cognitiveEvents = cognitiveLive.events;
  const candidate = useMemo(()=>auraStageCandidate(cognitiveEvents),[cognitiveEvents]);
  useEffect(()=>{
    if(workspacePinned || !candidate) return;
    if(candidate.event.id===focusedEvent?.id && (candidate.material!=='html' || candidate.event.evidence.path===selectedFile)) return;
    setFocusedEvent(candidate.event);
    if(candidate.material==='html' && stageFileAllowed(candidate.event.evidence.path)) {
      setSelectedFile(candidate.event.evidence.path);
    }
  },[candidate?.event.id,workspacePinned,projectKey,selectedFile]);
  const selectedStage = focusedEvent ? {event:focusedEvent,material:auraMaterialKind(focusedEvent)} : candidate;
  const stagePath = selectedStage?.material==='html' ? selectedStage.event.evidence.path : null;
  const stageFile = stagePath && selectedFile===stagePath ? fileView : null;
  const stageDraft = stageFile ? (drafts[stageFile.path] ?? stageFile.content) : null;
  const saveStageDraft = async(path:string) => {
    if(stageSaveBusy) return;
    const source=documentsRef.current[path];
    const draft=draftsRef.current[path];
    if(!source?.hash || draft===undefined) return;
    setStageSaveBusy(true);setStageSaveNotice(null);
    try {
      await fetch('/api/aura/workbench/file',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({path,content:draft,expectedHash:source.hash})}).then(json);
      const next:FileResponse=await fetch(`/api/aura/workbench/file?path=${encodeURIComponent(path)}`,{cache:'no-store'}).then(json);
      handleSaved(next);
      setStageSaveNotice('Ändringen är sparad i projektfilen.');
    } catch(error:any) {setStageSaveNotice('Kunde inte spara: '+String(error?.message||error));}
    finally {setStageSaveBusy(false);}
  };
  const selectedFileEvent=cognitiveEvents.filter(event=>event.evidence.path===selectedFile).at(-1)?.id;
  useEffect(()=>{
    // The stage shows the same file as the editor and preview: keep it current when an agent rewrites it.
    // On desktop the stage is visible in both the 'conversation' and 'stage' views.
    if(!selectedFile || !['code','preview','stage','conversation'].includes(workspaceView)) return;
    let active=true, polling=false;
    setExternalFile(null);
    const observeFile=async()=>{
      if(polling || document.visibilityState==='hidden') return;
      polling=true;
      try {
        const next:FileResponse=await fetch(`/api/aura/workbench/file?path=${encodeURIComponent(selectedFile)}`,{cache:'no-store',signal:AbortSignal.timeout(10000)}).then(json);
        const previous=documentsRef.current[selectedFile];
        if(!active || !previous || previous.hash===next.hash) return;
        const draft=draftsRef.current[selectedFile];
        if(draft!==undefined && draft!==previous.content) {setExternalFile(next);return;}
        // Only advance a clean document. A dirty draft keeps the old hash so save conflicts fail closed.
        setDocuments(current=>({...current,[selectedFile]:next}));
        setDrafts(current=>{if(current[selectedFile]!==previous.content)return current;const copy={...current};delete copy[selectedFile];return copy;});
        setExternalFile(null);
      } catch(error:any) {if(active)setRuntimeError('Filen kunde inte uppdateras: '+String(error?.message||error));}
      finally {polling=false;}
    };
    void observeFile();
    const timer=window.setInterval(observeFile,3000);
    return()=>{active=false;window.clearInterval(timer);};
  },[selectedFile,workspaceView,projectKey,selectedFileEvent]);
  const acceptExternalFile=()=>{
    if(!externalFile || !window.confirm('Läs den senaste filen och ersätt ditt osparade utkast?'))return;
    setDocuments(current=>({...current,[externalFile.path]:externalFile}));
    setDrafts(current=>{const next={...current};delete next[externalFile.path];return next;});
    setExternalFile(null);
  };
  const mission = snapshot?.mission || null;
  const missions = snapshot?.missions || [];
  const latestMission = missions[0] || null;
  const missionGoals = new Map(missions.map(m => [m.id, m.goal]));
  const missionPhase = String(mission?.phase || mission?.status || (latestMission ? `NO ACTIVE MISSION (latest ${latestMission.status})` : 'NO ACTIVE MISSION'));

  const startGoal = async (explicitGoal?: string, toolHint?: AuraSelectedTool | null, attachmentIds?: string[]) => {
    const trimmed = String(explicitGoal ?? goal).trim();
    if (!trimmed || missionSubmitting) return;
    setMissionSubmitting(true);
    setMissionNotice(null);
    try {
      const data = await fetch('/api/aura/workbench/start-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: trimmed, attachmentIds,
          toolHint: toolHint ? {
            kind: toolHint.kind,
            provider: toolHint.provider || null,
            agentId: toolHint.agentId || null,
            agentName: toolHint.agentName || null,
            skillId: toolHint.skillId || null,
            toolName: toolHint.toolName,
          } : null,
        }),
      }).then(json);
      if (explicitGoal == null) setGoal('');
      const acceptedGoal = data.goal || data.mission;
      if (!acceptedGoal?.id) throw new Error('GOAL_ACKNOWLEDGEMENT_INVALID');
      setMissionNotice(`Uppdrag registrerat: ${acceptedGoal.id}`);
      void refresh({ includeFiles: false }).catch(() => {});
      return { ...data, goal: acceptedGoal };
    } catch (error: any) {
      setMissionNotice(`Uppdragets registrering kunde inte bekräftas: ${error?.message || String(error)}`);
      throw error;
    } finally {
      setMissionSubmitting(false);
    }
  };

  const resolveApproval = async (approval: OperatorApproval, decision: string) => {
    const busyKey = `${approval.id}:${decision}`;
    if (approvalBusy) return;
    setApprovalBusy(busyKey);
    setApprovalError(null);
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
      setApprovalError(error?.message || String(error));
    } finally {
      setApprovalBusy(null);
    }
  };

  const approvalLabel = (action: string) => ({
    approve: 'Godkänn',
    reject: 'Avslå',
    confirm: 'Bekräfta resultat',
    resume: 'Fortsätt',
    cancel: 'Avsluta uppdrag',
  } as Record<string, string>)[action] || action;

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

  // One choice for everything the operator talks to or builds with: this provider (and its model) becomes Nova's
  // planner and the chat's model, so agents use what the GUI shows (operator 2026-10-13).
  const useProviderEverywhere = async (provider: any) => {
    setProviderBusy(provider.id);
    try {
      // Fail closed: "Använd" must mean a real completion worked, not merely that a key string exists.
      // Read the server's current model list, test the exact model, then persist the choice.
      const plannerState = await fetch('/api/nova/planner', { cache: 'no-store' }).then(json);
      const option = (plannerState?.choices || []).find((item: any) => item.provider === provider.id);
      if (!option) throw new Error('PLANNER_PROVIDER_UNKNOWN');
      if (!option.usable) throw new Error(option.keyConfigured ? 'PLANNER_PAID_MODELS_DISABLED' : 'PLANNER_KEY_MISSING');
      const configured = String(provider.defaultModel || '');
      const model = option.models?.includes(configured) ? configured : String(option.models?.[0] || configured || '');
      if (!model) throw new Error('PLANNER_MODEL_UNKNOWN');

      const tested = await fetch('/api/nova/planner/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: provider.id, model }),
      }).then(json);
      if (!tested?.result?.ok) throw new Error(`MODEL_TEST_FAILED:${tested?.result?.error || tested?.result?.status || 'no answer'}`);

      const planner = await fetch('/api/nova/planner', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: provider.id, model }),
      }).then(json);
      const chosen = planner?.choice?.model || model;
      try { localStorage.setItem('jaco:aura:chat-provider:v2', JSON.stringify({ provider: provider.id, model: chosen })); } catch { /* the chat then keeps its own choice */ }
      window.dispatchEvent(new Event('jaco:aura:provider-chosen'));
      setUseResult(current => ({ ...current, [provider.id]: { ok: true, text: `${provider.id} / ${chosen} verifierad (${tested.result.latencyMs ?? '?'} ms) och används nu för chatten och Nova` } }));
    } catch (error: any) {
      const code = String(error?.message || error);
      const why = /PLANNER_KEY_MISSING/.test(code) ? 'nyckel saknas, lägg in den under Lägg till API-nyckel'
        : /PAID_MODELS_DISABLED/.test(code) ? 'betalda modeller är avstängda'
        : /PLANNER_ENV_PRIMARY/.test(code) ? 'servern styr valet via JACO_PRIMARY_PROVIDER'
        : /MODEL_TEST_FAILED/.test(code) ? code.replace(/^MODEL_TEST_FAILED:/, 'modellen svarade inte: ')
        : code;
      setUseResult(current => ({ ...current, [provider.id]: { ok: false, text: `Kunde inte välja ${provider.id}: ${why}` } }));
    } finally {
      setProviderBusy(null);
    }
  };

  const renderSidebar = () => {
    if (sidebar === 'explorer') {
      return (
        <>
          <div className="px-3 pt-2">
            <AuraProjectPicker
              disabled={!canSwitchProject(drafts,documents)}
              onOpened={(root) => {
                setProjectName(root.replace(/\\/g,'/').split('/').filter(Boolean).at(-1) || 'Arbetsyta');
                restoreDrafts(root);
                setProjectKey(key => key + 1);
                void refresh();
              }}
            />
          </div>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Explorer</span><span>{files.length}</span>
          </div>
          <div className="px-2 pb-2 space-y-1.5">
            <div className="flex items-center gap-2 bg-[#1f1f1f] border border-[#3a3a3a] rounded px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Filter files"
                className="w-full bg-transparent outline-none text-xs text-slate-200"
              />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => setFileMutation({ mode: 'create', value: '' })}
                className="border border-[#3a3a3a] rounded px-1 py-1 text-[8px] text-slate-400 hover:text-white hover:bg-[#2a2d2e]"
              >
                New file
              </button>
              <button
                type="button"
                disabled={!selectedFile || !fileView}
                onClick={() => selectedFile && setFileMutation({ mode: 'rename', value: selectedFile })}
                className="border border-[#3a3a3a] rounded px-1 py-1 text-[8px] text-slate-400 hover:text-white hover:bg-[#2a2d2e] disabled:opacity-30"
              >
                Rename
              </button>
              <button
                type="button"
                disabled={!selectedFile || !fileView}
                onClick={() => selectedFile && setFileMutation({ mode: 'delete', value: selectedFile })}
                className="border border-red-950 rounded px-1 py-1 text-[8px] text-red-400 hover:text-red-200 hover:bg-red-950/20 disabled:opacity-30"
              >
                Delete
              </button>
            </div>
            {fileMutation && (
              <div className="border border-[#344552] rounded bg-[#111820] p-2 space-y-1.5">
                <div className="text-[8px] uppercase tracking-wider text-slate-500">{fileMutation.mode} file</div>
                {fileMutation.mode !== 'delete' ? (
                  <input
                    autoFocus
                    value={fileMutation.value}
                    onChange={event => setFileMutation(current => current ? { ...current, value: event.target.value } : current)}
                    onKeyDown={event => { if (event.key === 'Enter') void runFileMutation(); if (event.key === 'Escape') setFileMutation(null); }}
                    placeholder="relative/path/to/file.ts"
                    className="w-full bg-[#0d1117] border border-[#3a3a3a] rounded px-2 py-1.5 text-[9px] outline-none focus:border-cyan-800"
                  />
                ) : (
                  <div className="text-[9px] text-red-300 break-all">
                    Delete {fileMutation.value}? The server verifies the currently opened file hash before removal.
                  </div>
                )}
                <div className="flex gap-1 justify-end">
                  <button type="button" onClick={() => setFileMutation(null)} className="px-2 py-1 text-[8px] text-slate-500">Cancel</button>
                  <button
                    type="button"
                    disabled={fileMutationBusy || (fileMutation.mode !== 'delete' && !fileMutation.value.trim())}
                    onClick={() => void runFileMutation()}
                    className={`px-2 py-1 rounded border text-[8px] disabled:opacity-30 ${fileMutation.mode === 'delete' ? 'border-red-900 text-red-300' : 'border-cyan-900 text-cyan-300'}`}
                  >
                    {fileMutationBusy ? 'Working…' : fileMutation.mode === 'delete' ? 'Confirm delete' : 'Apply'}
                  </button>
                </div>
              </div>
            )}
            {fileMutationNotice && <div className="text-[8px] text-cyan-300 break-words">{fileMutationNotice}</div>}
          </div>
          <AuraRepositoryTree
            key={projectKey}
            files={files}
            selectedPath={selectedFile}
            query={query}
            gitChanges={snapshot?.git?.changes || []}
            onOpen={openFile}
          />
        </>
      );
    }

    if (sidebar === 'source-control') {
      const changes = snapshot?.git?.changes || [];
      return (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Source Control</span>
            <span className="text-[9px] text-slate-600">{snapshot?.git?.branch || 'no branch observed'}{snapshot?.git?.tracking ? ` → ${snapshot.git.tracking}` : ''}</span>
          </div>
          <div className="px-3 py-2 border-b border-[#292929] text-[10px] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">GitHub</span>
              <span className="text-slate-300">{githubAuth?.credentialStored ? githubAuth.accounts.join(', ') : githubAuth?.loginInProgress ? 'Signing in…' : githubAuth?.available ? 'No account stored' : 'Check account status'}</span>
              <button type="button" onClick={() => void refreshGithubAuth()} className="text-cyan-400">Refresh</button>
              <button type="button" onClick={() => void loginGithub()} disabled={githubAuth?.loginInProgress} className="text-cyan-400 disabled:opacity-30">Sign in</button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Repository</span>
              <span className={snapshot?.git?.available ? 'text-emerald-400' : 'text-amber-400'}>
                {snapshot?.git?.available ? (snapshot.git.dirty ? `${changes.length} change(s)` : 'clean') : 'unavailable'}
              </span>
            </div>
            {snapshot?.git?.available && (
              <div className="flex items-center justify-between text-[8px] text-slate-600">
                <span>{snapshot.git.tracking || 'no upstream observed'}</span>
                <span>↑{snapshot.git.ahead || 0} ↓{snapshot.git.behind || 0}</span>
            </div>
            )}
            {gitActionNotice && <div className="text-[9px] text-cyan-300 break-words">{gitActionNotice}</div>}
          </div>

          <div className="flex-1 overflow-auto">
            {changes.map(change => {
              const staged = change.index && change.index !== ' ' && change.index !== '?';
              return (
                <div key={`${change.status}:${change.path}`} className="border-b border-[#292929] group">
                  <button
                    type="button"
                    onClick={() => openFile(change.path)}
                    className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-[#2a2d2e] flex items-center gap-2"
                  >
                    <span className="w-5 font-mono text-amber-300 shrink-0">{change.status.trim() || 'M'}</span>
                    <span className="truncate text-slate-300">{change.path}</span>
                  </button>
                  <div className="px-3 pb-1.5 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void loadGitDiff(change.path)}
                      disabled={Boolean(gitBusy)}
                      className="text-[8px] px-1.5 py-0.5 border border-[#3b4650] rounded text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      Diff
                    </button>
                    <button
                      type="button"
                      onClick={() => void queueGitAction(staged ? 'unstage' : 'stage', { path: change.path })}
                      disabled={Boolean(gitBusy)}
                      className="text-[8px] px-1.5 py-0.5 border border-[#3b4650] rounded text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      {staged ? 'Unstage' : 'Stage'}
                    </button>
                  </div>
                </div>
              );
            })}
            {snapshot?.git?.available && !changes.length && <div className="p-3 text-xs text-slate-500">Working tree clean.</div>}
            {!snapshot?.git?.available && <div className="p-3 text-xs text-amber-400">{snapshot?.git?.error || 'Git status unavailable.'}</div>}
          </div>

          <div className="border-t border-[#292929] p-2 space-y-1.5">
            <textarea
              value={gitCommitMessage}
              onChange={event => setGitCommitMessage(event.target.value)}
              rows={2}
              placeholder="Commit message"
              className="w-full resize-none bg-[#111] border border-[#333] rounded px-2 py-1.5 text-[10px] outline-none focus:border-cyan-800"
            />
            <div className="grid grid-cols-5 gap-1">
              <button
                type="button"
                onClick={() => void queueGitAction('fetch')}
                disabled={!snapshot?.git?.available || Boolean(gitBusy)}
                className="px-1 py-1.5 rounded border border-[#444] text-[8px] hover:bg-[#2a2d2e] disabled:opacity-30"
              >
                Fetch
              </button>
              <button
                type="button"
                onClick={() => void queueGitAction('pull')}
                disabled={!snapshot?.git?.available || !snapshot?.git?.tracking || Boolean(gitBusy)}
                className="px-1 py-1.5 rounded border border-[#444] text-[8px] hover:bg-[#2a2d2e] disabled:opacity-30"
              >
                Pull
              </button>
              <button
                type="button"
                onClick={() => void queueGitAction('stage-all')}
                disabled={!snapshot?.git?.available || !snapshot?.git?.dirty || Boolean(gitBusy)}
                className="px-1 py-1.5 rounded border border-[#444] text-[8px] hover:bg-[#2a2d2e] disabled:opacity-30"
              >
                Stage
              </button>
              <button
                type="button"
                onClick={() => void queueGitAction('commit', { message: gitCommitMessage })}
                disabled={!gitCommitMessage.trim() || Boolean(gitBusy)}
                className="px-1 py-1.5 rounded border border-cyan-900 text-cyan-300 text-[8px] hover:bg-cyan-950/30 disabled:opacity-30"
              >
                Commit
              </button>
              <button
                type="button"
                onClick={() => void queueGitAction('push')}
                disabled={!snapshot?.git?.available || Boolean(gitBusy)}
                className="px-1 py-1.5 rounded border border-amber-900 text-amber-300 text-[8px] hover:bg-amber-950/30 disabled:opacity-30"
              >
                Push
              </button>
            </div>
            <div className="text-[8px] text-slate-600">
              Git read/write, stage, commit, pull, push and merge are Level-5 mission capabilities. Outgoing payments remain the operator gate.
            </div>
          </div>
        </>
      );
    }

    if (sidebar === 'revenue') return <RevenueView />;
    if (sidebar === 'skills') return <SkillsView />;
    if (sidebar === 'devices') return <DevicesView />;

    if (sidebar === 'tools') {
      return (
        <>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Tool Fabric</span>
            <button onClick={() => setCommandPaletteOpen(true)} className="text-[9px] text-cyan-400 hover:text-cyan-300">Ctrl⇧P</button>
          </div>

          <div className="flex-1 overflow-auto">
            <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-600">INTEGRATION FABRIC</div>
            <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
              {([
                ['Git', snapshot?.integrations?.git?.state || 'UNOBSERVED', () => setSidebar('source-control'), `${snapshot?.integrations?.git?.changeCount ?? 0} change(s)`],
                ['Remote', snapshot?.integrations?.remote?.state || 'UNOBSERVED', () => selectMcpToolByName('remote','remote_status'), `${snapshot?.integrations?.remote?.windowsObserved ?? 0} window(s)`],
                ['CDP', snapshot?.integrations?.cdp?.state || 'UNOBSERVED', () => selectMcpToolByName('cdp','nova_targets'), `${snapshot?.integrations?.cdp?.targetCount ?? 0} target(s)`],
                ['VS Code', snapshot?.integrations?.vscode?.state || 'UNOBSERVED', () => selectMcpToolByName('remote','remote_windows'), snapshot?.integrations?.vscode?.note || (snapshot?.integrations?.vscode?.mcpConfigured ? 'MCP configured; no live window observed' : 'MCP client not observed')],
                ['ChatGPT', snapshot?.integrations?.chatgpt?.state || 'UNOBSERVED', () => {}, snapshot?.integrations?.chatgpt?.note || 'not observed'],
              ] as Array<[string,string,()=>void,string]>).map(([label,state,action,detail]) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  className="text-left border border-[#30363d] bg-[#111820] rounded p-2 hover:border-[#4b5a67] min-w-0"
                  title={detail}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] text-slate-300 truncate">{label}</span>
                    <span className={`text-[7px] border rounded px-1 ${statusClass(state)}`}>{state}</span>
                  </div>
                  <div className="mt-1 text-[7px] text-slate-600 truncate">{detail}</div>
                </button>
              ))}
            </div>

            <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-600">Live agent tools</div>
            {(snapshot?.workplace?.agents || []).filter(agent => agent.liveSessions > 0).map(agent => (
              <div key={agent.agentId} className="border-b border-[#292929]">
                <div className="px-3 py-1.5 flex items-center gap-2 bg-[#1b1b1b]">
                  <Bot className="w-3 h-3 text-cyan-400" />
                  <span className="text-[10px] font-semibold text-slate-300 truncate">{agent.name}</span>
                  <span className={`ml-auto text-[8px] border rounded px-1 ${statusClass(agent.status)}`}>{agent.status}</span>
                </div>
                <div className="px-3 pb-1 flex flex-wrap gap-1">
                  {Object.entries(agent.permissions || {}).filter(([,allowed]) => allowed).slice(0,8).map(([permission]) => (
                    <span key={permission} className="text-[7px] border border-emerald-950 text-emerald-500/80 rounded px-1">{permission}</span>
                  ))}
                  {Object.entries(agent.permissions || {}).filter(([,allowed]) => !allowed).slice(0,4).map(([permission]) => (
                    <span key={permission} className="text-[7px] border border-slate-800 text-slate-600 rounded px-1 line-through">{permission}</span>
                  ))}
                </div>
                <div className="py-1">
                  {(agent.tools || []).map(toolName => (
                    <button
                      key={toolName}
                      onClick={() => selectAgentTool(agent, toolName)}
                      className={`w-full text-left px-5 py-1.5 hover:bg-[#2a2d2e] flex items-center gap-2 ${selectedTool?.id === `agent:${agent.agentId}:${toolName}` ? 'bg-[#17324a]' : ''}`}
                    >
                      <Wrench className="w-3 h-3 text-sky-400 shrink-0" />
                      <span className="text-[10px] text-slate-300 truncate">{toolName}</span>
                    </button>
                  ))}
                  {!agent.tools?.length && <div className="px-5 py-1 text-[9px] text-slate-600">No advertised tools.</div>}
                </div>
              </div>
            ))}
            {!snapshot?.workplace?.agents?.some(agent => agent.liveSessions > 0) && (
              <div className="px-3 py-2 text-[10px] text-slate-600">No READY Workplace agents observed.</div>
            )}

            <AuraIntegrationsPanel workplace={snapshot?.workplace} observedAt={snapshot?.observedAt} providers={snapshot?.mcp?.providers || []} busy={mcpStarting} onConnect={id => void startMcpServer(id)} onHuggingFace={(enabled, tokenEnv) => void configureHuggingFace(enabled, tokenEnv)} notice={integrationNotice} />
            <McpServersPanel
              providers={snapshot?.mcp?.providers || []}
              recentCalls={snapshot?.mcp?.recentCalls || []}
              busy={mcpStarting}
              selectedToolId={selectedTool?.id || null}
              onStart={id => void startMcpServer(id)}
              onSelectTool={(provider, tool) => selectMcpTool(provider as any, tool as any)}
              onChanged={notice => { setIntegrationNotice(notice); void refresh({ includeFiles: false }); }}
            />

            <div className="px-3 py-1.5 mt-2 text-[9px] uppercase tracking-wider text-slate-600">Git MCP sources</div>
            <div className="px-3 pb-2 space-y-1.5">
              <input
                value={mcpGitUrl}
                onChange={event => setMcpGitUrl(event.target.value)}
                placeholder="https://github.com/owner/mcp-server"
                className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-[10px] outline-none focus:border-violet-800"
              />
              <div className="flex gap-1.5">
                <input
                  value={mcpGitRef}
                  onChange={event => setMcpGitRef(event.target.value)}
                  placeholder="ref/tag (optional)"
                  className="min-w-0 flex-1 bg-[#111] border border-[#333] rounded px-2 py-1.5 text-[10px] outline-none focus:border-violet-800"
                />
                <button
                  onClick={() => void importMcpFromGit()}
                  disabled={!mcpGitUrl.trim() || mcpImportBusy}
                  className="px-2 py-1.5 rounded border border-violet-800 text-violet-300 text-[9px] hover:bg-violet-950/30 disabled:opacity-30"
                >
                  {mcpImportBusy ? 'Importing…' : 'Stage'}
                </button>
              </div>
              <div className="text-[8px] text-slate-600">Source is pinned to commit and cannot execute until Approval Center promotion.</div>
            </div>
            {(snapshot?.mcp?.sources || []).map(source => (
              <div key={source.id} className="px-3 py-2 border-b border-[#292929]">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-300 truncate">{source.manifest.packageName || source.id}</span>
                  <span className={`ml-auto text-[8px] ${source.status === 'OPERATOR_APPROVED' ? 'text-emerald-400' : source.status === 'QUARANTINED' ? 'text-red-400' : 'text-amber-400'}`}>{source.status}</span>
                </div>
                <div className="text-[8px] text-slate-600 mt-1 truncate">{source.repoUrl} · {source.resolvedSha.slice(0,12)}</div>
                <div className="text-[8px] text-slate-700 mt-0.5">{source.manifest.dependencies} deps · not auto-executed</div>
              </div>
            ))}

            <div className="px-3 py-1.5 mt-2 text-[9px] uppercase tracking-wider text-slate-600">Installed skills</div>
            {(snapshot?.skills || []).map(skill => (
              <button
                key={skill.id}
                onClick={() => selectSkillTool(skill)}
                disabled={!skill.enabled}
                className={`w-full text-left px-3 py-2 border-b border-[#292929] hover:bg-[#2a2d2e] disabled:opacity-35 ${selectedTool?.id === `skill:${skill.id}` ? 'bg-[#193126]' : ''}`}
                title={skill.description}
              >
                <div className="flex items-center gap-2">
                  <Braces className={`w-3 h-3 ${skill.enabled ? 'text-emerald-400' : 'text-slate-600'}`} />
                  <span className="text-xs text-slate-200 truncate">{skill.name || skill.id}</span>
                  <span className={`ml-auto text-[8px] ${skill.enabled ? 'text-emerald-400' : 'text-amber-500'}`}>{skill.status}</span>
                </div>
                <div className="text-[9px] text-slate-500 mt-1 truncate">
                  v{skill.version || '?'} · {skill.source === 'continuum-runtime' ? 'Continuum Skill Runtime' : (skill.authorNodeId || 'A2A')}
                </div>
                {skill.substrates?.length ? <div className="text-[8px] text-slate-600 mt-0.5 truncate">{skill.substrates.join(' · ')}</div> : null}
              </button>
            ))}
            {!snapshot?.skills?.length && (
              <div className="px-3 py-2 text-[10px] text-slate-600">
                No skill manifests observed. Canonical Skill Runtime: {snapshot?.skillRuntime?.schema || 'UNOBSERVED'} · catalog {snapshot?.skillRuntime?.catalog?.count ?? 0}.
              </div>
            )}
            {snapshot?.skillRuntime && (
              <div className="px-3 py-2 border-b border-[#292929] text-[9px] text-slate-500">
                Skill Runtime · {snapshot.skillRuntime.catalog?.active ?? 0} active · {snapshot.skillRuntime.catalog?.candidate ?? 0} candidate · {snapshot.skillRuntime.recentEvents?.length ?? 0} recent event(s)
              </div>
            )}

            <div className="px-3 py-1.5 mt-2 text-[9px] uppercase tracking-wider text-slate-600">Arbetsflöden</div>
            {AURA_PRODUCT_TOOLS.map(tool => (
              <button key={tool.id} onClick={() => openTool(tool)} className="w-full text-left px-3 py-2 border-b border-[#292929] hover:bg-[#2a2d2e]">
                <div className="flex items-center gap-2">
                  <Wrench className="w-3 h-3 text-cyan-400" />
                  <span className="text-xs text-slate-200">{tool.title}</span>
                  {tool.authority !== 'ALLOW' && <span className="ml-auto text-[8px] border border-amber-900 text-amber-300 rounded px-1">{tool.authority}</span>}
                </div>
                <div className="text-[9px] text-slate-500 mt-1">{tool.category} · {tool.command}</div>
              </button>
            ))}
          </div>
        </>
      );
    }

    return (
      <>
        <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400">Providers</div>
        <div className="flex-1 overflow-auto px-2 space-y-2">
          <EconomicBudgetPanel inline />
          <NovaPlannerCard />
          {(snapshot?.providers || []).map(provider => {
            const receipt = probeReceipts[provider.id];
            return (
              <div key={provider.id} className="border border-[#333] bg-[#1d1d1d] rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <strong className="text-xs">{provider.id}</strong>
                    <span className={`text-[8px] border rounded px-1 ${statusClass(provider.status)}`}>{provider.status}</span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => void useProviderEverywhere(provider)}
                      disabled={providerBusy === provider.id || provider.disabled}
                      className="text-[11px] border border-cyan-700 text-cyan-200 px-2.5 py-1.5 rounded hover:bg-cyan-950 disabled:opacity-40"
                    >
                      Använd
                    </button>
                    <button
                      onClick={() => void probeProvider(provider.id)}
                      disabled={providerBusy === provider.id}
                      className="text-[11px] border border-[#444] px-2.5 py-1.5 rounded hover:bg-[#2b2b2b] disabled:opacity-40"
                    >
                      {providerBusy === provider.id ? 'Testar…' : 'Testa'}
                    </button>
                  </div>
                </div>
                <div className="text-[10px] mt-1">
                  {provider.disabled
                    ? <span className="text-slate-500">avstängd (JACO_DISABLED_PROVIDERS)</span>
                    : provider.roles?.length
                      ? <span className="text-emerald-300">används för: {provider.roles.join(' · ')}</span>
                      : <span className="text-slate-500">används inte</span>}
                </div>
                <div className="text-[10px] text-slate-500 mt-1 truncate">{provider.baseUrl}</div>
                <div className="grid grid-cols-2 gap-1 mt-2 text-[10px]">
                  <span>model</span><span className="text-slate-300 truncate">{provider.defaultModel || 'not set'}</span>
                  <span>API-nyckel</span><span className={provider.credentialConfigured ? 'text-emerald-300' : 'text-slate-400'}>{provider.credentialConfigured ? 'Konfigurerad' : provider.apiKeyEnv ? 'Ej konfigurerad' : 'Ingen referens angiven'}</span>
                </div>
                {useResult[provider.id] && (
                  <div className={`mt-2 text-[11px] border rounded p-1.5 ${statusClass(useResult[provider.id].ok ? 'VERIFIED' : 'FAILED')}`}>{useResult[provider.id].text}</div>
                )}
                {receipt && (
                  <div className={`mt-2 text-[10px] border rounded p-1.5 ${statusClass(receipt.ok ? 'VERIFIED' : 'FAILED')}`}>
                    {receipt.ok ? `probe OK · ${receipt.latencyMs ?? '?'} ms · ${receipt.models?.length ?? 0} model(s)` : `probe failed · ${receipt.error || receipt.status || 'unknown'}`}
                  </div>
                )}
              </div>
            );
          })}

          <ProviderConnect onConnected={async () => { await refresh(); window.dispatchEvent(new Event('jaco:aura:provider-chosen')); }} />
        </div>
      </>
    );
  };

  const cancelMission = async (id: string) => {
    await fetch(`/api/aura/workbench/missions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(json);
    await refresh({ includeFiles: false });
  };

  const renderChatContent = () => (
    <>
      <div className="flex-1 min-h-0">
        <AuraChatPanel
          session={chatSession}
          runControls={activation.report?.ok && !activation.error ? null : <ActivationCard activation={activation} projectName={projectName}
            onOpenProject={() => { setSidebar('explorer'); setSidePanelOpen(true); }}
            onOpenProviders={() => {setConnectionsTab('models');setWorkspaceView('connections');}}
            onActivated={() => { void refresh().catch(() => {}); }} />}
          missions={missions}
          onOpenProviders={() => {setConnectionsTab('models');setWorkspaceView('connections');}}
          activeFilePath={selectedFile}
          activeFileContent={fileView ? (drafts[fileView.path] ?? fileView.content) : null}
          selectedTool={selectedTool}
          activity={activity.map(event => {
            if (event.message) return event;
            const goal = event.missionGoal || (event.missionId ? missionGoals.get(event.missionId) : null);
            return { ...event, message: `${goal ? `[${String(goal).slice(0, 40)}] ` : ''}${humanizeActivity(event)}` };
          })}
          onClearSelectedTool={() => setSelectedTool(null)}
          liveEvents={cognitiveEvents}
          liveConnection={cognitiveLive.connection}
          historyTruncated={cognitiveLive.historyTruncated}
          runtimeRunning={snapshot?.runtime?.running}
          runtimeError={runtimeError}
          onOpenEvidence={(event) => { setSelectedEvidence(event); setWorkspaceView('evidence'); }}
          onOpenFile={openFile}
          onStartGoal={async (text, tool, attachments) => { return await startGoal(text, tool, attachments); }}
        />
      </div>
    </>
  );

  const renderMissionList = () => (
    <>
            {missions.length === 0 && <div className="text-slate-500 p-1">Inga uppdrag observerade.</div>}
            {missions.map(m => {
              const result = m.lastAction?.result;
              return (
                <div key={m.id} className={`min-w-0 overflow-hidden border rounded px-2 py-1.5 ${m.status === 'ACTIVE' ? 'border-cyan-800 bg-[#0b1620]' : 'border-[#2b2b2b] bg-[#141414]'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[9px] border rounded px-1 shrink-0 ${statusClass(m.status)}`}>{m.status}</span><button type="button" onClick={()=>{setReviewMissionId(m.id);setWorkspaceView('evidence');}}>Granska ändringar</button>
                    <span className="min-w-0 flex-1 text-slate-200 truncate" title={m.goal}>{m.goal}</span>
                    <span className="ml-auto text-[9px] text-slate-500 shrink-0">
                      steg {m.step}{m.maxSteps ? `/${m.maxSteps}` : ''} · {formatTime(m.updatedAt)}
                    </span>
                  </div>
                  {m.lastAction && (
                    <div className="mt-0.5 text-[10px] flex gap-1.5 min-w-0">
                      <span className="text-slate-500 shrink-0">{m.lastAction.running ? 'Kör nu:' : 'Senast:'}</span>
                      <span className="min-w-0 text-slate-300 truncate">{m.lastAction.text}</span>
                      {result && (
                        <span className={`truncate ${result.state === 'verified' ? 'text-emerald-400' : result.state === 'failed' ? 'text-amber-400' : 'text-slate-400'}`}>
                          {'→ '}{result.url ? <a href={result.url} target="_blank" rel="noreferrer" className="underline">{result.text}</a> : result.text}
                        </span>
                      )}
                    </div>
                  )}
                  {m.answer && (
                    <details className="mt-1 text-[10px] min-w-0">
                      <summary className="cursor-pointer text-cyan-300 truncate">Svar: {m.answer.split('\n')[0]}</summary>
                      <div className="mt-1 whitespace-pre-wrap break-words text-slate-300 max-h-60 overflow-auto">{m.answer}</div>
                      <div className={`mt-1 text-[9px] ${!m.evidence?.cited.length ? 'text-slate-500' : m.evidence.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {!m.evidence?.cited.length
                          ? 'Belägg: svaret hänvisar inte till några steg'
                          : m.evidence.ok
                            ? `Belägg: ${m.evidence.verified.length}/${m.evidence.cited.length} citerade steg är verifierade kvitton`
                            : `Belägg saknas: ${[...m.evidence.missing, ...m.evidence.unverified].map(n => `#${n}`).join(', ')} finns inte som verifierat kvitto, så svaret godkänns inte automatiskt`}
                      </div>
                      {!m.claimCheck && m.status === 'AWAITING_VERIFICATION' && (
                        <div className="mt-0.5 text-[9px] text-slate-400">Påståendena kontrolleras mot beläggen…</div>
                      )}
                      {m.claimCheck && (
                        <div className={`mt-0.5 text-[9px] ${m.claimCheck.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {m.claimCheck.ok
                            ? `Påståenden: ${m.claimCheck.claims} kontrollerade (${m.claimCheck.facts} fakta mot kvittona${m.claimCheck.judged ? `, ${m.claimCheck.judged} bedömda av ${m.claimCheck.judge}` : ''}), inget motsägs`
                            : m.claimCheck.error
                              ? `Påståendena kunde inte kontrolleras: ${m.claimCheck.error}`
                              : `${m.claimCheck.problems.length} påstående(n) håller inte mot beläggen:`}
                          {m.claimCheck.partial.length > 0 && ` (avkortade belägg: ${m.claimCheck.partial.map(n => `#${n}`).join(', ')})`}
                          {!m.claimCheck.ok && m.claimCheck.problems.map((p, i) => (
                            <div key={i} className="ml-2 text-amber-300">- {p.text} <span className="text-slate-400">({p.why})</span></div>
                          ))}
                        </div>
                      )}
                    </details>
                  )}
                </div>
              );
            })}
    </>
  );

  // Approval Center remains the canonical decision surface; pending decisions also appear inline.
  const renderApprovals = () => showApprovals && (

      <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex justify-end" onClick={() => setShowApprovals(false)}>
        <div role="dialog" aria-modal="true" aria-label="Beslut som behöver dig" className="h-[100dvh] max-h-[100dvh] w-full max-w-xl bg-[#111820] border-l border-[#30363d] shadow-2xl flex flex-col" onClick={event => event.stopPropagation()}>
          <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Beslut som behöver dig
                <span className={`text-[10px] rounded border px-1.5 py-0.5 ${snapshot?.approvals?.count ? 'border-amber-700 text-amber-300' : 'border-emerald-800 text-emerald-300'}`}>
                  {snapshot?.approvals?.count ?? 0} väntande beslut
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Arbete som redan är tillåtet inom uppdraget fortsätter automatiskt. Här visas beslut som kräver dig.</div>
            </div>
            <button onClick={() => setShowApprovals(false)} aria-label="Stäng beslutspanelen" className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded border border-[#343b45] text-xs text-slate-200 hover:text-white hover:bg-[#252b33]">
              <X className="w-4 h-4" /> Stäng
            </button>
          </div>

          <div className="px-4 py-3 border-b border-[#252b33] bg-[#0d1117]">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Aktiva behörigheter</div>
            <div className="mt-1 text-xs text-slate-300">
              {snapshot?.approvals?.activeMandates?.length
                ? snapshot.approvals.activeMandates.map(m => `${m.name} · gäller till ${formatTime(m.expiresAt)}`).join(' · ')
                : 'Inga aktiva signerade mandat observerade.'}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {approvalError && <p role="alert" className="text-sm text-amber-300">{approvalError}</p>}
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
                  <div className="text-[9px] uppercase text-slate-600 mb-1">Vad beslutet gäller och tillgängliga belägg</div>
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
                        {busy ? 'Sparar beslut…' : approvalLabel(action)}
                      </button>
                    );
                  })}
                  {!approval.actions.length && (
                    <span className="text-[10px] text-amber-300">En inställning behöver ändras. Visa orsaken ovan och åtgärda den innan du fortsätter.</span>
                  )}
                </div>
              </div>
            ))}

            {!snapshot?.approvals?.items?.length && (
              <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center text-slate-500">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-3" />
                <div className="text-sm text-slate-300">Inga beslut väntar på dig</div>
                <div className="text-[10px] mt-1">JACO väntar inte på något godkännande i de kontrollerade tjänsterna.</div>
              </div>
            )}
          </div>
        </div>
      </div>
  );

  const MOBILE_MORE: [SidebarView, typeof Folder, string][] = [
    ['devices', MonitorSmartphone, 'Enheter'],
    ['skills', BookOpen, 'Skills'],
    ['source-control', GitBranch, 'Git'],
    ['tools', Wrench, 'Verktyg'],
    ['providers', PlugZap, 'Modeller'],
    ['revenue', CircleDollarSign, 'Intäkter'],
  ];
  const remoteViewer = typeof window !== 'undefined' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const signOut = async () => {
    try { await fetch('/ide-auth/logout', { method: 'POST' }); } finally { window.location.replace('/ide-login'); }
  };
  const status = liveWorkspaceStatus({ connection: cognitiveLive.connection, busy: chatSession.busy, missions, runtimeRunning: snapshot?.runtime?.running, error: connectionError, activation, approvalCount: snapshot?.approvals?.count || 0 });
  const [presenceClock,setPresenceClock]=useState(()=>Date.now());
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState!=='hidden')setPresenceClock(Date.now());},5000);
    return()=>window.clearInterval(timer);
  },[]);
  const currentMission=missions.find(item=>item.status==='ACTIVE')||
    missions.find(item=>item.status==='BLOCKED'||item.status==='AWAITING_VERIFICATION')||null;
  const presence=auraPresence({
    now:presenceClock,connection:cognitiveLive.connection,lastObservedAt:cognitiveLive.lastObservedAt,
    snapshotObservedAt:snapshot?.observedAt||null,runtimeRunning:snapshot?.runtime?.running??null,
    mission:currentMission,agents:snapshot?.workplace?.agents||[],
    provider:snapshot?.seer?.provider||null,model:snapshot?.seer?.model||null,
    cdpState:snapshot?.integrations?.cdp?.state||'UNOBSERVED',
    approvals:snapshot?.approvals?.count||0,latestEvent:cognitiveEvents.at(-1)||null
  });
  const codeWorkspace = (
    <div className="cognitive-code-workspace">
      <div className="cognitive-file-tabs">
        {openFiles.map(path => <div key={path} className={selectedFile === path ? 'active' : ''}>
          <button type="button" onClick={() => setSelectedFile(path)}><FileCode2 size={13}/><span>{path.split('/').at(-1)}</span>{drafts[path] !== undefined && drafts[path] !== documents[path]?.content && <span className="cognitive-dirty-dot"/>}</button>
          <button type="button" aria-label={'Stäng '+path} onClick={() => closeFile(path)}><X size={12}/></button>
        </div>)}
        <button type="button" className="cognitive-file-picker" onClick={() => { setSidebar('explorer'); setSidePanelOpen(true); }}><Folder size={14}/>Öppna fil</button>
      </div>
      {runtimeError&&<div role="alert" className="cognitive-operation-notice">{runtimeError}<button type="button" onClick={()=>setRuntimeError(null)} aria-label="Stäng felmeddelandet"><X size={13}/></button></div>}
      <div className="cognitive-editor-body">
        {editorFile && <div className="cognitive-editor-session" hidden={!fileView}><React.Suspense fallback={<div className="cognitive-empty-detail">Öppnar kodeditorn…</div>}><AuraCodeEditor file={editorFile} draft={drafts[editorFile.path]} onDraftChange={updateDraft} onSaved={handleSaved}/></React.Suspense></div>}
        {!fileView && <div className="cognitive-empty-detail"><FileCode2 size={30}/><h2>{selectedFile ? 'Öppnar '+selectedFile+'…' : 'Koden, när du behöver den.'}</h2><p>Öppna en fil från projektet eller från en händelse i samtalet.</p><button type="button" className="cognitive-primary-outline" onClick={() => { setSidebar('explorer'); setSidePanelOpen(true); }}>Visa projektfiler</button></div>}
      </div>
      <button type="button" className="cognitive-dock-toggle" aria-expanded={showTerminal} onClick={() => setShowTerminal(v => !v)}><Terminal size={13}/>{showTerminal ? 'Dölj terminal & detaljer' : 'Öppna terminal & detaljer'}</button>
      {showTerminal && (            <div className="cognitive-terminal-dock min-h-0 min-w-0 flex flex-col">
              <div className="h-9 px-3 flex items-center justify-between border-b border-[#2b2b2b] shrink-0">
                <div className="flex items-center gap-4 text-[11px] h-full">
                  {([
                    ['missions','MISSIONS'],
                    ['terminal','TERMINAL'],
                    ['problems','PROBLEMS'],
                    ['output','OUTPUT'],
                    ['evidence','EVIDENCE'],
                  ] as const).map(([id,label]) => (
                    <button
                      key={id}
                      onClick={() => setBottomPanel(id)}
                      className={`h-full flex items-center gap-1.5 ${bottomPanel === id ? 'text-white border-b border-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {id === 'terminal' && <Terminal className="w-3.5 h-3.5" />}
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500">{snapshot?.observedAt ? `observed ${formatTime(snapshot.observedAt)}` : 'not observed'}</div>
              </div>

              {bottomPanel === 'missions' && (
                <div className="flex-1 min-w-0 overflow-auto p-2 space-y-1.5 text-[11px]">
                  {renderMissionList()}
                </div>
              )}

              {bottomPanel === 'terminal' && (
                <>
                  <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-5">
                    {terminalNotice && <div className="text-cyan-300 mb-2">{terminalNotice}</div>}
                    {/* Newest first, each line naming its mission, so the latest work is visible without scrolling. */}
                    {activity.slice(-40).reverse().map(event => (
                      <div key={event.id} className="flex gap-2">
                        <span className="text-slate-600 shrink-0">{formatTime(event.at)}</span>
                        <span className={event.verified === true ? 'text-emerald-400' : event.verified === false ? 'text-amber-400' : 'text-slate-500'}>{event.verified === true ? '✓' : event.verified === false ? '!' : '·'}</span>
                        <span className="text-slate-300 break-words">
                          {(event.missionGoal || (event.missionId && missionGoals.get(event.missionId))) && (
                            <span className="text-cyan-700" title={String(event.missionGoal || missionGoals.get(String(event.missionId)))}>[{String(event.missionGoal || missionGoals.get(String(event.missionId))).slice(0, 36)}] </span>
                          )}
                          {terminalMode === 'human' ? humanizeActivity(event) : JSON.stringify({ source: event.source, type: event.type, verified: event.verified, payload: event.payload })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={event => { event.preventDefault(); void runTerminalCommand(); }} className="h-9 border-t border-[#2b2b2b] px-3 flex items-center gap-2 shrink-0">
                    <span className="text-emerald-400 font-mono text-xs">$</span>
                    <input value={terminalCommand} onChange={event => setTerminalCommand(event.target.value)} placeholder="Run local shell / npm / node / git command" className="flex-1 bg-transparent outline-none text-[11px] font-mono text-slate-200 placeholder:text-slate-600" />
                    <button className="text-[10px] px-2 py-1 border border-[#444] rounded hover:bg-[#2a2d2e]">Run</button>
                    <button type="button" onClick={() => setTerminalMode(terminalMode === 'human' ? 'raw' : 'human')} className="text-[9px] text-slate-500 hover:text-slate-300">{terminalMode === 'human' ? 'human' : 'raw'}</button>
                  </form>
                </>
              )}

              {bottomPanel === 'problems' && (
                <div className="flex-1 overflow-auto p-3 text-[11px]">
                  {runtimeError || snapshot?.seer?.blocker ? (
                    <div className="space-y-2">
                      {runtimeError && <div className="border border-red-900 bg-red-950/20 rounded p-2 text-red-300">{runtimeError}</div>}
                      {snapshot?.seer?.blocker && <div className="border border-amber-900 bg-amber-950/20 rounded p-2 text-amber-300">{snapshot.seer.blocker}</div>}
                    </div>
                  ) : <div className="text-slate-500">No observed runtime problems.</div>}
                </div>
              )}

              {bottomPanel === 'output' && (
                <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-5">
                  {gitDiff && (
                    <div className="mb-4 border border-[#2f3b46] rounded overflow-hidden">
                      <div className="px-2 py-1.5 bg-[#111820] border-b border-[#2f3b46] text-cyan-300">
                        Git diff · {gitDiff.path}
                      </div>
                      <div className="p-2">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">STAGED</div>
                        <pre className="whitespace-pre-wrap break-words text-[10px] text-slate-300">{gitDiff.staged || 'No staged diff observed.'}</pre>
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mt-3 mb-1">WORKTREE</div>
                        <pre className="whitespace-pre-wrap break-words text-[10px] text-slate-300">{gitDiff.worktree || 'No unstaged diff observed.'}</pre>
                      </div>
                    </div>
                  )}
                  {activity.slice(-100).map(event => <div key={event.id} className="text-slate-400"><span className="text-slate-600">{formatTime(event.at)}</span> {humanizeActivity(event)}</div>)}
                </div>
              )}

              {bottomPanel === 'evidence' && (
                <div className="flex-1 overflow-auto p-3 font-mono text-[10px] leading-4 text-slate-400">
                  <pre className="whitespace-pre-wrap">{JSON.stringify({
                    mission: mission ? { id: mission.id, status: mission.status, phase: mission.phase, receipts: mission.receipts || [] } : null,
                    latestVerifiedProgress: snapshot?.seer?.latestVerifiedProgress || null,
                    integrations: snapshot?.integrations || null,
                    approvals: snapshot?.approvals || null,
                  }, null, 2)}</pre>
                </div>
              )}
            </div>)}
    </div>
  );
  const stagePreview = stagePath && stageFile && stageDraft!==null
    ? <CognitivePreview strict path={stagePath} content={stageDraft} files={files} events={cognitiveEvents} onOpenFile={openFile}/>
    : null;
  const sideMission = missions.find(m=>m.status==='ACTIVE') || missions.find(m=>m.status==='AWAITING_VERIFICATION') || missions.find(m=>m.status==='BLOCKED') || null;
  const sideObservation = sideMission ? cognitiveEvents.filter(event=>event.missionId===sideMission.id).at(-1)?.text ?? null : null;
  const stage = <div className="aura-stage-column">
    {sideMission&&<MissionCard mission={sideMission as any} observation={sideObservation} onCancel={cancelMission} onOpenWork={id=>{setReviewMissionId(id||null);setWorkspacePinned(false);setWorkspaceView('stage');}}/>}
    <AuraLiveStage key={projectKey} candidate={selectedStage} events={cognitiveEvents} preview={stagePreview}
    previewReady={Boolean(stagePreview)} active={status.tone==='active'}
    onInspect={event=>{setSelectedEvidence(event);setWorkspacePinned(true);setWorkspaceView('evidence');}}
    onOpenFile={openFile} htmlSource={stageFile?.content ?? null} htmlDraft={stageDraft}
    onDraftChange={value=>{if(stagePath)updateDraft(stagePath,value);}}
    onSaveDraft={()=>{if(stagePath)void saveStageDraft(stagePath);}} saveBusy={stageSaveBusy} saveNotice={stageSaveNotice}
    cdpReady={snapshot?.integrations?.cdp?.state==='VERIFIED' || snapshot?.integrations?.cdp?.state==='OBSERVED'}
    pinned={workspacePinned}
    activeMission={missions.find(item=>item.status==='ACTIVE') ? {
      id:missions.find(item=>item.status==='ACTIVE')!.id,
      goal:String(missions.find(item=>item.status==='ACTIVE')!.goal || 'Pågående uppdrag'),
      phase:missions.find(item=>item.status==='ACTIVE')!.phase || null,
      status:'ACTIVE'
    } : null}
    agentActivity={{
      connected:(snapshot?.workplace?.agents || []).filter(item=>item.status==='READY' || item.liveSessions>0).length,
      working:(snapshot?.workplace?.agents || []).reduce((count,item)=>count+Math.max(0,item.liveSessions || 0),0)
    }}
    presence={presence}/>
  </div>;
  const canvasDetail = <>
    {workspaceView==='connections'&&<ConnectionsWorkspace initialTab={connectionsTab} onTabChange={setConnectionsTab} onSelectTool={(provider:any,tool:any)=>{selectMcpTool(provider,tool);setWorkspaceView('conversation');}}/>}
    {(codeOpened||workspaceView==='code')&&<div className="cognitive-cached-code" hidden={workspaceView!=='code'}>{codeWorkspace}</div>}
    {workspaceView==='agents'&&<React.Suspense fallback={<div className="cognitive-empty-detail">Öppnar agentkartan…</div>}><AuraAgentWorkspace goal={goal} onGoalChange={setGoal} onStartGoal={()=>{void startGoal().catch(()=>{});}} submitting={missionSubmitting} notice={missionNotice} onReview={()=>setWorkspaceView('evidence')} onCancelMission={cancelMission}/></React.Suspense>}
    {workspaceView==='gameboard'&&<CognitiveGameboard/>}
    {workspaceView==='voice'&&<VoiceChannel/>}
    {workspaceView==='preview'&&<CognitivePreview path={selectedFile} content={fileView ? (drafts[fileView.path] ?? fileView.content) : null} files={files} events={cognitiveEvents} onOpenFile={path => { openFile(path); setWorkspaceView('preview'); }}/>}
    {workspaceView==='evidence'&&<div className="cognitive-evidence-scroll"><MissionReview missions={missions} preferredMissionId={reviewMissionId} onDecisions={()=>setShowApprovals(true)}/><CognitiveEvidence events={cognitiveEvents} selected={selectedEvidence} onSelect={setSelectedEvidence} onOpenFile={openFile}/>
      <details className="cognitive-mission-details"><summary>Uppdrag & kontroller</summary>{renderMissionList()}</details></div>}
  </>;
  const detail=<div className="cognitive-detail-wrapper">
    {draftStorageError&&<div role="alert" className="cognitive-operation-notice">{draftStorageError}</div>}
    {draftNotice&&<div role="status" className="cognitive-operation-notice">{draftNotice}</div>}
    {externalFile&&externalFile.path===selectedFile&&<div role="alert" className="cognitive-operation-notice">Filen har ändrats i arbetsytan. Ditt utkast är bevarat.<button type="button" onClick={acceptExternalFile}>Läs senaste filen</button></div>}
    <div className="cognitive-detail-body">{canvasDetail}</div>
  </div>;
  const pendingDecision = snapshot?.approvals?.items?.[0];
  const attention = pendingDecision ? <section className="cognitive-decision" aria-label="Beslut som behöver dig">
    <div className="cognitive-decision-title"><ShieldAlert size={18}/><strong>JACO behöver ditt beslut</strong><span>{snapshot.approvals.count} väntande</span></div>
    <h2>{pendingDecision.title}</h2>
    <p>{pendingDecision.reason}</p>
    {['command', 'targetFilePath', 'repoUrl'].map(key => typeof pendingDecision.details?.[key] === 'string' && pendingDecision.details[key] &&
      <p key={key} className="cognitive-decision-context"><span>{({command:'Kommando',targetFilePath:'Fil',repoUrl:'Källa'})[key]}: </span><code>{pendingDecision.details[key]}</code></p>)}
    <div className="cognitive-decision-actions">
      {pendingDecision.actions.map(action => <button key={action} type="button" disabled={Boolean(approvalBusy)}
        onClick={() => void resolveApproval(pendingDecision, action)}>{approvalBusy === `${pendingDecision.id}:${action}` ? 'Sparar beslut…' : approvalLabel(action)}</button>)}
      <button type="button" onClick={() => setShowApprovals(true)}>Visa detaljer{snapshot.approvals.count > 1 ? ' och alla beslut' : ''}</button>
    </div>
    {!pendingDecision.actions.length && <p>En inställning behöver åtgärdas. Öppna detaljer för att se vad som saknas.</p>}
    {approvalError && <p role="alert">Beslutet kunde inte sparas: {approvalError}</p>}
  </section> : (snapshot?.seer?.blocker || runtimeError) ? <section className="cognitive-decision" aria-label="Det här behöver åtgärdas">
    <div className="cognitive-decision-title"><ShieldAlert size={18}/><strong>Arbetet behöver hjälp</strong></div>
    <p>{snapshot?.seer?.blocker || runtimeError}</p>
    <div className="cognitive-decision-actions">
      <button type="button" onClick={() => {setConnectionsTab('models');setWorkspaceView('connections');}}>Modellanslutningar</button>
      <button type="button" onClick={() => setWorkspaceView('evidence')}>Visa uppdrag och kontroller</button>
      {runtimeError && <button type="button" onClick={() => setRuntimeError(null)}>Stäng meddelandet</button>}
    </div>
  </section> : null;
  return <>
    <CognitiveWorkspace attention={attention} canvas={workspaceView} onCanvas={chooseWorkspace} conversation={renderChatContent()} detail={detail}
      stage={stage} stagePinned={workspacePinned} onTogglePin={()=>setWorkspacePinned(value=>!value)}
      sidebar={sidebar} sidePanelOpen={sidePanelOpen} sidePanel={renderSidebar()}
      onSidebar={view => { if(['tools','providers','skills'].includes(view)){setConnectionsTab(view==='tools'?'mcp':view==='providers'?'models':'skills');setWorkspaceView('connections');setSidePanelOpen(false);}else{setSidebar(view);setSidePanelOpen(current => sidebar === view ? !current : true);} }}
      onCloseSidebar={() => setSidePanelOpen(false)} status={status} projectName={projectName}
      branch={snapshot?.git?.branch} changes={snapshot?.git?.changes?.length || 0}
      approvalCount={snapshot?.approvals?.count || 0} onApprovals={() => setShowApprovals(true)}
      onCommands={() => setCommandPaletteOpen(true)} onSignOut={() => void signOut()}
      lastObservedAt={cognitiveLive.lastObservedAt || snapshot?.observedAt || null} error={connectionError}/>
    <AuraCommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onOpenTool={openTool}/>
    {renderApprovals()}
  </>;
};

export default JacoAuraComputeIDE;
