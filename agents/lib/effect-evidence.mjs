// Canonical receipt epistemics, not an additional state store or a model confidence score.
// The executor can attest that a call returned successfully. It cannot independently
// attest that an external mutation achieved its intended postcondition.
// No field from a model/tool payload can self-assign INDEPENDENTLY_VERIFIED.
const OBSERVATION_TASKS = new Set([
  'detect-surfaces','health-check','check-revenue','web-fetch',
  'desktop-windows','desktop-observe','android-status','android-observe',
  'windows-wmi-read','screenshot','get-cursor','repo-list','repo-read',
  'git-status','git-diff','skill-load',
]);

export const EFFECT_EVIDENCE_SCHEMA = 'jaco.effect-evidence/v1';

export function classifyEffectEvidence(taskType, receipt) {
  const observation = OBSERVATION_TASKS.has(String(taskType || ''));
  const level = receipt?.outcomeUnknown === true ? 'UNKNOWN' :
    receipt?.ok !== true ? 'REJECTED' :
    receipt?.verified === true ? 'TOOL_ATTESTED' : 'TRANSPORT_ACK';
  return {
    schema: EFFECT_EVIDENCE_SCHEMA,
    level,
    scope: observation ? 'OBSERVATION' : 'POTENTIAL_MUTATION',
    independent: false,
    basis: 'durable-execution-receipt',
  };
}

// A successful *observation* may be recorded as a non-reusable historical
// observation with explicit tool-origin provenance. A mutation (including
// generic/opaque MCP) MUST NOT become verified knowledge from its own receipt.
// Independent postconditions need a separate canonical verifier + evidence refs;
// accepting caller-provided flags here would let agents promote their own claims.
export function receiptPromotionEligibility(taskType, receipt) {
  const evidence = classifyEffectEvidence(taskType, receipt);
  if (evidence.level !== 'TOOL_ATTESTED') {
    return { allowed: false, reason: 'NOT_VERIFIED_KNOWN_OUTCOME', evidence };
  }
  if (evidence.scope !== 'OBSERVATION') {
    return { allowed: false, reason: 'INDEPENDENT_EFFECT_VERIFICATION_REQUIRED', evidence };
  }
  return { allowed: true, reason: 'HISTORICAL_OBSERVATION_ONLY', evidence };
}
