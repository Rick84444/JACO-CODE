import path from 'node:path';

export const CODING_CONTRACT_SCHEMA = 'jaco.coding-contract/v1';
export const CODE_TASKS = new Set(['repo-list','repo-read','repo-write','repo-edit','repo-test','repo-service','git-status','git-diff','git-commit','git-push','git-merge']);

const DEFAULT_FORBIDDEN = ['.git/**','**/.git/**','.env','.env.*','**/.env','**/.env.*','node_modules/**','**/node_modules/**','**/*secret*','**/*credential*'];
const DEFAULT_PHASES = ['UNDERSTAND','REPOSITORY_MODEL','HYPOTHESES','PLAN','IMPLEMENT','TEST','FALSIFY','VERIFY','COMMIT','RECEIPT'];
const asInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('CONTRACT_PATH_REQUIRED');
  const raw = value.replaceAll('\\', '/');
  if (raw.includes('\0') || path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) throw new Error('CONTRACT_PATH_ABSOLUTE');
  // Apply portable Windows restrictions before normalization can hide an alias.
  // Colons also address alternate data streams, including on an existing file.
  if (raw !== raw.trim() || /[\x00-\x1f\x7f:<>"|?]/.test(raw)) throw new Error('CONTRACT_PATH_AMBIGUOUS');
  for (const segment of raw.split('/')) {
    if (segment === '.' || segment === '..') continue;
    if (/[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment)) {
      throw new Error('CONTRACT_PATH_AMBIGUOUS');
    }
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('CONTRACT_PATH_TRAVERSAL');
  return normalized;
}

function normalizePatterns(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map(normalizePath))];
}

function patternRegex(pattern, caseInsensitive = false) {
  const p = normalizePath(pattern);
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\u0001/g, '(?:.*/)?');
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : '');
}

export function matchesContractPath(pattern, candidate, caseInsensitive = process.platform === 'win32') {
  const p = normalizePath(pattern);
  const c = normalizePath(candidate);
  if (p.endsWith('/**') && patternRegex(p.slice(0, -3), caseInsensitive).test(c)) return true;
  return patternRegex(p, caseInsensitive).test(c);
}

export function isPathAllowed(contract, candidate) {
  const c = normalizePath(candidate);
  const allowed = contract?.scope?.allowed || [];
  const forbidden = [...DEFAULT_FORBIDDEN, ...(contract?.scope?.forbidden || [])];
  // A protected directory also protects its descendants. Defaults are mandatory
  // even for callers passing raw contracts without normalizeCodingContract.
  const segments = c.split('/');
  const ancestors = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
  if (forbidden.some(pattern => ancestors.some(candidate => matchesContractPath(pattern, candidate, true)))) return false;
  return allowed.some(pattern => matchesContractPath(pattern, c));
}

// Inventory may traverse only ancestors of explicitly allowed paths. Returned
// entries are filtered separately; this never authorizes reading or writing them.
export function canListContractPath(contract, candidate) {
  const c = normalizePath(candidate);
  if (isPathAllowed(contract, c)) return true;
  const forbidden = [...DEFAULT_FORBIDDEN, ...(contract?.scope?.forbidden || [])];
  const ancestors = c.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'));
  if (forbidden.some(p => ancestors.some(a => matchesContractPath(p, a, true)))) return false;
  return (contract?.scope?.allowed || []).some(p => {
    const prefix = normalizePath(p).split('*')[0].replace(/\/$/, '');
    return prefix && (c === '.' || prefix.startsWith(c + '/'));
  });
}

