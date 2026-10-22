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
  provider?: 'ollama' | 'lmstudio' | 'huggingface' | 'gemini' | 'deepseek' | 'custom';
}

export type LlmProviderType = 'litert' | 'ollama' | 'lmstudio' | 'huggingface' | 'gemini' | 'deepseek' | 'custom';

export interface ProviderConfig {
  type: LlmProviderType;
  name: string;
  hostUrl: string;
  apiKey?: string;
  isConnected: boolean;
  latencyMs?: number;
  discoveredModels: DiscoveredProviderModel[];
}

export interface DiscoveredProviderModel {
  id: string;
  name: string;
  provider: LlmProviderType;
  sizeMb?: number;
  quantization?: string;
  modifiedAt?: string;
}

export interface SystemModuleRoute {
  moduleId: 'auraChat' | 'codeRefactor' | 'taskDaemon' | 'memoryIndexer' | 'a2aBroker';
  moduleName: string;
  description: string;
  iconName: string;
  assignedModelId: string;
  providerType: LlmProviderType;
  customSystemPrompt?: string;
}

export type EvidenceClass = 
  | 'MEASURED'      // Verifierad fysisk/kernel-mätning via sysfs/proc/perf/API
  | 'DERIVED'       // Deterministiskt matematiskt härledd från verifierade basmätningar
  | 'ESTIMATED'     // Statistisk inferens eller Bayesian prior
  | 'SIMULATED'     // Mockad eller simulerad i UI/testläge
  | 'UNAVAILABLE';  // Ingen tillgänglig sensor/mätare (aldrig fallback till gissningar)

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
  cpuUsagePercent?: number;
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
  truth?: EvidenceClass;
  hardwareTruth?: {
    cpu?: EvidenceClass;
    ram?: EvidenceClass;
    npu?: EvidenceClass;
    battery?: EvidenceClass;
    thermal?: EvidenceClass;
  };
  monotonicTimestampNs?: string;
  observedAt?: string;
}

export type IntentCategory = 
  | 'CODE_GEN'
  | 'DEBUG'
  | 'REFACTOR'
  | 'TERMINAL'
  | 'MODEL_PULL'
  | 'AURA_WORKFLOW'
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
  riskLevel?: 'low' | 'medium' | 'high';
  isLowRisk?: boolean;
  autoExecuted?: boolean;
}

export interface WorkflowCacheEntry {
  hash: string;
  workflowTitle: string;
  inputParams: {
    intentCategory?: string;
    targetFile?: string;
    summary?: string;
    actionItems?: string[];
    stepsCount: number;
    stepTypes: string[];
    stepTitles: string[];
    rawSignature?: string;
  };
  cachedResult: {
    steps: AgenticStep[];
    executedAt: string;
    executionDurationMs: number;
    outputSummary?: string;
    patchApplied?: string;
    logs: string[];
  };
  hits: number;
  npuSavedPercentage: number;
  savedComputeTimeMs: number;
  createdAt: string;
  lastAccessedAt: string;
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

export interface LogEvidencePayload {
  category: 'FILE_DIFF' | 'PROCESS_EXIT' | 'API_RESPONSE' | 'STATE_HASH';
  targetPath?: string;
  beforeHash?: string;
  afterHash?: string;
  diffSummary?: string;
  exitCode?: number;
  durationMs?: number;
  pid?: number;
  httpStatus?: number;
  responseDigest?: string;
  verifiedAt: string;
}

export interface TerminalLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'command' | 'ollama' | 'aura';
  message: string;
  source?: string;
  evidence?: LogEvidencePayload;
  verificationHash?: string;
}

export interface EvidenceChainItem {
  id: string;
  timestamp: string;
  podarPhase: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT';
  reasoningIntent: string;
  confidenceScore: number;
  toolCall: {
    name: string;
    parameters: string;
    mandateVerified: boolean;
  };
  outputType: 'FILE_DIFF' | 'TERMINAL_LOG' | 'VERIFIED_PROOF' | 'API_RESPONSE';
  outputTitle: string;
  targetPath?: string;
  diffContent?: string;
  terminalLogOutput?: string[];
  verificationHash: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED' | 'VERIFIED';
  agentName: string;
  linesAdded?: number;
  linesRemoved?: number;
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
  paymentLinkUrl?: string;
  priceSek?: number;
}

