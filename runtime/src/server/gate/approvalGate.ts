import { evaluateFilePath, evaluateCommand, PolicyCheckResult } from './policyRules.js';
import { enqueue } from '../queue/jobQueue.js';
import { JobRecord, JobType } from '../queue/jobTypes.js';
import { resolveWorkspaceFile } from '../security/workspaceBoundary.js';
import { IntuitionContractStore } from '../autonomy/intuitionContractStore.js';

/**
 * Approval gate.
 *
 * `POST /api/jobs/gate/submit` passes the request body straight into this
 * function, so everything below is reachable by whoever can reach that route.
 * The RC2 build had reduced this to a regex check on `targetPath` — no job-type
 * allowlist, no payload typing, no workspace boundary resolution and no contract
 * binding. A proposal could name any type, carry any payload, and reference a
 * path that only had to avoid a handful of filename patterns.
 *
 * This restores the checks and keeps RC2's wider job-type union intact:
 *  - only implemented job types are accepted;
 *  - every path is resolved against the configured workspace root, which rejects
 *    traversal, symlink escape and secret-bearing files;
 *  - raw command strings are refused by the typed gate;
 *  - bounded workspace-local mutations execute under mission authority;
 *  - destructive/system/external consequences keep explicit operator gates.
 */

export interface GateActionProposal {
  type: JobType;
  description: string;
  targetPath?: string;
  command?: string;
  payload: any;
  priority?: number;
}

export interface GateEvaluationResponse {
  allowed: boolean;
  requiresApproval: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reason?: string;
  job?: JobRecord;
}

/**
 * The root the gate enforces against. `process.cwd()` is not that root whenever
 * JACO_WORKSPACE_ROOT or JACO_RELEASE_ROOT is set — the Termux and packaged
 * install layouts both set one — which would let the gate validate a proposal
 * against a different tree than the workers actually write to.
 */
function gateWorkspaceRoot(): string {
  return process.env.JACO_WORKSPACE_ROOT || process.env.JACO_RELEASE_ROOT || process.cwd();
}

export function submitToGate(proposal: GateActionProposal): GateEvaluationResponse {
  if (!proposal || typeof proposal !== 'object') throw new Error('action proposal is required');
  const workspaceRoot = gateWorkspaceRoot();

  const supported = new Set<JobType>([
    'code_refactor', 'quality_audit', 'git_ops', 'npu_inference', 'model_benchmark', 'system_patch',
  ]);
  if (!supported.has(proposal.type)) {
    return { allowed: false, requiresApproval: false, riskLevel: 'CRITICAL', reason: `Job type '${proposal.type}' has no verified worker implementation.` };
  }
  if (!proposal.payload || typeof proposal.payload !== 'object' || Array.isArray(proposal.payload)) {
    return { allowed: false, requiresApproval: false, riskLevel: 'HIGH', reason: 'A typed payload is required.' };
  }
  if (proposal.command) {
    const commandPolicy = evaluateCommand(proposal.command);
    if (!commandPolicy.allowed) return { ...commandPolicy };
    return { allowed: false, requiresApproval: false, riskLevel: 'HIGH', reason: 'Raw command strings are not accepted by the typed job gate.' };
  }

  let policyResult: PolicyCheckResult = { allowed: true, requiresApproval: false, riskLevel: 'LOW' };

  try {
    const contractId = typeof proposal.payload.contractId === 'string' ? proposal.payload.contractId : undefined;
    const contracts = new IntuitionContractStore(workspaceRoot);
    if (contractId && !contracts.isActive(contractId)) {
      return { allowed: false, requiresApproval: false, riskLevel: 'HIGH', reason: `Intuition contract '${contractId}' is missing, unsigned, inactive or fulfilled.` };
    }

    if (proposal.type === 'code_refactor') {
      if (typeof proposal.payload.filePath !== 'string' || typeof proposal.payload.newContent !== 'string') {
        return { allowed: false, requiresApproval: false, riskLevel: 'HIGH', reason: 'code_refactor requires filePath and explicit newContent.' };
      }
      const target = resolveWorkspaceFile(workspaceRoot, proposal.payload.filePath, { allowMissing: true });
      if (proposal.targetPath && proposal.targetPath !== proposal.payload.filePath) {
        return { allowed: false, requiresApproval: false, riskLevel: 'HIGH', reason: 'targetPath does not match payload.filePath.' };
      }
      policyResult = evaluateFilePath(target.relativePath, 'write');
    } else if (proposal.type === 'quality_audit') {
      if (proposal.payload.targetDir) resolveWorkspaceFile(workspaceRoot, proposal.payload.targetDir, { allowDirectory: true });
    } else if (proposal.type === 'git_ops') {
      const action = proposal.payload.action;
      if (!['status', 'diff', 'branch', 'commit'].includes(action)) {
        return { allowed: false, requiresApproval: false, riskLevel: 'HIGH', reason: 'Unsupported Git action. Push/reset/force operations are not exposed.' };
      }
      const filePaths = Array.isArray(proposal.payload.filePaths) ? proposal.payload.filePaths : [];
      for (const filePath of filePaths) resolveWorkspaceFile(workspaceRoot, filePath);
      policyResult = { allowed: true, requiresApproval: false, riskLevel: action === 'commit' || action === 'branch' ? 'MEDIUM' : 'LOW',
        reason: action === 'commit' || action === 'branch' ? `Local ${action} is covered by bounded mission authority.` : undefined };
    } else if (proposal.type === 'npu_inference') {
      const prompt = String(proposal.payload.prompt || '');
      if (!prompt || prompt.length > 100_000) return { allowed: false, requiresApproval: false, riskLevel: 'HIGH', reason: 'NPU prompt is missing or too large.' };
    } else if (proposal.type === 'model_benchmark') {
      // Reads a model and reports timings; it mutates nothing in the workspace.
      policyResult = { allowed: true, requiresApproval: false, riskLevel: 'LOW' };
    } else if (proposal.type === 'system_patch') {
      // A patch changes the running system by definition, so it never proceeds
      // on a contract alone — an operator sees this one every time.
      if (proposal.payload.filePath) resolveWorkspaceFile(workspaceRoot, String(proposal.payload.filePath), { allowMissing: true });
      policyResult = { allowed: true, requiresApproval: true, riskLevel: 'HIGH', reason: 'System patches always require explicit operator approval.' };
    }
  } catch (error: any) {
    return { allowed: false, requiresApproval: false, riskLevel: 'CRITICAL', reason: String(error?.message || error) };
  }

  if (!policyResult.allowed) {
    return { allowed: false, requiresApproval: false, riskLevel: policyResult.riskLevel, reason: policyResult.reason };
  }

  const job = enqueue({
    type: proposal.type,
    payload: proposal.payload,
    priority: proposal.priority ?? 50,
    requiresApproval: policyResult.requiresApproval,
    governanceCategory: proposal.type === 'git_ops' ? 'git'
      : proposal.type === 'npu_inference' ? 'npu'
      : proposal.type === 'code_refactor' || proposal.type === 'system_patch' ? 'filesystem'
      : 'security',
    riskLevel: policyResult.riskLevel,
    description: proposal.description,
  });

  return { allowed: true, requiresApproval: policyResult.requiresApproval, riskLevel: policyResult.riskLevel, reason: policyResult.reason, job };
}