export function normalizeCodingContract(input = {}, fallbackObjective = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CODING_CONTRACT_REQUIRED');
  if (input.schema && input.schema !== CODING_CONTRACT_SCHEMA) throw new Error('CODING_CONTRACT_SCHEMA_UNSUPPORTED');
  const objective = String(input.objective || fallbackObjective || '').trim();
  if (!objective || objective.length > 12000) throw new Error('CODING_CONTRACT_OBJECTIVE_REQUIRED');
  const allowed = normalizePatterns(input.scope?.allowed || []);
  if (!allowed.length) throw new Error('CODING_CONTRACT_SCOPE_REQUIRED');
  const forbidden = normalizePatterns([...(input.scope?.forbidden || []), ...DEFAULT_FORBIDDEN]);
  const acceptance = Array.isArray(input.acceptance) ? input.acceptance.map(v => String(v).trim()).filter(Boolean).slice(0, 50) : [];
  if (!acceptance.length) throw new Error('CODING_CONTRACT_ACCEPTANCE_REQUIRED');
  const commands = Array.isArray(input.verification?.commands)
    ? [...new Set(input.verification.commands.map(v => String(v).trim()).filter(Boolean))].slice(0, 20)
    : [];
  if (input.services !== undefined && !Array.isArray(input.services)) throw new Error('CODING_SERVICES_INVALID');
  const services = (input.services || []).map(s => {
    if (!s || !/^[a-z][a-z0-9-]{0,39}$/.test(s.id)) throw new Error('CODING_SERVICE_ID_INVALID');
    const entry = normalizePath(s.entry);
    if (!/\.(mjs|cjs|js)$/.test(entry) || !isPathAllowed({scope:{allowed,forbidden}}, entry)) throw new Error('CODING_SERVICE_ENTRY_DENIED');
    if (typeof s.healthPath !== 'string' || !/^\/[a-zA-Z0-9/_-]*$/.test(s.healthPath) || typeof s.identity !== 'string' || !s.identity || s.identity.length > 200) throw new Error('CODING_SERVICE_HEALTH_REQUIRED');
    return {id:s.id,entry,healthPath:s.healthPath,identity:s.identity};
  });
  if (services.length > 10 || new Set(services.map(s=>s.id)).size !== services.length) throw new Error('CODING_SERVICES_INVALID');
  const requiredStages = input.verification?.required_stages || [];
  if (!Array.isArray(requiredStages) || requiredStages.some(s=>!['service','api','browser'].includes(s))) throw new Error('CODING_VERIFICATION_STAGE_INVALID');
  return {
    schema: CODING_CONTRACT_SCHEMA,
    objective,
    scope: { allowed, forbidden },
    services,
    acceptance,
    execution: {
      autonomous: input.execution?.autonomous !== false,
      require_human_before_destructive_action: input.execution?.require_human_before_destructive_action === true,
      allow_git_commit: input.execution?.allow_git_commit !== false,
      // Completion needs a commit when the operator asked for one: explicitly, or by explicitly
      // allowing commits. A commit permission that only comes from the default does not require one.
      require_git_commit: input.execution?.require_git_commit ?? input.execution?.allow_git_commit === true,
      allow_git_push: input.execution?.allow_git_push !== false,
      allow_git_merge: input.execution?.allow_git_merge !== false,
    },
    verification: {
      tests_required: input.verification?.tests_required !== false,
      falsifier_required: input.verification?.falsifier_required === true,
      independent_verification: input.verification?.independent_verification === true,
      receipt_required: input.verification?.receipt_required !== false,
      commands,
      required_stages: [...new Set(requiredStages)],
    },
    // Defaults raised 2026-10-02 (operator: longer development runs before asking). Within the budget
    // an autonomous contract continues after failures without approvals (approval-policy.mjs); when it
    // is used up the mission stops for the operator.
    budget: {
      max_steps: asInt(input.budget?.max_steps, 40, 1, 2000),
      max_tool_calls: asInt(input.budget?.max_tool_calls, 120, 1, 5000),
      max_failures: asInt(input.budget?.max_failures, 3, 1, 100),
      max_duration_ms: asInt(input.budget?.max_duration_ms, 2 * 60 * 60_000, 1_000, 7 * 24 * 60 * 60_000),
    },
    phases: [...DEFAULT_PHASES],
  };
}