export interface AutonomousMonetizationPlan {
  id: string;
  title: string;
  category: 'Code & AST' | 'AI & LLM' | 'Security & Hardening' | 'API & Integration' | 'Hardware & NPU';
  targetAudience: string;
  estimatedPriceSek: number;
  qualityAssuranceRules: string[];
  status: 'RESEARCHING' | 'DEVELOPING' | 'QUALITY_CHECK' | 'PUBLISHED' | 'BLOCKED';
  assignedAgent: string;
  plannedSolution: string;
  createdAt: string;
  proofOfExecution?: string;
}

export interface SystemBottleneckLimitation {
  id: string;
  title: string;
  category: 'API_KEYS' | 'LATENCY_NPU' | 'TYPE_SAFETY' | 'RATE_LIMIT' | 'HARDWARE' | 'SECURITY';
  impactLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  description: string;
  resolutionPlan: string;
  responsibleAgent: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  updatedAt: string;
  alternativePaths?: string[];
  synthesizedTool?: string;
  fallbackExecutionStatus?: 'NOT_STARTED' | 'TOOL_SYNTHESIZED' | 'FALLBACK_ACTIVE' | 'RESOLVED';
  requiresHumanHelp?: boolean;
  humanHelpReason?: string;
}

export interface AgentPriorityNotification {
  id: string;
  timestamp: string;
  agentName: string;
  priority: 'URGENT_HUMAN_HELP' | 'CRITICAL_BOTTLENECK' | 'APPROVAL_REQUIRED' | 'STRATEGY_ALERT';
  title: string;
  message: string;
  actionRequired?: string;
  status: 'UNREAD' | 'READ' | 'ACTIONED' | 'DISMISSED';
  bottleneckId?: string;
  mobilePushed?: boolean;
}

export interface CodeOptimizationLogItem {
  id: string;
  timestamp: string;
  targetFile: string;
  subAgentName: string;
  description: string;
  performanceGain: string;
  verificationStatus: 'PASSED' | 'PENDING' | 'VERIFIED_CLEAN';
  seniorGoalId?: string;
  astErrorsFixed?: number;
}

export interface SeniorDevDebuggerGoal {
  id: string;
  title: string;
  description: string;
  assignedSubAgent: string;
  targetStackModule: 'Frontend (React/Vite)' | 'Backend (Node/Express)' | 'TypeScript AST & Types' | 'Memory & Database' | 'NPU & Telemetry';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  status: 'AUDITING' | 'IN_REFACTOR' | 'VERIFIED_CLEAN' | 'PAUSED';
  createdAt: string;
  updatedAt: string;
  inspectionDetails: string;
  assignedTasks: string[];
  proofOfExecution?: string;
}

export interface CloudflareWorkerPackage {
  id: string;
  workerName: string;
  customWorkerUrl: string;
  status: 'BUILDING' | 'DEPLOYED' | 'SYNCED' | 'PAUSED';
  boundSkills: string[];
  workerScriptSnippet: string;
  totalCallsReceived: number;
  lastDeployedAt: string;
  routes: string[];
  kvBindings?: string[];
  promotedSkillName?: string;
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
  category: 'system' | 'user_preference' | 'mission_result' | 'termux_error' | 'learned_skill' | 'code_ast' | 'revenue' | 'competitive_intelligence' | 'market_watch';
  content: string;
  importance: 'high' | 'medium' | 'low';
  source: string;
  agentId?: string;
}

export interface CompetitiveIntelligenceMemoryItem {
  id: string;
  timestamp: string;
  competitorName: string;
  featureDomain: 'SUBGOAL_DECOMPOSITION' | 'COMPRESSED_MEMORY_RAG' | 'A2A_PROTOCOL' | 'AUTONOMOUS_DAEMON' | 'AST_PATCHING' | 'EDGE_NPU' | 'TEST_GATES';
  observedUpdate: string;
  architecturalBreakdown: string;
  compressedDigest: string;
  tacticalCounterStrategy: string;
  impactOnUpcomingPlans: string;
  confidenceScore: number;
  sourceUrls: string[];
  proofHash: string;
  rawOpenClawTaskId?: string;
  status: 'active' | 'archived' | 'injected';
}

