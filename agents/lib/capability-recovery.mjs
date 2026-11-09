// JACO Aura Capability Evidence — truthful model feedback, never a permission grant.
// An offered tool is callable through the agent's current catalog; execution is still
// checked by the runtime for scope, operator policy, worker readiness and receipts.
export const CAPABILITY_EVIDENCE_SCHEMA = 'jaco.aura-capability-evidence/v1';
const CONTROL_TOOLS = new Set(['complete', 'blocked', 'request_replan', 'delegate', 'tool_search']);
const LIMIT = 80;

export function observeMissionCapabilities(mission = {}, offeredTools = []) {
  const granted = [...new Set((Array.isArray(mission.allowedTasks) ? mission.allowedTasks : [])
    .filter(x => typeof x === 'string'))].slice(0, LIMIT);
  const callable = [...new Set((Array.isArray(offeredTools) ? offeredTools : [])
    .map(x => x?.function?.name).filter(x => typeof x === 'string' && !CONTROL_TOOLS.has(x)))].slice(0, LIMIT);
  const exposed = new Set(callable);
  return {
    schema: CAPABILITY_EVIDENCE_SCHEMA,
    missionId: String(mission.id || '').slice(0, 100),
    source: 'current-mission-and-native-function-catalog',
    granted,
    callable,
    notExposed: granted.filter(t => !exposed.has(t) && !['mcp-call','mcp-write'].includes(t)),
    executionVerified: false,
    verification: 'Only a successful runtime begin/finish receipt proves execution',
  };
}

const FILE_ACTION = /\b(?:repo[-_ ]?(?:write|edit)|files?|folders?|directories|directory|write|create|save|edit|modify|mkdir)\b|(?:fil|filer|filerna|katalog|skriv|skapa|spara|ändra)/i;
const DENIAL = /\b(?:cannot|can't|could not|couldn't|unable|not able|not allowed|no (?:tool|capability|permission)|missing (?:tool|capability)|lack(?:ing)?|unavailable|is not in|does not (?:have|exist))\b|(?:kan inte|saknar|finns inte|har inte|inget verktyg|inga verktyg|tillåter endast|behörighet saknas)/i;
const EXECUTION_REFUSAL = /(?:CODING_SCOPE_DENIED|TASK_TURNED_OFF|OPERATOR_APPROVAL_REQUIRED|SHELL_BLOCKED|MANDATE|POLICY_DENIED|PAYMENT_REQUIRED|SECRET_POLICY|OUTCOME_UNKNOWN)/i;

export function capabilityDenialCorrection(reason, evidence) {
  const statement = String(reason || '').slice(0, 1000);
  if (!DENIAL.test(statement) || !FILE_ACTION.test(statement) || EXECUTION_REFUSAL.test(statement)) return null;
  // Only contradict the planner using tools exposed in THIS mission's actual native
  // catalog. Mission grants or historical successes alone never prove callability.
  const available = evidence?.callable || [];
  const names = ['repo-write', 'repo-edit'].filter(t => available.includes(t));
  if (!names.length) return null;
  const tool = /\b(?:edit|modify|ändra)\b/i.test(statement) && names.includes('repo-edit') ? 'repo-edit'
    : names.includes('repo-write') ? 'repo-write' : names[0];
  return {
    code: 'PLANNER_CAPABILITY_CONTRADICTION',
    tool,
    message: 'CAPABILITY_CORRECTION: '+tool+' is offered by the current mission function catalog. ' +
      'Use that function with its declared arguments; the runtime will validate scope and policy. ' +
      'Do not claim that execution succeeded until a verified receipt is returned. ' +
      'If the runtime refuses the call, inspect its exact error instead of repeating this assertion.',
  };
}
