export type LMStudioMode = 'advisor' | 'executor' | 'autonomous';

export type LMStudioPluginStateStatus =
  | 'configured'
  | 'authenticated'
  | 'available'
  | 'enabled'
  | 'connected'
  | 'degraded'
  | 'unavailable';

export interface LMStudioPluginManifest {
  schemaVersion: string;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  runtime: 'server';
  mode: LMStudioMode;
  hostUrl?: string;
  selectedModel?: string;
  capabilities: string[];
  permissions: {
    workspace: string;
    network: string;
    shell: string;
    destructiveActions: string;
    writeOutsideWorkspace: boolean;
  };
}

export interface LMStudioMissionContract {
  missionId: string;
  objective: string;
  workspacePath: string;
  mode: LMStudioMode;
  hostUrl?: string;
  modelId?: string;
  allowedPaths: string[];
  deniedPaths: string[];
  allowedCommands: string[];
  acceptanceCriteria: string[];
  governancePolicies: string[];
  requireApprovalFor: string[];
  timeoutMs: number;
  evidenceRequired: boolean;
  threadId?: string;
  targetFiles?: string[];
  prompt?: string;
  suggestedPatch?: string;
}

export type JacoLMStudioEventType =
  | 'mission.started'
  | 'analysis.progress'
  | 'model.response'
  | 'tool.requested'
  | 'approval.required'
  | 'patch.proposed'
  | 'patch.applied'
  | 'test.started'
  | 'test.completed'
  | 'mission.completed'
  | 'mission.failed'
  | 'mission.cancelled';

export interface JacoLMStudioEvent {
  eventId: string;
  timestamp: string;
  missionId: string;
  threadId?: string;
  type: JacoLMStudioEventType;
  status: 'REAL' | 'BLOCKED' | 'FAILED';
  summary: string;
  evidence?: unknown;
}

export interface LMStudioIntegrationError {
  code: string;
  message: string;
  category:
    | 'configuration'
    | 'network'
    | 'permission'
    | 'policy'
    | 'runtime'
    | 'timeout'
    | 'model';
  retryable: boolean;
  evidence?: unknown;
}

export type EvidenceLevel = 'VERIFIED' | 'REPORTED' | 'INFERRED' | 'BLOCKED' | 'UNKNOWN';

export interface LMStudioAuditLogEntry {
  id: string;
  timestamp: string;
  missionId: string;
  threadId?: string;
  pluginMode: LMStudioMode;
  requestedAction: string;
  policyDecision: 'ALLOW' | 'BLOCK' | 'REQUIRE_APPROVAL';
  approvalStatus?: 'APPROVED' | 'REJECTED' | 'PENDING' | 'NOT_REQUIRED';
  affectedFiles: string[];
  command?: string;
  exitCode?: number | null;
  modelUsed?: string;
  patchHash?: string;
  finalStatus: string;
  evidenceLevel: EvidenceLevel;
  maskedOutput?: string;
}

export interface LMStudioPendingApproval {
  actionId: string;
  missionId: string;
  actionType: string;
  description: string;
  targetFiles: string[];
  command?: string;
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  expectedConsequence: string;
  rollbackPlan: string;
  actionHash: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  approvedAt?: string;
  actionPayload?: any;
}

export interface LMStudioModelInfo {
  id: string;
  object: string;
  owned_by?: string;
  permission?: any[];
}

export interface LMStudioVerificationResult {
  timestamp: string;
  hostUrl: string;
  hostReachable: boolean;
  latencyMs?: number;
  availableModels: LMStudioModelInfo[];
  workspaceValid: boolean;
  workspacePath: string;
  canonicalWorkspacePath: string;
  status: LMStudioPluginStateStatus;
  details: string[];
  evidenceLevel: EvidenceLevel;
}
