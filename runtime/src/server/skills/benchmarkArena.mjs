import { normalizeExecutionTrace } from './traceNormalizer.mjs';

export class BenchmarkArena {
  constructor({ verifier }) {
    if (!verifier) throw new Error('SKILL_BENCHMARK_VERIFIER_REQUIRED');
    this.verifier = verifier;
  }

  compare({ baseline, candidate, requiredOperations = [] }) {
    const base = normalizeExecutionTrace(baseline);
    const next = normalizeExecutionTrace(candidate);
    const verification = this.verifier.compare({ baseline: base, candidate: next, requiredOperations });
    const deltas = metricDeltas(base.metrics, next.metrics);
    const benchmarkReasons = [];

    if (base.environmentFingerprint !== next.environmentFingerprint) {
      benchmarkReasons.push('ENVIRONMENT_FINGERPRINT_CHANGED');
    }

    const costs = ['totalMs', 'modelCalls', 'visionCalls', 'toolCalls', 'deopts'];
    const noRegression = costs.every(key => deltas[key] <= 0);
    const oneStrictImprovement = costs.some(key => deltas[key] < 0);
    const comparable = verification.outcome === 'VERIFIED' && benchmarkReasons.length === 0;
    const strictlyBetter = comparable && noRegression && oneStrictImprovement;

    return Object.freeze({
      schema: 'jaco.skill.benchmark/v1',
      baselineTraceId: base.traceId,
      candidateTraceId: next.traceId,
      environmentFingerprint: comparable ? base.environmentFingerprint : null,
      verification,
      benchmarkReasons,
      baselineMetrics: base.metrics,
      candidateMetrics: next.metrics,
      deltas,
      decision: strictlyBetter
        ? 'VERIFIED_BETTER'
        : comparable
          ? 'VERIFIED_NOT_BETTER'
          : 'REJECTED',
    });
  }
}

function metricDeltas(base, next) {
  return Object.fromEntries(['totalMs', 'modelCalls', 'visionCalls', 'toolCalls', 'operationCount', 'deopts']
    .map(key => [key, Number((Number(next[key] || 0) - Number(base[key] || 0)).toFixed(3))]));
}
