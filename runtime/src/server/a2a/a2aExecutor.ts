import fs from 'fs';
import path from 'path';
import {
  A2ATaskRequest,
  A2ATaskResponse,
  A2AContractValidationResult,
  CircuitBreakerState,
  NeoToNovaRefactorSchema,
  NovaToAuditorVerificationSchema
} from './a2aTypes.js';
import { executeLocalSkill } from './skillStore.js';
import { getLocalNodeIdentity } from './nodeRegistry.js';
import { calculateSha256 } from './skillStore.js';
import { submitToGate } from '../gate/approvalGate.js';

// -------------------------------------------------------------
// CIRCUIT BREAKER IN-MEMORY REGISTRY & QUARANTINE MANAGER
// -------------------------------------------------------------

const circuitBreakers = new Map<string, CircuitBreakerState>();
const MAX_CONSECUTIVE_FAILURES = 3;

function getQuarantineDir(): string {
  const qDir = path.join(process.cwd(), '.jaco', 'quarantine');
  if (!fs.existsSync(qDir)) {
    fs.mkdirSync(qDir, { recursive: true });
  }
  return qDir;
}

export function getCircuitBreakerState(agentPair: string): CircuitBreakerState {
  if (!circuitBreakers.has(agentPair)) {
    circuitBreakers.set(agentPair, {
      agentPair,
      consecutiveFailures: 0,
      maxFailuresAllowed: MAX_CONSECUTIVE_FAILURES,
      status: 'CLOSED'
    });
  }
  return circuitBreakers.get(agentPair)!;
}

export function resetCircuitBreaker(agentPair: string): CircuitBreakerState {
  const cb = getCircuitBreakerState(agentPair);
  cb.status = 'CLOSED';
  cb.consecutiveFailures = 0;
  delete cb.lastFailureReason;
  delete cb.lastTrippedAt;
  delete cb.quarantinedTaskId;
  delete cb.quarantineFilePath;
  circuitBreakers.set(agentPair, cb);
  return cb;
}

export function listAllCircuitBreakers(): CircuitBreakerState[] {
  return Array.from(circuitBreakers.values());
}

// -------------------------------------------------------------
// CONTEXT PRUNING: ZERO-STATE HANDOFF FILTER
// -------------------------------------------------------------

const FORBIDDEN_CONTEXT_KEYS = [
  'chatHistory',
  'conversation',
  'messages',
  'rawPrompt',
  'thoughts',
  'reasoningLogs',
  'scratchpad',
  'llmRawOutput',
  'systemPrompt',
  'fullContext'
];