export interface TrackedCompetitorTarget {
  id: string;
  name: string;
  ecosystem: string;
  targetUrls: string[];
  focusAreas: string[];
  lastScannedAt: string | null;
  status: 'active' | 'idle' | 'scanning';
  discoveredSignalsCount: number;
}

export interface MarketWatchServiceState {
  isRunning: boolean;
  pollingIntervalSeconds: number;
  lastScanTimestamp: string | null;
  nextScheduledScan: string | null;
  totalScansCompleted: number;
  totalIntelligenceGathered: number;
  autoInjectIntoReasoning: boolean;
  trackedTargets: TrackedCompetitorTarget[];
  recentIntelligence: CompetitiveIntelligenceMemoryItem[];
}

export type SubAgentType = 'computer' | 'vscode' | 'openclaw' | 'nova' | 'marketplace' | 'skill-monetizer' | 'settlement' | 'senior-dev' | 'fe-refactor' | 'be-optimizer' | 'cloudflare-promoter';

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
  missionType?: 'MEMORY_ACCESSED' | 'NEW_MISSION';
  ragMatchesCount?: number;
  ragContextSnippet?: string;
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

export interface VectorItem {
  id: string;
  entityType: 'workflow' | 'patch' | 'skill' | 'memory' | 'user_preference' | 'mission';
  entityId: string;
  text: string;
  embedding: number[];
  metadata: Record<string, any>;
  createdAt: string;
}

export interface VectorSearchResult {
  item: VectorItem;
  cosineSimilarity: number;
  percentageScore: number;
}

export type MemoryStoreName = 'workflows' | 'patches' | 'skills' | 'memories' | 'vectors';

export interface ContextQueryResult {
  query: string;
  totalMatches: number;
  relevanceScore: number;
  relevantWorkflows: (AgentWorkflowItem & { matchScore: number })[];
  relevantPatches: (PatchHistoryItem & { matchScore: number })[];
  relevantSkills: (AgenticSkill & { matchScore: number })[];
  relevantMemories: (AuraMemoryItem & { matchScore: number })[];
  vectorSearchResults?: VectorSearchResult[];
  ragContextSnippet?: string;
  contextSnippet: string;
}

export type AuditLogCategory = 
  | 'Autonomous Action'
  | 'Security & Safety'
  | 'Code & AST'
  | 'Agent Workflow'
  | 'API & Integration'
  | 'System Telemetry';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  category: AuditLogCategory;
  action: string;
  details: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED' | 'BLOCKED' | 'PENDING';
  actor: string;
  isAutonomous: boolean;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidenceChecksum?: string;
  maskedKeysCount?: number;
  metadata?: Record<string, any>;
}

export interface MemoryStoreStats {
  dbName: string;
  version: number;
  workflowsCount: number;
  patchesCount: number;
  skillsCount: number;
  memoriesCount: number;
  vectorsCount?: number;
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
  indexVector(item: Omit<VectorItem, 'embedding'> & { embedding?: number[] }): Promise<VectorItem>;
  queryVectorDB(query: string, limit?: number, minSimilarity?: number, entityType?: string): Promise<VectorSearchResult[]>;
  generateVectorEmbedding(text: string): number[];
  queryContext(query: string, limit?: number): Promise<ContextQueryResult>;
  queryRAG(query: string, limit?: number): Promise<{ ragContextSnippet: string; topMatches: VectorSearchResult[] }>;
  getWorkflows(filter?: { status?: string; tag?: string }): Promise<AgentWorkflowItem[]>;
  getPatches(filter?: { targetFile?: string; status?: string }): Promise<PatchHistoryItem[]>;
  getSkills(category?: string): Promise<AgenticSkill[]>;
  getAllMemories(category?: string): Promise<AuraMemoryItem[]>;
  getAllVectors(): Promise<VectorItem[]>;
  deleteItem(storeName: MemoryStoreName, id: string): Promise<void>;
  clearAll(): Promise<void>;
  getStats(): Promise<MemoryStoreStats>;
  exportDump(): Promise<string>;
  importDump(jsonDump: string): Promise<boolean>;
  reindexVectorDatabase(): Promise<{ indexedCount: number }>;
}

