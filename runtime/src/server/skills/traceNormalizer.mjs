import crypto from 'node:crypto';

const SHAPE_TOKEN_RE = /^\{\{[a-z0-9_-]+\}\}$/i;

export function procedureShapeSignature(operations = [], { abstractValues = true } = {}) {
  const shape = operations.map(operation => ({
    op: String(operation?.op || operation?.type || '').toUpperCase(),
    target: abstractValues
      ? abstractValue(operation?.target ?? operation?.targetShape ?? operation?.selector ?? null)
      : stableValue(operation?.target ?? operation?.targetShape ?? operation?.selector ?? null),
    input: abstractValues
      ? abstractValue(operation?.input ?? operation?.inputShape ?? operation?.args ?? operation?.text ?? null)
      : stableValue(operation?.input ?? operation?.inputShape ?? operation?.args ?? operation?.text ?? null),
    postcondition: abstractValues
      ? abstractValue(operation?.postcondition ?? null)
      : stableValue(operation?.postcondition ?? null),
  }));
  return sha256(canonical(shape));
}

export function normalizeExecutionTrace(trace = {}) {
  if (trace?.schema === 'jaco.skill.normalized-trace/v1') return trace;

  const operations = (Array.isArray(trace.operations) ? trace.operations : []).map(operation => ({
    operationId: String(operation.operationId || operation.id || ''),
    op: String(operation.op || '').toUpperCase(),
    backend: String(operation.backend || 'runtime'),
    status: String(operation.status || 'UNKNOWN'),
    targetShape: abstractValue(operation.targetShape ?? operation.target),
    inputShape: abstractValue(operation.inputShape ?? operation.input),
    durationMs: finite(operation.durationMs),
    outputFingerprint: operation.outputFingerprint || null,
    verification: operation.verification || null,
  }));
  const completedOperations = operations.filter(operation => operation.status === 'COMPLETED');

  return Object.freeze({
    schema: 'jaco.skill.normalized-trace/v1',
    traceId: String(trace.traceId || trace.executionId || ''),
    executionId: String(trace.executionId || ''),
    irId: String(trace.irId || ''),
    status: String(trace.status || 'UNKNOWN'),
    environmentFingerprint: String(trace.environmentFingerprint || ''),
    familySignature: trace.familySignature || procedureShapeSignature(completedOperations, { abstractValues: true }),
    backendSignature: trace.backendSignature || sha256(canonical(operations.map(op => [op.op, op.backend, op.status]))),
    operations: Object.freeze(operations),
    metrics: Object.freeze(normalizeMetrics(trace.metrics || {})),
    verification: trace.verification || null,
    evidenceRefs: Object.freeze(uniqueStrings(trace.evidenceRefs)),
    startedAt: trace.startedAt || null,
    completedAt: trace.completedAt || null,
  });
}

export function normalizeMetrics(metrics = {}) {
  return {
    totalMs: finite(metrics.totalMs),
    modelCalls: integer(metrics.modelCalls),
    visionCalls: integer(metrics.visionCalls),
    toolCalls: integer(metrics.toolCalls),
    operationCount: integer(metrics.operationCount),
    deopts: integer(metrics.deopts),
  };
}

export function outputFingerprint(value) {
  return sha256(canonical(stableValue(value)));
}

export function abstractValue(value) {
  if (Array.isArray(value)) return value.map(abstractValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, abstractValue(value[key])]));
  }
  if (typeof value === 'string') {
    if (SHAPE_TOKEN_RE.test(value)) return value;
    if (value.startsWith('$')) return value;
    if (/^https?:\/\//i.test(value)) return '{{url}}';
    if (/^[A-Za-z]:[\\/]|^\//.test(value)) return '{{path}}';
    if (/^[0-9a-f]{32,}$/i.test(value)) return '{{opaque-id}}';
    return '{{string}}';
  }
  if (typeof value === 'number') return '{{number}}';
  if (typeof value === 'bigint') return '{{bigint}}';
  if (typeof value === 'boolean') return value;
  if (value === undefined) return '{{undefined}}';
  return value;
}

function stableValue(value, seen = new WeakSet(), depth = 0) {
  if (depth > 32) return '{{max-depth}}';
  if (value === undefined) return '{{undefined}}';
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'function') return { $function: value.name || 'anonymous' };
  if (typeof value === 'symbol') return { $symbol: String(value.description || '') };
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '{{circular}}';
  seen.add(value);

  if (Buffer.isBuffer(value)) return { $bufferSha256: sha256(value), length: value.length };
  if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString() };
  if (value instanceof Map) {
    return {
      $map: [...value.entries()]
        .slice(0, 1000)
        .map(([key, item]) => [stableValue(key, seen, depth + 1), stableValue(item, seen, depth + 1)]),
    };
  }
  if (value instanceof Set) {
    return { $set: [...value.values()].slice(0, 1000).map(item => stableValue(item, seen, depth + 1)) };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 1000).map(item => stableValue(item, seen, depth + 1));
  }

  const output = {};
  for (const key of Object.keys(value).sort().slice(0, 1000)) {
    try {
      output[key] = stableValue(value[key], seen, depth + 1);
    } catch {
      output[key] = '{{unreadable}}';
    }
  }
  return output;
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? JSON.stringify(String(value)) : encoded;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function finite(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function integer(value) {
  return Math.max(0, Math.trunc(finite(value)));
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
}
