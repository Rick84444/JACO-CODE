export interface OllamaModel {
  id: string;
  name: string;
  tag: string;
  size: string;
  quantization: string;
  family: string;
  parameters: string;
  modifiedAt: string;
  contextLength: number;
  isLoaded: boolean;
  memoryRequiredMb: number;
  speedTokensPerSec: number;
  isDownloaded: boolean;
  npuAccelerated: boolean;
}

export interface DeviceTelemetry {
  batteryLevel: number; // old
  batteryStatus: 'charging' | 'discharging' | 'full'; // old
  batteryPercent?: number; // mapped to batteryLevel or dedicated
  isCharging?: boolean; // mapped to batteryStatus
  npuUsagePercent: number;
  npuLoad?: number; // Real-time NPU Load metric (0-100%)
  npuHardwareType?: 'Qualcomm Hexagon DSP' | 'Android NNAPI (Tensor Core)' | 'LiteRT Delegate' | 'Emulated/Unavailable';
  npuFrequencyMhz?: number;
  npuLoadState?: 'OBSERVED' | 'UNAVAILABLE' | 'ACTIVE';
  cpuUsagePercent?: number; // For JACOHardeningWizard
  ramUsedGb: number;
  ramTotalGb: number;
  vramUsedGb: number;
  vramTotalGb: number;
  temperatureC: number;
  thermalTempC?: number; // mapped to temperatureC
  termuxLightLux?: number;
  connectionType: 'Wi-Fi 6' | 'Wi-Fi 5' | '5G' | 'Localhost';
  localIp: string;
  socketPort: number;
  isOfflineMode: boolean;
  activeServiceStatus: 'Online & Syncing' | 'On-Device Private Mode' | 'Wi-Fi Socket Active';
}

export type IntentCategory = 
  | 'CODE_GEN'
  | 'DEBUG'
  | 'REFACTOR'
  | 'TERMINAL'
  | 'MODEL_PULL'
  | 'ANTIGRAVITY_WORKFLOW'
  | 'MULTI_DEVICE_SYNC';

export interface VoiceCommandIntent {
  id: string;
  timestamp: string;
  originalSpeech: string;
  parsedIntentCategory: IntentCategory;
  confidence: number;
  targetFile?: string;
  summary: string;
  actionItems: string[];
  parameters?: Record<string, any>;
}

export interface AgenticStep {
  id: string;
  type: 'PLAN' | 'READ_FILE' | 'AST_ANALYSIS' | 'CODE_PATCH' | 'RUN_TESTS' | 'TERMINAL_EXEC' | 'SYNC_SOCKET';
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  logs: string[];
  durationMs?: number;
  diffPatch?: string;
}

export interface PatchHistoryItem {
  id: string;
  workflowId: string;
  workflowTitle: string;
  agentName: 'JACO' | 'Coder' | 'Termux' | 'OpenClaw' | 'Aura' | string;
  targetFile: string;
  patchDescription: string;
  diffContent: string;
  beforeContent?: string;
  afterContent?: string;
  timestamp: string;
  status: 'applied' | 'rolled_back';
  rolledBackAt?: string;
  linesAdded: number;
  linesRemoved: number;
  verificationHash?: string;
}

export interface CodeFile {
  id: string;
  path: string;
  filename: string;
  language: string;
  content: string;
  isDirty?: boolean;
  errorsCount?: number;
  warningsCount?: number;
}

export interface TerminalLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'command' | 'ollama' | 'antigravity';
  message: string;
  source?: string;
}

export type DeviceType = 'VS Code Extension' | 'Android Tablet' | 'MacBook Pro' | 'Desktop PC' | 'OpenClaw Gateway Node';
export type NodeConnectionState = 'discovered' | 'pairing' | 'authenticated' | 'connected' | 'degraded' | 'revoked' | 'offline';

export interface SocketDevice {
  id: string;
  name: string;
  deviceType: DeviceType;
  ip: string;
  status: 'connected' | 'pairing' | 'disconnected';
  connectionState?: NodeConnectionState;
  pingMs: number;
  lastSyncAt: string;
  identityVerified?: boolean;
  transport?: 'wss' | 'local' | 'relay';
  grantedCapabilities?: string[];
  runtime?: {
    platform: string;
    version: string;
    workspace?: string;
  };
}