export type IntuitionContractStatus = 'DRAFT' | 'CLARIFYING' | 'ACTIVE' | 'ADAPTING' | 'VERIFYING' | 'FULFILLED' | 'CANCELLED';


export interface ContractSubGoal {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'adapted_out' | 'replaced';
  reasoning: string; // Aura's rationale for creating or adapting this subgoal
  createdAt: string;
  updatedAt: string;
}

export interface ContractEvaluationLog {
  id: string;
  timestamp: string;
  isFulfilledAccordingToSchema: boolean;
  evaluationOpinion: string; // Aura's explicit opinion on progress toward the intuition goal
  rationaleForTaskSelection: string; // Aura's explanation of why tasks/skills/tools were chosen
  adaptedGoalsCount: number;
  newSkillsBuilt: string[];
  newToolsGenerated: string[];
  evidenceFound?: string;
}

export interface IntuitionContract {
  id: string;
  humanIntuitionGoal: string; // Mänsklig intuition & slutmål
  clarifyingQuestionsAsked?: string[];
  operatorAnswers?: Record<string, string>;
  fixedRules: string[]; // Fasta regler & guardrails (t.ex. budget, termiska gränser, teknikstack)
  status: IntuitionContractStatus;
  progressPercent: number; // calculated from verified goal progress, NOT premature 100%
  isFulfilled: boolean; // Contract stays false until human intuition slutmål is proven
  subGoals: ContractSubGoal[];
  dynamicallyCreatedSkills: { name: string; category: string; createdAt: string }[];
  generatedTools: { toolId: string; title: string; targetFile?: string; createdAt: string }[];
  evaluationHistory: ContractEvaluationLog[];
  schemaReminderCron: string; // e.g. "Every 30s PODAR Schema Check"
  signedByOperator: boolean;
  signedAt?: string;
  createdAt: string;
  lastEvaluatedAt: string;
  fulfillmentProof?: string;
}

export interface AttributedTaskItem {
  taskId: string;
  taskTitle: string;
  workerName: string;
  workerUrl: string;
  invocationsCount: number;
  earnedUsd: number;
  completedAt: string;
  status: 'COMPLETED' | 'VERIFIED' | 'SETTLED';
  proofSignature?: string;
}

export interface AgentRevenueAttribution {
  agentId: string;
  agentName: string;
  subAgentType: string;
  associatedWorkerName: string;
  workerEndpointUrl: string;
  totalWorkerInvocations: number;
  successfulTasksCompleted: number;
  totalEarningsUsd: number;
  avgEarningsPerInvocationUsd: number;
  payoutStatus: 'ACTIVE_ACCUMULATING' | 'SETTLED_USDC' | 'READY_FOR_PAYOUT';
  completedTasks: AttributedTaskItem[];
}

export interface MistakeLessonItem {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  failedAction: string;
  rootCause: string;
  pivotedStrategy: string;
  recoveryResolution: string;
  avoidanceRule: string;
  verificationPassed: boolean;
}

export interface AgentEvolutionRecord {
  agentId: string;
  agentName: string;
  role: string;
  generation: number;
  totalMissions: number;
  successfulMissions: number;
  failedMissions: number;
  mistakesLearned: number;
  skillsSynthesized: number;
  proficiencyScore: number; // 0-100%
  currentSpecialization: string;
  evolutionaryNotes: string[];
  lastEvolvedAt: string;
}

export interface StrategyPivotStep {
  stepIndex: number;
  phase: 'DIAGNOSE_ROOT_CAUSE' | 'FORMULATE_ALTERNATIVE' | 'SELF_DEBUG_PATCH' | 'VERIFY_AND_BENCHMARK' | 'RECORD_LESSON';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  durationMs?: number;
}

