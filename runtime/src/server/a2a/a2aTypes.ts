import { z } from 'zod';

export interface A2ASkillCapability {
  id: string;
  name: string;
  version: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema: Record<string, any>;
  pricePerCallCredits?: number;
  tags: string[];
}

export interface A2AAgentCard {
  protocolVersion: string; // '1.0.0'
  nodeId: string;
  name: string;
  description: string;
  endpointUrl: string;
  publicKey?: string;
  capabilities: A2ASkillCapability[];
  supportedProtocols: ('http-json-rpc' | 'websocket')[];
  status: 'online' | 'busy' | 'offline';
  uptimeSeconds: number;
}

export interface A2APeerNode {
  nodeId: string;
  endpointUrl: string;
  name: string;
  lastSeen: string;
  status: 'online' | 'unreachable';
  capabilities: A2ASkillCapability[];
}

export interface A2ATaskRequest {
  taskId: string;
  requesterNodeId: string;
  skillId: string;
  parameters: Record<string, any>;
  maxCostCredits?: number;
  callbackUrl?: string;
  contractId?: string;
}

export interface A2ATaskResponse {
  taskId: string;
  responderNodeId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTimeMs: number;
  checksum: string; // SHA-256 hash of execution result
}

export interface InstalledSkillPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  authorNodeId: string;
  codePath: string;
  manifestPath: string;
  checksum: string;
  installedAt: string;
  enabled: boolean;
}

// -------------------------------------------------------------
// A2A CONTRACT MESH: DETERMINISTIC PAYLOAD ROUTING & ZOD SCHEMAS
// -------------------------------------------------------------

export const NeoToNovaRefactorSchema = z.object({
  contractVersion: z.literal('1.0.0'),
  transactionId: z.string().min(1, 'transactionId is required'),
  targetFilePath: z.string().min(1, 'targetFilePath is required'),
  targetFunctionOrBlock: z.string().min(1, 'targetFunctionOrBlock is required'),
  sourceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Must be a valid 64-char SHA-256 hex string'),
  rulesToApply: z.array(
    z.object({
      ruleId: z.enum([
        'REMOVE_DEAD_CODE',
        'EXTRACT_METHOD',
        'TYPE_HARDENING',
        'INLINE_STUB_ELIMINATION'
      ]),
      severity: z.enum(['CRITICAL', 'OPTIMIZATION']),
      targetLines: z.tuple([z.number(), z.number()]).optional()
    })
  ).min(1, 'At least one refactor rule is required')
}).strict();

export type NeoToNovaRefactorPayload = z.infer<typeof NeoToNovaRefactorSchema>;

export const NovaToAuditorVerificationSchema = z.object({
  contractVersion: z.literal('1.0.0'),
  transactionId: z.string().min(1, 'transactionId is required'),
  targetFilePath: z.string().min(1, 'targetFilePath is required'),
  patchedChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Must be a valid 64-char SHA-256 hex string'),
  diffSummary: z.string().min(1, 'diffSummary is required'),
  linesChanged: z.number().int().nonnegative(),
  verifiedCleanAst: z.boolean()
}).strict();

export type NovaToAuditorVerificationPayload = z.infer<typeof NovaToAuditorVerificationSchema>;

export interface A2AContractValidationResult {
  valid: boolean;
  contractId: string;
  violations: string[];
  prunedPayload?: any;
}

export type CircuitBreakerStatus = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerState {
  agentPair: string; // e.g. "neo->nova"
  consecutiveFailures: number;
  maxFailuresAllowed: number;
  status: CircuitBreakerStatus;
  lastFailureReason?: string;
  lastTrippedAt?: string;
  quarantinedTaskId?: string;
  quarantineFilePath?: string;
}