export interface PairingSession {
  sessionId: string;
  pin: string;
  expiresAt: string;
  expiresInSeconds: number;
  status: 'PENDING' | 'PAIRING_REQUESTED' | 'CHALLENGE_ISSUED' | 'IDENTITY_VERIFIED' | 'EXPIRED' | 'CONNECTED';
  requestedCapabilities: string[];
}

export interface DebuggerSession {
  isRunning: boolean;
  currentLine: number;
  currentFile: string;
  callStack: { frame: string; file: string; line: number }[];
  variables: { name: string; value: string; type: string }[];
  breakpoints: { file: string; line: number; enabled: boolean }[];
  memoryAllocatedMb: number;
}

export interface AgenticSkill {
  id: string;
  name: string;
  description: string;
  category: 'Android Native' | 'Code AST' | 'Voice Agent' | 'Debug Engine' | 'Multi-Device Sync' | 'Custom Plugin' | 'API Integration';
  isEnabled: boolean;
  triggerKey: string;
  parametersSchema: string;
  executionCount: number;
  pluginCode?: string;
  manifestJson?: string;
  author?: string;
  version?: string;
  createdAt?: string;
}

export interface ApiVaultItem {
  id: string;
  serviceName: string;
  category: 'api_key' | 'password' | 'oauth_token' | 'ssh_key' | 'webhook_secret';
  keyOrPassword: string;
  notes?: string;
  updatedAt: string;
  isEncrypted: boolean;
}

export type AutonomyLevel = 'FULL_AUTONOMOUS' | 'SEMI_AUTONOMOUS' | 'MANUAL_STRICT';

export interface AgenticExecutionPolicy {
  autonomyLevel: AutonomyLevel;
  autoApproveShellCommands: boolean;
  autoApproveFileWrites: boolean;
  autoApproveSkillCreation: boolean;
  requireApprovalForRoot: boolean;
  notifyOnNtfy: boolean;
}

export interface AgenticApprovalRequest {
  id: string;
  timestamp: string;
  agentName: string;
  actionType: 'SHELL_EXEC' | 'FILE_WRITE' | 'SKILL_SYNTHESIS' | 'PLUGIN_INSTALL' | 'VAULT_ACCESS';
  title: string;
  details: string;
  commandOrPath?: string;
  codeSnippet?: string;
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
}

export interface GitOpsConfig {
  repoUrl: string;
  branch: string;
  authToken: string;
  syncIntervalMinutes: number;
  autoPushPatches: boolean;
  lastSyncedAt?: string;
  status: 'CONNECTED' | 'SYNCING' | 'ERROR' | 'DISCONNECTED';
  activeRemoteRepo?: string;
}

export interface GitOpsMission {
  id: string;
  title: string;
  description: string;
  filePath: string;
  assignedAgent: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  commitHash?: string;
  outputSummary?: string;
}

export interface CloudflareGatewayConfig {
  workerUrl: string;
  tunnelHostname: string;
  webhookSecret: string;
  enableIncomingWebhooks: boolean;
  status: 'ONLINE' | 'STANDBY' | 'OFFLINE';
  totalRequestsReceived: number;
  lastWebhookTimestamp?: string;
}

export interface MarketplaceSkillItem {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: 'LLM & Ollama' | 'Code & AST' | 'Hardware & NPU' | 'Git & Cloudflare' | 'Security & Audit' | 'API & Integration';
  priceCredits: number;
  author: string;
  version: string;
  rating: number;
  downloadsCount: number;
  modelfileContent?: string;
  parametersSchema: string;
  pluginCode: string;
  requirements: string[];
  status: 'AVAILABLE' | 'INSTALLING' | 'DEPLOYED';
  deployedAt?: string;
  iconName?: string;
  peerNodeId?: string;
  reputationScore?: number;
  tradingVolume?: number;
  verifiedPeer?: boolean;
  licenseType?: 'A2A Royalty-Free' | 'P2P Per-Call License' | 'Open-Source P2P';
}