export interface StrategyPivotPlan {
  id: string;
  originalGoal: string;
  detectedFailure: string;
  rootCauseCategory: 'AST_SYNTAX_ERROR' | 'PORT_CONFLICT' | 'DEPENDENCY_MISSING' | 'TIMEOUT_DEADLOCK' | 'HARDWARE_OOM' | 'UNKNOWN';
  pivotedApproachTitle: string;
  steps: StrategyPivotStep[];
  status: 'ACTIVE' | 'RESOLVED' | 'ESCALATED_TO_HUMAN';
  createdAt: string;
  resolvedAt?: string;
  evolutionLessonSaved: boolean;
}

export interface AndroidAiCoreBridgeState {
  isAiCoreAvailable: boolean;
  modelVariant: 'Gemma 4 2B (LiteRT NPU)' | 'Gemma 4 7B (On-Device Tensor)' | 'Gemma 4 9B E2B' | 'Unavailable';
  activeHardwareEngine: 'LiteRT NPU (Hexagon/Tensor Core)' | 'Local Computer Bridge (Ollama/LM Studio)' | 'CPU Emulated Fallback';
  isLocalComputerConnected: boolean;
  computerHostUrl: string;
  npuTemperatureC: number;
  npuTokensPerSec: number;
  isSandboxed: boolean;
  lastHeartbeat: string;
}

export interface SubAgentSupervisionMatrix {
  agents: AgentEvolutionRecord[];
  activePivotPlans: StrategyPivotPlan[];
  recentMistakeLessons: MistakeLessonItem[];
  androidAiCoreBridge: AndroidAiCoreBridgeState;
  watchdogStatus: {
    isHealthy: boolean;
    uptimeSeconds: number;
    activeProcessesCount: number;
    autoHealedIncidentsCount: number;
    lastHealthCheck: string;
  };
}

// ==============================================================================
// Portable Control Plane & Payment Provider Abstraction Contract
// ==============================================================================

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface PaymentCheckoutResult {
  checkoutId: string;
  checkoutUrl: string;
  provider: 'stripe' | 'lemonsqueezy' | 'skyfire' | 'offline_ledger' | 'custom';
  status: 'pending' | 'created';
}

export interface PaymentVerifiedEvent {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.created';
  amount: number;
  currency: string;
  customerEmail?: string;
  transactionId: string;
  rawPayloadHash: string;
  timestamp: string;
  /** True only when a payment provider's signature was verified; unverified events are never booked as revenue. */
  verified: boolean;
}

export interface PaymentRefundResult {
  refundId: string;
  paymentId: string;
  amount: number;
  status: 'succeeded' | 'pending' | 'failed';
}

export interface PaymentProvider {
  providerName: string;
  createCheckout(order: PaymentOrder): Promise<PaymentCheckoutResult>;
  verifyWebhook(rawBody: Buffer | string, signature: string, secret?: string): Promise<PaymentVerifiedEvent>;
  refund(paymentId: string, amount?: number): Promise<PaymentRefundResult>;
}

export interface PortableControlPlaneManifest {
  version: string;
  domain: string;
  runtimeTarget: 'cloudflare_pages' | 'vercel' | 'render' | 'vps' | 'termux_local';
  gitRepositoryUrl?: string;
  activeLlmAdapters: LlmProviderType[];
  paymentAdapter: 'stripe' | 'lemonsqueezy' | 'skyfire' | 'offline_ledger';
  isA2AOpenApiCompliant: boolean;
  isMcpServerActive: boolean;
}

// ==============================================================================
// JACO Venture Runtime 1.0 — Autonomous Business & Capability Evolution Protocol
// ==============================================================================

export interface EvidenceRef {
  id: string;
  sourceType: 'A2A_AGENT_CARD' | 'MCP_TOOL_CATALOG' | 'GITHUB_ISSUE' | 'GITHUB_TREND' | 'HUGGINGFACE_SPACE' | 'AGENT_REQUEST' | 'FAILED_TASK' | 'CUSTOMER_REQUEST' | 'TELEMETRY_LOG';
  uri: string;
  title: string;
  rawExcerpt: string;
  extractedMetric?: number;
  metricLabel?: string;
  confidence: number;
  observedAt: string;
  truthClass: EvidenceClass;
}