export function pruneContextToContract(contractId: string, rawPayload: any): any {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return rawPayload;
  }

  // Clone object to avoid mutating caller reference
  const cleaned: Record<string, any> = {};

  for (const [key, value] of Object.entries(rawPayload)) {
    if (!FORBIDDEN_CONTEXT_KEYS.includes(key)) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

// -------------------------------------------------------------
// CONTRACT VALIDATION VIA ZOD SCHEMAS
// -------------------------------------------------------------

export function validateA2AContract(contractId: string, rawPayload: any): A2AContractValidationResult {
  const prunedPayload = pruneContextToContract(contractId, rawPayload);

  switch (contractId) {
    case 'neo_to_nova_refactor_v1': {
      const parsed = NeoToNovaRefactorSchema.safeParse(prunedPayload);
      if (!parsed.success) {
        return {
          valid: false,
          contractId,
          violations: parsed.error.issues.map(
            (iss) => `[${iss.path.join('.') || 'root'}]: ${iss.message}`
          )
        };
      }
      return {
        valid: true,
        contractId,
        violations: [],
        prunedPayload: parsed.data
      };
    }

    case 'nova_to_auditor_verification_v1': {
      const parsed = NovaToAuditorVerificationSchema.safeParse(prunedPayload);
      if (!parsed.success) {
        return {
          valid: false,
          contractId,
          violations: parsed.error.issues.map(
            (iss) => `[${iss.path.join('.') || 'root'}]: ${iss.message}`
          )
        };
      }
      return {
        valid: true,
        contractId,
        violations: [],
        prunedPayload: parsed.data
      };
    }

    default:
      // Unknown contract - fail closed
      return {
        valid: false,
        contractId,
        violations: [`Okänt eller oregistrerat kontrakt-ID: '${contractId}'`]
      };
  }
}

// -------------------------------------------------------------
// DETERMINISTIC PAYLOAD ROUTER & CIRCUIT BREAKER EXECUTION
// -------------------------------------------------------------

export interface RouteA2APayloadOptions {
  sourceAgent: string;
  targetAgent: string;
  contractId: string;
  rawPayload: any;
  taskId?: string;
}

export interface RouteA2APayloadResult {
  success: boolean;
  status: 'DELIVERED' | 'REJECTED_LOCAL_RETRY' | 'TRIPPED_CIRCUIT_BREAKER_QUARANTINED';
  circuitBreaker: CircuitBreakerState;
  violations?: string[];
  validatedPayload?: any;
  quarantineFilePath?: string;
  rejectionMessage?: string;
}

export function routeA2APayloadWithContract(options: {
  sourceAgent: string;
  targetAgent: string;
  contractId: string;
  rawPayload: any;
  taskId?: string;
}): RouteA2APayloadResult {
  const { sourceAgent, targetAgent, contractId, rawPayload } = options;
  const agentPair = `${sourceAgent.toLowerCase()}->${targetAgent.toLowerCase()}`;
  const cb = getCircuitBreakerState(agentPair);
  const taskId = options.taskId || `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 1. Check if Circuit Breaker is already tripped OPEN
  if (cb.status === 'OPEN') {
    return {
      success: false,
      status: 'TRIPPED_CIRCUIT_BREAKER_QUARANTINED',
      circuitBreaker: cb,
      rejectionMessage: `A2A Circuit Breaker är TRIPPAD (OPEN) för nodparet [${agentPair}]. Manuell operatörsgranskning krävs i approvalGate.`
    };
  }

  // 2. Perform Strict Contract Validation with Context Pruning
  const validation = validateA2AContract(contractId, rawPayload);

  if (validation.valid) {
    // SUCCESS: Reset failure count and deliver pure payload
    cb.consecutiveFailures = 0;
    cb.status = 'CLOSED';
    circuitBreakers.set(agentPair, cb);

    return {
      success: true,
      status: 'DELIVERED',
      circuitBreaker: cb,
      validatedPayload: validation.prunedPayload
    };
  }

  // 3. FAILURE HANDLING: Increment consecutive failure counter
  cb.consecutiveFailures += 1;
  cb.lastFailureReason = validation.violations.join('; ');

  if (cb.consecutiveFailures < cb.maxFailuresAllowed) {
    // LOCAL REJECTION: Source agent must retry locally
    circuitBreakers.set(agentPair, cb);
    return {
      success: false,
      status: 'REJECTED_LOCAL_RETRY',
      circuitBreaker: cb,
      violations: validation.violations,
      rejectionMessage: `Kontraktsvalidering misslyckades (${cb.consecutiveFailures}/${cb.maxFailuresAllowed}). Agent [${sourceAgent}] måste åtgärda sin payload lokalt: ${validation.violations.join('; ')}`
    };
  }

  // 4. CIRCUIT BREAKER TRIPS: Consecutive failures reached threshold (3)
  cb.status = 'OPEN';
  cb.lastTrippedAt = new Date().toISOString();
  cb.quarantinedTaskId = taskId;

  // Dump invalid payload to quarantine sandbox on disk
  const qDir = getQuarantineDir();
  const qFileName = `quarantine_${Date.now()}_${agentPair.replace('->', '_to_')}_${contractId}.json`;
  const qFilePath = path.join(qDir, qFileName);

  const quarantineRecord = {
    taskId,
    agentPair,
    sourceAgent,
    targetAgent,
    contractId,
    trippedAt: cb.lastTrippedAt,
    violations: validation.violations,
    rawPayload,
    status: 'AWAITING_HUMAN_OPERATOR_REVIEW'
  };

  fs.writeFileSync(qFilePath, JSON.stringify(quarantineRecord, null, 2), 'utf8');
  cb.quarantineFilePath = qFilePath;
  circuitBreakers.set(agentPair, cb);

  // Escalate to Approval Gate for Human Governance
  submitToGate({
    type: 'quality_audit',
    description: `[A2A CIRCUIT BREAKER TRIPPED] Nodpar [${agentPair}] misslyckades med kontrakt '${contractId}' ${cb.consecutiveFailures} gånger. Karantänfil: ${qFileName}`,
    targetPath: qFilePath,
    payload: quarantineRecord,
    priority: 95
  });

  return {
    success: false,
    status: 'TRIPPED_CIRCUIT_BREAKER_QUARANTINED',
    circuitBreaker: cb,
    violations: validation.violations,
    quarantineFilePath: qFilePath,
    rejectionMessage: `A2A Circuit Breaker TRIPPAD! Misslyckades ${cb.consecutiveFailures} gånger. Payload har satts i karantän i '${qFileName}' och skickats till approvalGate.`
  };
}

// -------------------------------------------------------------
// STANDARD A2A TASK EXECUTION HANDLERS
// -------------------------------------------------------------

export async function handleLocalA2AExecution(request: A2ATaskRequest): Promise<A2ATaskResponse> {
  const localIdent = getLocalNodeIdentity();
  const startTime = Date.now();

  // If a specific contract is specified, enforce it first
  if (request.contractId) {
    const routingResult = routeA2APayloadWithContract({
      sourceAgent: request.requesterNodeId || 'remote_node',
      targetAgent: localIdent.nodeId || 'jaco_master_node',
      contractId: request.contractId,
      rawPayload: request.parameters,
      taskId: request.taskId
    });

    if (!routingResult.success) {
      return {
        taskId: request.taskId,
        responderNodeId: localIdent.nodeId,
        success: false,
        error: routingResult.rejectionMessage,
        executionTimeMs: Date.now() - startTime,
        checksum: ''
      };
    }
    // Update parameters to validated and pruned payload
    request.parameters = routingResult.validatedPayload;
  }

  // 1. Testa om skillen finns installerad lokalt
  const execResult = await executeLocalSkill(request.skillId, request.parameters);
  if (execResult.success) {
    return {
      taskId: request.taskId,
      responderNodeId: localIdent.nodeId,
      success: true,
      result: execResult.result,
      executionTimeMs: execResult.executionTimeMs,
      checksum: execResult.checksum,
    };
  }

  // 2. Om inbyggd kapabilitet
  if (request.skillId === 'code-review-audit') {
    const code = request.parameters?.code || '';
    const issues: string[] = [];
    if (code.includes('eval(')) issues.push('Varning: Osäker eval() detekterades i koden.');
    if (code.includes('autoApprove: true')) issues.push('Varning: autoApprove kringgår säkerhetsgrindar.');
    
    const resultObj = {
      issues,
      score: issues.length === 0 ? 100 : Math.max(20, 100 - issues.length * 40),
      summary: issues.length === 0 ? 'Koden passerade granskningen utan uppenbara defekter.' : 'Defekter påträffade.',
    };

    const str = JSON.stringify(resultObj);
    return {
      taskId: request.taskId,
      responderNodeId: localIdent.nodeId,
      success: true,
      result: resultObj,
      executionTimeMs: Date.now() - startTime,
      checksum: calculateSha256(str),
    };
  }

  return {
    taskId: request.taskId,
    responderNodeId: localIdent.nodeId,
    success: false,
    error: `Ingen kapabilitet med id '${request.skillId}' kunde exekveras.`,
    executionTimeMs: Date.now() - startTime,
    checksum: '',
  };
}

export async function delegateTaskToRemotePeer(
  peerEndpointUrl: string,
  request: A2ATaskRequest
): Promise<A2ATaskResponse> {
  const cleanUrl = peerEndpointUrl.replace(/\/$/, '');
  const targetUrl = `${cleanUrl}/api/a2a/tasks/execute`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Fjärrnod svarade med status HTTP ${res.status}`);
    }

    const data: A2ATaskResponse = await res.json();
    return data;
  } catch (err: any) {
    clearTimeout(timeout);
    return {
      taskId: request.taskId,
      responderNodeId: 'unknown',
      success: false,
      error: err?.message || 'Misslyckades att nå fjärrnod.',
      executionTimeMs: 0,
      checksum: '',
    };
  }
}