export interface WebSocketEventPayload {
  eventId: string;
  timestamp: string;
  type: 'TOKEN_STREAM' | 'AST_PATCH' | 'SOCKET_HANDSHAKE' | 'NPU_TELEMETRY' | 'VOICE_TRIGGER';
  data: any;
}

export interface OllamaServerConfig {
  hostUrl: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  version: string;
  latencyMs: number;
  activeModel: string;
}

export interface OpenClawToolConfig {
  enabled: boolean;
  serverUrl: string;
  mode: 'local-ollama' | 'open-claw-agent';
  targetModel: string;
  maxDepth: number;
  activeExecutions: number;
}

export interface OpenClawA2AAccount {
  id: string;
  nodeId: string;
  network: string;
  agentName: string;
  handle: string;
  email: string;
  role: string;
  publicKey: string;
  a2aToken: string;
  capabilities: string[];
  status: 'registered' | 'active' | 'synced' | 'pending';
  registeredAt: string;
  verifiedPeer: boolean;
  reputationScore: number;
}

export interface A2AAuthEnvState {
  nodeUuid: string;
  a2aBearerToken: string;
  openclawSecretHash: string;
  environmentInjected: boolean;
  injectedAt: string;
  network: string;
  activeHandshakeStatus: string;
}

export interface OpenClawTask {
  id: string;
  timestamp: string;
  query: string;
  url?: string;
  status: 'pending' | 'crawling' | 'processing' | 'completed' | 'failed';
  crawledPagesCount: number;
  extractedMarkdown?: string;
  aiSummary?: string;
  assignedModel: string;
}

// Aura Emergent Agent & Mission Gate Types
export interface AuraMemoryItem {
  id: string;
  timestamp: string;
  category: 'system' | 'user_preference' | 'mission_result' | 'termux_error' | 'learned_skill' | 'code_ast' | 'revenue';
  content: string;
  importance: 'high' | 'medium' | 'low';
  source: string;
  agentId?: string;
}

export type SubAgentType = 'computer' | 'vscode' | 'openclaw' | 'nova' | 'marketplace' | 'skill-monetizer' | 'settlement';

export interface AuraSubAgent {
  id: string;
  name: string;
  type: SubAgentType;
  status: 'idle' | 'active' | 'busy' | 'offline';
  description: string;
  activeTask?: string;
  lastSyncAt: string;
}

export interface MissionGateTelemetry {
  batteryPercent: number;
  isCharging: boolean;
  thermalTempC: number;
  cpuUsagePercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  termuxLightLux?: number;
  termuxPowerStatus?: string;
  gateStatus: 'PASSED' | 'THROTTLED' | 'DELEGATED' | 'BLOCKED';
  gateMessage: string;
  evaluatedAt: string;
}

export interface AuraStrategicGoalMilestone {
  id: string;
  title: string;
  assignedAgent: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  proofOfExecution?: string;
  completedAt?: string;
}

export interface AuraStrategicGoal {
  id: string;
  title: string;
  description: string;
  category: 'A2A_MARKETPLACE' | 'SYSTEM_HARDENING' | 'AUTONOMOUS_ORCHESTRATION' | 'CODE_REFACTOR' | 'ON_DEVICE_NPU';
  priorityScore: number;
  progressPercent: number;
  status: 'planning' | 'active' | 'evaluating' | 'completed' | 'paused';
  realityTag: '[REAL]' | '[PROTOTYPE]' | '[SPEC]';
  targetAgent: string;
  milestones: AuraStrategicGoalMilestone[];
  createdAt: string;
  updatedAt: string;
  lastPodarLog?: string;
}

export type AuraPersonaMode = 'default' | 'architectural' | 'quick-fix' | 'creative';