export function assertCodingBudget(contract, usage = {}) {
  if (!contract) return;
  const b = contract.budget;
  if ((usage.toolCallsUsed || 0) >= b.max_tool_calls) throw new Error('CODING_CONTRACT_TOOL_BUDGET_EXCEEDED');
  if ((usage.stepsUsed || 0) >= b.max_steps) throw new Error('CODING_CONTRACT_STEP_BUDGET_EXCEEDED');
  if ((usage.failures || 0) >= b.max_failures) throw new Error('CODING_CONTRACT_FAILURE_BUDGET_EXCEEDED');
  if (Number.isFinite(usage.startedAt) && Number.isFinite(usage.now) && usage.now - usage.startedAt >= b.max_duration_ms) {
    throw new Error('CODING_CONTRACT_DURATION_EXCEEDED');
  }
}

const receiptTurn = receipt => {
  const match = String(receipt?.actionId || '').match(/:turn:(\d+)$/);
  return match ? Number(match[1]) : -1;
};

export function contractVerificationStatus(contract, receipts = []) {
  if (!contract) return { machineVerified: true, missing: [], acceptanceRequiresOperator: false };
  const verified = receipts.filter(r => r?.ok === true && r?.verified === true);
  const lastWriteTurn = verified.filter(r => r.type === 'repo-write' || r.type === 'repo-edit').reduce((max, r) => Math.max(max, receiptTurn(r)), -1);
  const afterLastWrite = r => receiptTurn(r) < 0 || receiptTurn(r) > lastWriteTurn;
  const hasTest = verified.some(r => r.type === 'repo-test' && r.result?.kind !== 'falsifier' && afterLastWrite(r));
  const hasFalsifier = verified.some(r => r.type === 'repo-test' && r.result?.kind === 'falsifier' && afterLastWrite(r));
  const hasIndependent = verified.some(r => r.result?.independentVerification === true && r.result?.verificationActor && r.result?.implementationActor && r.result.verificationActor !== r.result.implementationActor && afterLastWrite(r));
  const missing = [];
  if (contract.verification.tests_required && !hasTest) missing.push('tests');
  if (contract.verification.falsifier_required && !hasFalsifier) missing.push('falsifier');
  if (contract.verification.independent_verification && !hasIndependent) missing.push('independent_verification');
  if (contract.verification.receipt_required && !verified.length) missing.push('verified_receipt');
  for (const stage of contract.verification.required_stages || []) {
    const found = verified.some(r => afterLastWrite(r) && (
      stage === 'service' ? r.type === 'repo-service' && ['start','status'].includes(r.input?.action) && r.result?.state === 'READY' :
      stage === 'api' ? r.type === 'web-fetch' && r.input?.expect?.status !== undefined && r.result?.status === r.input.expect.status :
      r.type === 'browser-click' && r.input?.expect && (r.result?.verified === true || r.result?.receipt?.verified === true)
    ));
    if (!found) missing.push(stage);
  }
  // A contract that allows commits expects the verified change to be committed: on 2026-09-30 Nova
  // proposed completion with the change left uncommitted. Required only once something was written.
  const hasCommitAfterWrite = verified.some(r => r.type === 'git-commit' && afterLastWrite(r));
  if (contract.execution?.require_git_commit && contract.execution?.allow_git_commit && lastWriteTurn >= 0 && !hasCommitAfterWrite) missing.push('commit');
  return { machineVerified: missing.length === 0, missing, acceptanceRequiresOperator: false };
}

// Projection of the existing durable action graph, never a second execution store.
export function codingExecutionSummary(contract, receipts = [], phase = 'READY') {
  const status=contractVerificationStatus(contract,receipts),last=receipts.at(-1);
  const recovery=last?.outcomeUnknown ? {code:'OUTCOME_UNKNOWN',next:'Inspect the postcondition and reconcile before retrying any mutation'} :
    last?.ok===false ? {code:String(last.error||'TOOL_FAILED').slice(0,160),next:/ENOENT|CODING_PATH/.test(last.error||'')?'List the nearest allowed directory and correct the concrete path':/SERVICE_/.test(last.error||'')?'Inspect the contracted service status and ownership before another start':'Inspect the failing receipt and change the plan before retrying'} : null;
  return {goal:contract?.objective||null,phase,verifiedActions:receipts.filter(r=>r.ok&&r.verified).length,failedActions:receipts.filter(r=>r.ok===false).length,lastVerifiedAction:receipts.findLast(r=>r.ok&&r.verified)?.actionId||null,remaining:status.missing,recovery};
}