export interface MarketSignal {
  id: string;
  source: string;
  sourceType: EvidenceRef['sourceType'];
  observation: string;
  evidence: EvidenceRef[];
  demandScore: number;       // 0 - 1.0 (Provenance-backed)
  growthScore: number;       // 0 - 1.0
  urgencyScore: number;      // 0 - 1.0
  competitionScore: number;  // 0 - 1.0 (Higher = more crowded)
  strategicFit: number;      // 0 - 1.0 (Fit with JACO core & local NPU)
  noveltyScore: number;      // 0 - 1.0 (Distinctiveness from archive)
  observedAt: string;
  status: 'NEW' | 'ANALYZED' | 'DISMISSED' | 'SYNTHESIZED';
}

export interface BusinessHypothesis {
  id: string;
  thesis: string;
  signalIds: string[];
  supportingEvidence: EvidenceRef[];
  contradictions: EvidenceRef[];
  targetAgent: string;
  problem: string;
  proposedCapability: string;
  expectedValue: string;
  falsificationCriteria: string[]; // Strict criteria to invalidate the thesis
  confidence: number;              // 0 - 1.0
  status: 'PROPOSED' | 'TESTING' | 'VALIDATED' | 'FALSIFIED' | 'MUTATED';
  createdAt: string;
  falsificationCheckedAt?: string;
}

export interface OpportunitySpaceCoordinate {
  computeAxis: 'LOCAL' | 'HYBRID' | 'CLOUD';        // Local vs Cloud
  domainAxis: 'DEVELOPER' | 'BUSINESS' | 'GENERAL';  // Developer vs Business
  subDomain: 'SECURITY' | 'AUTOMATION' | 'DATA' | 'DEVICE' | 'RESEARCH';
  executionTarget: 'NPU_LOCAL' | 'CPU_TERMINAL' | 'MCP_SERVER' | 'A2A_DELEGATED';
}

export interface OpportunityScoreBreakdown {
  demand: number;           // 0 - 1.0
  growth: number;           // 0 - 1.0
  urgency: number;          // 0 - 1.0
  competition: number;      // 0 - 1.0
  strategicFit: number;     // 0 - 1.0
  novelty: number;          // 0 - 1.0
  evidenceQuality: number;  // 0 - 1.0
  compositeScore: number;   // Calculated weighted opportunity score
}

