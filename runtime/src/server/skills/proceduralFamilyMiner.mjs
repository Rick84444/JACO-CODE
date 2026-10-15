import crypto from 'node:crypto';
import { normalizeExecutionTrace } from './traceNormalizer.mjs';

export class ProceduralFamilyMiner {
  mine(traces, { minimumVerified = 3, minimumIndependentEvidence = 2 } = {}) {
    const verified = (Array.isArray(traces) ? traces : [])
      .map(normalizeExecutionTrace)
      .filter(isStronglyVerified);

    const groups = new Map();
    for (const trace of verified) {
      const list = groups.get(trace.familySignature) || [];
      list.push(trace);
      groups.set(trace.familySignature, list);
    }

    return [...groups.entries()]
      .map(([signature, members]) => this.describe(signature, members))
      .filter(family => family.verifiedRuns >= minimumVerified && family.independentEvidenceSets >= minimumIndependentEvidence)
      .sort((a, b) => b.verifiedRuns - a.verifiedRuns || b.independentEvidenceSets - a.independentEvidenceSets);
  }

  describe(signature, members) {
    const operationCount = members[0]?.operations.length || 0;
    const invariantBackends = {};
    for (let index = 0; index < operationCount; index++) {
      const values = members.map(trace => trace.operations[index]?.backend);
      if (values.every(value => value === values[0])) invariantBackends[members[0].operations[index].operationId] = values[0];
    }

    return Object.freeze({
      schema: 'jaco.skill.procedural-family/v1',
      id: 'family-' + crypto.createHash('sha256').update(signature).digest('hex').slice(0, 20),
      signature,
      irIds: [...new Set(members.map(trace => trace.irId))],
      verifiedRuns: members.length,
      independentEvidenceSets: countDisjointEvidenceSets(members),
      environments: [...new Set(members.map(trace => trace.environmentFingerprint))],
      operationShape: members[0]?.operations.map(operation => ({
        operationId: operation.operationId,
        op: operation.op,
        targetShape: operation.targetShape,
        inputShape: operation.inputShape,
      })) || [],
      invariantBackends,
      metrics: aggregateMetrics(members),
      memberTraceIds: members.map(trace => trace.traceId),
    });
  }
}

function isStronglyVerified(trace) {
  return trace.status === 'COMPLETED'
    && trace.verification?.outcome === 'VERIFIED'
    && trace.verification?.preconditionsVerified === true
    && trace.verification?.postconditionsVerified === true
    && trace.verification?.independent === true
    && trace.evidenceRefs.length > 0;
}

function countDisjointEvidenceSets(members) {
  const sets = members
    .map(trace => [...new Set(trace.evidenceRefs)])
    .filter(set => set.length > 0)
    .sort((a, b) => a.length - b.length || a.join('|').localeCompare(b.join('|')));

  const used = new Set();
  let independent = 0;
  for (const refs of sets) {
    if (refs.some(ref => used.has(ref))) continue;
    refs.forEach(ref => used.add(ref));
    independent += 1;
  }
  return independent;
}

function aggregateMetrics(members) {
  const keys = ['totalMs', 'modelCalls', 'visionCalls', 'toolCalls', 'operationCount', 'deopts'];
  const result = {};
  for (const key of keys) {
    const values = members.map(trace => Number(trace.metrics?.[key] || 0)).sort((a, b) => a - b);
    result[key] = {
      median: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      min: values[0] || 0,
      max: values.at(-1) || 0,
    };
  }
  return result;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return Number(values[index].toFixed(3));
}
