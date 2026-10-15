// Canonical data contracts for experience-based computer execution.
// This module contains no actuator, planner, agent, or parallel control plane.
// Observation is evidence; it is never promoted to truth by construction.

const FACETS = ['visual', 'structural', 'system', 'semantic', 'temporal', 'mission'];
export const EVIDENCE_LEVELS = Object.freeze([
  'UNOBSERVED',
  'SIMULATED',
  'INTEGRATION_VERIFIED',
  'TARGET_HOST_VERIFIED',
  'REGRESSION_VERIFIED',
]);
export const KNOWLEDGE_STATES = Object.freeze([
  'CANDIDATE', 'OBSERVED', 'REPEATED', 'VERIFIED',
  'PROMOTED', 'STABLE', 'DEGRADED', 'INVALID', 'ARCHIVED',
]);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`COGNITIVE_EXECUTION_${name.toUpperCase()}_REQUIRED`);
  return value;
}
function finite01(value, name = 'confidence') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`COGNITIVE_EXECUTION_INVALID_${name.toUpperCase()}`);
  return n;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createObservation(input = {}) {
  const observation = {
    id: required(input.id, 'observation_id'),
    at: required(input.at, 'observation_at'),
    source: required(input.source, 'observation_source'),
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : {},
    sensitive: input.sensitive === true,
  };
  return freeze(observation);
}

export function createWorldState(input = {}) {
  const facets = {};
  for (const name of FACETS) facets[name] = input.facets?.[name] ?? null;
  const state = {
    id: required(input.id, 'world_state_id'),
    observationIds: [...new Set(input.observationIds || [])],
    facets,
    confidence: finite01(input.confidence ?? 0),
    status: input.status || 'UNKNOWN',
  };
  if (!['UNKNOWN', 'CANDIDATE', 'ACCEPTED'].includes(state.status)) throw new Error('COGNITIVE_EXECUTION_INVALID_WORLD_STATE_STATUS');
  if (state.status === 'ACCEPTED' && state.observationIds.length === 0) throw new Error('COGNITIVE_EXECUTION_ACCEPTED_STATE_REQUIRES_EVIDENCE');
  return freeze(state);
}

export function createTransition(input = {}) {
  const transition = {
    id: required(input.id, 'transition_id'),
    fromStateId: required(input.fromStateId, 'from_state_id'),
    intent: required(input.intent, 'transition_intent'),
    preconditions: Array.isArray(input.preconditions) ? input.preconditions : [],
    expectedStateId: required(input.expectedStateId, 'expected_state_id'),
    status: input.status || 'CANDIDATE',
    evidenceReceiptIds: [...new Set(input.evidenceReceiptIds || [])],
  };
  if (!KNOWLEDGE_STATES.includes(transition.status)) throw new Error('COGNITIVE_EXECUTION_INVALID_TRANSITION_STATUS');
  if (['VERIFIED', 'PROMOTED', 'STABLE'].includes(transition.status) && transition.evidenceReceiptIds.length === 0) {
    throw new Error('COGNITIVE_EXECUTION_VERIFIED_TRANSITION_REQUIRES_RECEIPT');
  }
  return freeze(transition);
}

export function createVerificationResult(input = {}) {
  const result = {
    expectedStateId: required(input.expectedStateId, 'verification_expected_state_id'),
    observedStateId: input.observedStateId ?? null,
    preconditionsVerified: input.preconditionsVerified === true,
    postconditionsVerified: input.postconditionsVerified === true,
    independent: input.independent === true,
    outcome: input.outcome || 'UNKNOWN',
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : {},
  };
  if (!['VERIFIED', 'FAILED', 'AMBIGUOUS', 'UNKNOWN'].includes(result.outcome)) throw new Error('COGNITIVE_EXECUTION_INVALID_VERIFICATION_OUTCOME');
  if (result.outcome === 'VERIFIED' && (!result.preconditionsVerified || !result.postconditionsVerified)) {
    throw new Error('COGNITIVE_EXECUTION_VERIFIED_OUTCOME_REQUIRES_PRE_AND_POSTCONDITIONS');
  }
  return freeze(result);
}

export function createExperienceReceipt(input = {}) {
  const level = input.evidenceLevel || 'UNOBSERVED';
  if (!EVIDENCE_LEVELS.includes(level)) throw new Error('COGNITIVE_EXECUTION_INVALID_EVIDENCE_LEVEL');
  const verification = createVerificationResult(input.verification || {});
  if (level !== 'UNOBSERVED' && verification.outcome !== 'VERIFIED') {
    throw new Error('COGNITIVE_EXECUTION_EVIDENCE_PROMOTION_REQUIRES_VERIFIED_OUTCOME');
  }
  return freeze({
    id: required(input.id, 'receipt_id'),
    missionId: required(input.missionId, 'receipt_mission_id'),
    transitionId: input.transitionId ?? null,
    evidenceLevel: level,
    verification,
    metrics: {
      actionCount: Number(input.metrics?.actionCount || 0),
      modelCalls: Number(input.metrics?.modelCalls || 0),
      visionCalls: Number(input.metrics?.visionCalls || 0),
      inferenceMs: Number(input.metrics?.inferenceMs || 0),
      totalMs: Number(input.metrics?.totalMs || 0),
    },
    createdAt: required(input.createdAt, 'receipt_created_at'),
  });
}

export function canReplayTransition({ transition, currentState, minConfidence = 0.95 } = {}) {
  if (!transition || !currentState) return { ok: false, reason: 'MISSING_INPUT' };
  if (!['VERIFIED', 'PROMOTED', 'STABLE'].includes(transition.status)) return { ok: false, reason: 'TRANSITION_NOT_VERIFIED' };
  if (currentState.status !== 'ACCEPTED') return { ok: false, reason: 'STATE_NOT_ACCEPTED' };
  if (currentState.id !== transition.fromStateId) return { ok: false, reason: 'STATE_MISMATCH' };
  if (currentState.confidence < finite01(minConfidence, 'min_confidence')) return { ok: false, reason: 'LOCALIZATION_CONFIDENCE_TOO_LOW' };
  return { ok: true, reason: 'VERIFIED_ROUTE_AVAILABLE' };
}
