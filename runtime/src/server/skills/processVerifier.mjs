import { normalizeExecutionTrace } from './traceNormalizer.mjs';

export class ProcessVerifier {
  verifyTrace(traceInput, { requiredOperations = [], requireEvidence = true, requireIndependent = true } = {}) {
    const trace = normalizeExecutionTrace(traceInput);
    const reasons = [];
    if (trace.status !== 'COMPLETED') reasons.push('TRACE_NOT_COMPLETED');
    if (trace.verification?.outcome !== 'VERIFIED') reasons.push('FINAL_OUTCOME_NOT_VERIFIED');
    if (trace.verification?.preconditionsVerified !== true) reasons.push('PRECONDITIONS_NOT_VERIFIED');
    if (trace.verification?.postconditionsVerified !== true) reasons.push('POSTCONDITIONS_NOT_VERIFIED');
    if (requireIndependent && trace.verification?.independent !== true) reasons.push('INDEPENDENT_VERIFICATION_REQUIRED');
    if (requireEvidence && trace.evidenceRefs.length === 0) reasons.push('EVIDENCE_REQUIRED');

    const completedIds = new Set(trace.operations.filter(op => op.status === 'COMPLETED').map(op => op.operationId));
    for (const id of requiredOperations.map(String)) {
      if (!completedIds.has(id)) reasons.push('REQUIRED_OPERATION_MISSING:' + id);
    }

    return Object.freeze({
      schema: 'jaco.skill.process-verification/v1',
      outcome: reasons.length ? 'FAILED' : 'VERIFIED',
      reasons,
      traceId: trace.traceId,
      familySignature: trace.familySignature,
      evidenceRefs: trace.evidenceRefs,
    });
  }

  compare({ baseline, candidate, requiredOperations = [] }) {
    const base = normalizeExecutionTrace(baseline);
    const next = normalizeExecutionTrace(candidate);
    const baseVerification = this.verifyTrace(base, { requiredOperations });
    const candidateVerification = this.verifyTrace(next, { requiredOperations });
    const reasons = [];

    if (baseVerification.outcome !== 'VERIFIED') reasons.push('BASELINE_NOT_VERIFIED');
    if (candidateVerification.outcome !== 'VERIFIED') reasons.push('CANDIDATE_NOT_VERIFIED');
    if (base.familySignature !== next.familySignature) reasons.push('SEMANTIC_PROCEDURE_SHAPE_CHANGED');

    return Object.freeze({
      schema: 'jaco.skill.process-comparison/v1',
      outcome: reasons.length ? 'FAILED' : 'VERIFIED',
      reasons,
      baselineTraceId: base.traceId,
      candidateTraceId: next.traceId,
      familySignature: base.familySignature,
      evidenceRefs: [...new Set([...base.evidenceRefs, ...next.evidenceRefs])],
    });
  }
}