export interface OpportunityArchiveItem {
  id: string;
  title: string;
  hypothesisId: string;
  coordinates: OpportunitySpaceCoordinate;
  scores: OpportunityScoreBreakdown;
  lineageId: string;
  parentOpportunityId?: string;
  similarityToNearest: number; // 0 - 1.0 (>0.90 incurs heavy novelty penalty)
  allocationBucket: 'EXPLOIT_70' | 'ADJACENT_20' | 'NOVELTY_EXPLORE_10';
  status: 'QUEUED' | 'BUILDING' | 'SANDBOX_TEST' | 'EVALUATED' | 'PROMOTED' | 'MUTATED' | 'KILLED';
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityLineageNode {
  id: string;
  name: string;
  parentId?: string;
  childrenIds: string[];
  opportunityId: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'FALSIFIED' | 'PROMOTED';
  generation: number;
  mutationSummary?: string;
  keyLearning?: string;
  createdAt: string;
}

export interface VentureProductSpec {
  id: string;
  opportunityId: string;
  name: string;
  version: string;
  description: string;
  agentModulePath: string;
  skillId: string;
  mcpToolDefinitions: any[];
  a2aTaskSchemas: any[];
  testSuitePath: string;
  evalCriteria: {
    functionalTarget: number;
    trajectorySanityTarget: number;
    latencyP95TargetMs: number;
    securityPolicyClean: boolean;
  };
}

export interface ExperimentResult {
  technicalSuccess: number;   // 0 - 1.0 (Unit tests & sandbox)
  reliability: number;        // 0 - 1.0 (Zero crashes across N runs)
  interest: number;           // 0 - 1.0 (Measured inquiries & discovery hits)
  conversion: number;         // 0 - 1.0 (Tasks accepted / paid)
  retentionSignal: number;    // 0 - 1.0 (Repeat invocation rate)
  novelty: number;            // 0 - 1.0
  competition: number;        // 0 - 1.0
  costSek: number;            // Direct computational / token cost
  executionTimeMs: number;    // P95 runtime
  evidenceStrength: number;   // 0 - 1.0 (Grounding quality)
  evalScores: {
    functional: number;
    trajectory: number;
    efficiency: number;
    robustness: number;
    business: number;
    securityPassed: boolean;
  };
  failureClassification?: 'PROTOCOL_ERROR' | 'AUTH_ERROR' | 'SCHEMA_MISMATCH' | 'AGENT_REASONING_FAULT' | 'TOOL_FAILURE' | 'TIMEOUT' | 'BAD_PRODUCT_ASSUMPTION' | 'NO_MARKET_DEMAND' | 'NONE';
  rootCauseAnalysis?: string;
}

export interface AdversarialReviewResult {
  reviewedBy: 'AURA_SKEPTIC_ENGINE' | 'ADVERSARIAL_POLICY_GATE';
  verdict: 'APPROVED_FOR_PROMOTION' | 'REJECTED_UNGROUNDED' | 'CHALLENGE_FALSIFICATION' | 'FLAGGED_CHERRY_PICKING';
  confidenceScore: number;
  critique: string;
  provenanceScore: number;
  falsificationVerified: boolean;
  timestamp: string;
}

export interface A2ABusinessExtension {
  pricingModel: 'per-task' | 'subscription' | 'per-token' | 'free-tier';
  currency: 'USD' | 'SEK' | 'EUR';
  price: {
    amount: number;
    unit?: string;
  };
  sla: {
    p95Ms: number;
    availability: number; // e.g. 0.999
  };
  verification: {
    required: boolean;
    proofFormat?: 'SHA256_AST_DIFF' | 'SANDBOX_TRACE' | 'KMS_SIGNATURE';
  };
  trial: {
    requests: number;
    remainingForCaller?: number;
  };
}

export interface A2A10AgentCard {
  specVersion: '1.0.0';
  id: string;
  name: string;
  description: string;
  version: string;
  provider: {
    organization: string;
    website: string;
    repository: string;
  };
  capabilities: {
    skills: Array<{
      id: string;
      name: string;
      description: string;
      inputSchema: Record<string, any>;
      outputSchema: Record<string, any>;
    }>;
    statefulTasksSupported: boolean;
    streamingSupported: boolean;
    mcpBridgingSupported: boolean;
  };
  security: {
    authMethods: string[];
    sandboxLevel: 'STRICT_LOCAL' | 'TERMUX_SECURE' | 'EPHEMERAL_DOCKER';
  };
  jacoBusiness?: A2ABusinessExtension;
  updatedAt: string;
}

export interface VentureAllocationStrategy {
  exploitPercent: number;        // e.g. 70%
  adjacentExperimentPercent: number; // e.g. 20%
  highRiskNoveltyPercent: number;    // e.g. 10%
  adaptiveAdjustments: Array<{
    trigger: string;
    adjustment: string;
    timestamp: string;
  }>;
}

export interface VentureRuntimeState {
  version: string;
  activeCyclePhase: 'OBSERVE' | 'DISCOVER_SIGNALS' | 'FORM_HYPOTHESES' | 'DIVERSIFY_IDEAS' | 'RANK_OPPORTUNITIES' | 'BUILD_EXPERIMENT' | 'RUN_SANDBOX' | 'DEBUG' | 'EVALUATE' | 'REAL_WORLD_PROBE' | 'MEASURE_RESPONSE' | 'LEARN' | 'DECIDE_OUTCOME';
  totalSignalsIngested: number;
  totalHypothesesFormed: number;
  activeOpportunitiesCount: number;
  promotedCapabilitiesCount: number;
  killedExperimentsCount: number;
  mutatedLineagesCount: number;
  allocationStrategy: VentureAllocationStrategy;
  lastCycleTimestamp: string;
  isRunningAutonomousLoop: boolean;
  cycleIntervalMs: number;
}