export function validateCodingTask(task, contract, receipts = []) {
  if (!CODE_TASKS.has(task?.type)) return task;
  if (!contract) throw new Error('CODING_CONTRACT_REQUIRED');
  const data = { ...(task.data || {}) };
  if (task.type === 'repo-service') {
    if (!['start','status','stop'].includes(data.action) || !contract.services?.some(s=>s.id===data.id)) throw new Error('CODING_SERVICE_NOT_CONTRACTED');
    return {...task,data:{id:data.id,action:data.action}};
  }
  if (['repo-list','repo-read','repo-write','repo-edit'].includes(task.type)) {
    data.path = normalizePath(data.path);
    if (data.path.includes('*')) throw new Error(`CODING_PATH_GLOB_NOT_SUPPORTED:use a concrete path instead of ${data.path}`);
    if (!(task.type === 'repo-list' ? canListContractPath(contract, data.path) : isPathAllowed(contract, data.path))) throw new Error(`CODING_SCOPE_DENIED:${data.path}`);
  }
  if (task.type === 'repo-write') {
    if (typeof data.content !== 'string' || data.content.length > 250_000) throw new Error('CODING_WRITE_CONTENT_INVALID');
  }
  if (task.type === 'repo-edit') {
    if (typeof data.old !== 'string' || !data.old || data.old.length > 50_000) throw new Error('CODING_EDIT_OLD_INVALID');
    if (typeof data.new !== 'string' || data.new.length > 250_000) throw new Error('CODING_EDIT_NEW_INVALID');
    if (data.old === data.new) throw new Error('CODING_EDIT_NO_CHANGE');
    data.replaceAll = data.replaceAll === true;
  }
  if (task.type === 'repo-test') {
    if (typeof data.command !== 'string' || !contract.verification.commands.includes(data.command)) throw new Error('CODING_TEST_COMMAND_NOT_CONTRACTED');
    if (!['test','falsifier','verify'].includes(data.kind || 'test')) throw new Error('CODING_TEST_KIND_INVALID');
    data.kind ||= 'test';
  }
  if (task.type === 'git-commit') {
    if (!contract.execution.allow_git_commit) throw new Error('CODING_GIT_COMMIT_NOT_AUTHORIZED');
    const status = contractVerificationStatus(contract, receipts);
    const preCommitMissing = status.missing.filter(name => name !== 'independent_verification' && name !== 'commit');
    if (preCommitMissing.length) throw new Error(`CODING_GIT_COMMIT_BLOCKED:${preCommitMissing.join(',')}`);
    if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 200) throw new Error('CODING_GIT_MESSAGE_INVALID');
    data.message = data.message.trim();
  }
  if (task.type === 'git-push') {
    if (!contract.execution.allow_git_push) throw new Error('CODING_GIT_PUSH_NOT_AUTHORIZED');
    const status = contractVerificationStatus(contract, receipts);
    if (!status.machineVerified) throw new Error(`CODING_GIT_PUSH_BLOCKED:${status.missing.join(',')}`);
  }
  if (task.type === 'git-merge') {
    if (!contract.execution.allow_git_merge) throw new Error('CODING_GIT_MERGE_NOT_AUTHORIZED');
    const ref = String(data.ref || '').trim();
    if (!ref || ref.length > 200 || !/^[A-Za-z0-9._\/-]+$/.test(ref) || ref.startsWith('-') || ref.includes('..')) throw new Error('CODING_GIT_MERGE_REF_INVALID');
    data.ref = ref;
    const status = contractVerificationStatus(contract, receipts);
    if (!status.machineVerified) throw new Error(`CODING_GIT_MERGE_BLOCKED:${status.missing.join(',')}`);
  }
  return { ...task, data };
}