export interface AuraAgentState {
  agentName: string;
  version: string;
  status: 'idle' | 'reasoning' | 'executing' | 'healing' | 'delegating';
  activeMission?: string;
  currentPersona?: AuraPersonaMode;
  memory: AuraMemoryItem[];
  subAgents: AuraSubAgent[];
  gate: MissionGateTelemetry;
  totalMissionsExecuted: number;
  emergentCatchesCount: number;
  strategicGoals?: AuraStrategicGoal[];
  isAutonomousLoopActive?: boolean;
  currentPodarPhase?: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT';
}

export interface AuraChatMessage {
  id: string;
  sender: 'user' | 'aura' | 'sub-agent';
  subAgentName?: string;
  text: string;
  timestamp: string;
  imageUrl?: string;
  isCached?: boolean;
  isOfflineRetrieved?: boolean;
  memoryAdded?: AuraMemoryItem[];
  gateCheck?: MissionGateTelemetry;
  subAgentDispatches?: {
    subAgentId: string;
    subAgentName: string;
    task: string;
    status: 'dispatched' | 'completed' | 'failed';
    output?: string;
  }[];
  emergentCatchLogs?: string[];
  codePatch?: {
    filename: string;
    description: string;
    diffSnippet: string;
  };
}

export interface KeepNoteItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface KeepNote {
  id: string;
  title: string;
  textContent?: string;
  listItems?: KeepNoteItem[];
  color?: 'default' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'dark';
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  googleKeepId?: string;
}

export interface GoogleKeepUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface AgentWorkflowStep {
  id: string;
  stepNumber: number;
  name: string;
  action: 'READ_FILE' | 'AST_ANALYSIS' | 'GENERATE_PATCH' | 'RUN_LINTER' | 'TERMINAL_EXEC' | 'SKILL_INVOCATION' | 'DECISION';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input?: string;
  output?: string;
  durationMs?: number;
  timestamp: string;
}

export interface AgentWorkflowItem {
  id: string;
  title: string;
  prompt: string;
  goal: string;
  assignedAgent: string;
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled';
  steps: AgentWorkflowStep[];
  outcomeSummary: string;
  createdPatchIds?: string[];
  learnedSkillIds?: string[];
  tags: string[];
  timestamp: string;
  executionDurationMs?: number;
  modelUsed?: string;
}

export type MemoryStoreName = 'workflows' | 'patches' | 'skills' | 'memories';

export interface ContextQueryResult {
  query: string;
  totalMatches: number;
  relevanceScore: number;
  relevantWorkflows: (AgentWorkflowItem & { matchScore: number })[];
  relevantPatches: (PatchHistoryItem & { matchScore: number })[];
  relevantSkills: (AgenticSkill & { matchScore: number })[];
  relevantMemories: (AuraMemoryItem & { matchScore: number })[];
  contextSnippet: string;
}

export interface MemoryStoreStats {
  dbName: string;
  version: number;
  workflowsCount: number;
  patchesCount: number;
  skillsCount: number;
  memoriesCount: number;
  totalItemsCount: number;
  isAvailable: boolean;
  lastIndexedAt?: string;
  estimatedSizeKb?: number;
}

export interface IMemoryStore {
  init(): Promise<boolean>;
  indexWorkflow(workflow: AgentWorkflowItem): Promise<void>;
  indexPatch(patch: PatchHistoryItem): Promise<void>;
  indexSkill(skill: AgenticSkill): Promise<void>;
  indexMemoryItem(item: AuraMemoryItem): Promise<void>;
  queryContext(query: string, limit?: number): Promise<ContextQueryResult>;
  getWorkflows(filter?: { status?: string; tag?: string }): Promise<AgentWorkflowItem[]>;
  getPatches(filter?: { targetFile?: string; status?: string }): Promise<PatchHistoryItem[]>;
  getSkills(category?: string): Promise<AgenticSkill[]>;
  getAllMemories(category?: string): Promise<AuraMemoryItem[]>;
  deleteItem(storeName: MemoryStoreName, id: string): Promise<void>;
  clearAll(): Promise<void>;
  getStats(): Promise<MemoryStoreStats>;
  exportDump(): Promise<string>;
  importDump(jsonDump: string): Promise<boolean>;
}


