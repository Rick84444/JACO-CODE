import fs from 'node:fs';
import path from 'node:path';
import { fingerprintEnvironment } from './skillIR.mjs';
import { abstractValue, normalizeExecutionTrace, outputFingerprint } from './traceNormalizer.mjs';

export class ExecutionProfiler {
  constructor({ file, maxTraces = 2000, telemetrySink = null } = {}) {
    if (!file) throw new Error('SKILL_PROFILER_FILE_REQUIRED');
    this.file = path.resolve(file);
    this.maxTraces = Math.max(100, Number(maxTraces) || 2000);
    this.telemetrySink = typeof telemetrySink === 'function' ? telemetrySink : null;
    this.active = new Map();
    this.traces = [];
    this.persistedLines = 0;
    this.loadErrors = 0;
    this.persistenceErrors = 0;
    this.profileErrors = 0;
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try { fs.chmodSync(this.file, 0o600); } catch {}
    const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    this.persistedLines = lines.length;
    for (const line of lines.slice(-this.maxTraces)) {
      try {
        const item = JSON.parse(line);
        if (item?.schema === 'jaco.skill.execution-trace/v1') this.traces.push(item);
      } catch {
        this.loadErrors += 1;
      }
    }
  }

  begin({ executionId, ir, environment = {}, plan = null }) {
    const trace = {
      schema: 'jaco.skill.execution-trace/v1',
      traceId: 'trace-' + executionId,
      executionId,
      irId: String(ir.id),
      irVersion: String(ir.version || '1.0.0'),
      environmentFingerprint: fingerprintEnvironment(environment),
      planId: plan?.id || null,
      cacheHit: plan?.cacheHit === true,
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: 'RUNNING',
      operations: [],
      metrics: { totalMs: 0, modelCalls: 0, visionCalls: 0, toolCalls: 0, operationCount: 0, deopts: 0 },
      verification: null,
      evidenceRefs: [],
      _startedMonotonic: performance.now(),
      _operationStarts: {},
    };
    this.active.set(executionId, trace);
    return trace.traceId;
  }

  operationStarted(executionId, { instruction, backend, target, input }) {
    const trace = this.active.get(executionId);
    if (!trace) return this.#profileMiss();
    trace._operationStarts[instruction.id] = performance.now();
    trace.operations.push({
      operationId: instruction.id,
      op: instruction.op,
      backend,
      status: 'RUNNING',
      targetShape: abstractValue(target),
      inputShape: abstractValue(input),
      durationMs: 0,
      outputFingerprint: null,
      verification: null,
    });
    return true;
  }

  operationCompleted(executionId, operationId, output) {
    const trace = this.active.get(executionId);
    if (!trace) return this.#profileMiss();
    const operation = [...trace.operations].reverse().find(item => item.operationId === operationId && item.status === 'RUNNING');
    if (!operation) return this.#profileMiss();

    operation.status = 'COMPLETED';
    operation.durationMs = Math.max(0, performance.now() - Number(trace._operationStarts[operationId] || performance.now()));
    operation.outputFingerprint = outputFingerprint(output);
    const meta = output && typeof output === 'object' ? output.__jaco : null;
    if (meta?.verification) operation.verification = meta.verification;
    if (Array.isArray(meta?.evidenceRefs)) trace.evidenceRefs.push(...meta.evidenceRefs.map(String));
    trace.metrics.modelCalls += metric(meta, 'modelCalls');
    trace.metrics.visionCalls += metric(meta, 'visionCalls');
    trace.metrics.toolCalls += operation.backend === 'runtime' ? 0 : Math.max(1, metric(meta, 'toolCalls'));
    trace.metrics.operationCount += 1;
    return true;
  }

  operationFailed(executionId, operationId, error) {
    const trace = this.active.get(executionId);
    if (!trace) return this.#profileMiss();
    const operation = [...trace.operations].reverse().find(item => item.operationId === operationId && item.status === 'RUNNING');
    if (!operation) return this.#profileMiss();

    operation.status = 'FAILED';
    operation.durationMs = Math.max(0, performance.now() - Number(trace._operationStarts[operationId] || performance.now()));
    operation.errorClass = String(error?.code || error?.name || 'Error').slice(0, 120);
    trace.metrics.operationCount += 1;
    if (operation.backend !== 'runtime') trace.metrics.toolCalls += 1;
    return true;
  }

  deoptimized(executionId) {
    const trace = this.active.get(executionId);
    if (!trace) return this.#profileMiss();
    trace.metrics.deopts += 1;
    return true;
  }

  finish(executionId, { status, verification = null, evidenceRefs = [], extraMetrics = {} } = {}) {
    const trace = this.active.get(executionId);
    if (!trace) return this.#profileMiss();

    trace.status = String(status || 'UNKNOWN');
    trace.completedAt = new Date().toISOString();
    trace.metrics.totalMs = Math.max(0, performance.now() - trace._startedMonotonic);
    trace.metrics.modelCalls += metric(extraMetrics, 'modelCalls');
    trace.metrics.visionCalls += metric(extraMetrics, 'visionCalls');
    trace.verification = verification;
    trace.evidenceRefs = [...new Set([
      ...trace.evidenceRefs,
      ...(Array.isArray(evidenceRefs) ? evidenceRefs.map(String) : []),
    ])];
    delete trace._startedMonotonic;
    delete trace._operationStarts;

    const normalized = normalizeExecutionTrace(trace);
    const persisted = {
      ...trace,
      familySignature: normalized.familySignature,
      backendSignature: normalized.backendSignature,
    };

    this.active.delete(executionId);
    this.traces.push(persisted);
    if (this.traces.length > this.maxTraces) this.traces.splice(0, this.traces.length - this.maxTraces);

    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(persisted) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'a',
      });
      this.persistedLines += 1;
      try { fs.chmodSync(this.file, 0o600); } catch {}
      if (this.persistedLines > this.maxTraces * 2) this.#compact();
    } catch {
      this.persistenceErrors += 1;
    }

    try {
      this.telemetrySink?.({ type: 'skill.execution.profiled', trace: normalized });
    } catch {
      this.profileErrors += 1;
    }
    return structuredClone(persisted);
  }

  list({ irId = null, verifiedOnly = false, limit = 500 } = {}) {
    return this.traces
      .filter(trace => !irId || trace.irId === irId)
      .filter(trace => !verifiedOnly || trace.verification?.outcome === 'VERIFIED')
      .slice(-Math.max(1, Math.min(Number(limit) || 500, this.maxTraces)))
      .map(trace => structuredClone(trace));
  }

  get(traceId) {
    const trace = this.traces.find(item => item.traceId === traceId);
    if (!trace) throw new Error('SKILL_TRACE_NOT_FOUND:' + traceId);
    return structuredClone(trace);
  }

  snapshot() {
    const completed = this.traces.filter(trace => trace.status === 'COMPLETED');
    const verified = completed.filter(trace => trace.verification?.outcome === 'VERIFIED');
    return {
      schema: 'jaco.skill-profiler.snapshot/v1',
      active: this.active.size,
      traces: this.traces.length,
      completed: completed.length,
      verified: verified.length,
      totalDeopts: this.traces.reduce((sum, trace) => sum + Number(trace.metrics?.deopts || 0), 0),
      loadErrors: this.loadErrors,
      persistenceErrors: this.persistenceErrors,
      profileErrors: this.profileErrors,
    };
  }

  #compact() {
    const temporary = this.file + '.' + process.pid + '.compact.tmp';
    const content = this.traces.slice(-this.maxTraces).map(trace => JSON.stringify(trace)).join('\n');
    fs.writeFileSync(temporary, content ? content + '\n' : '', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
    this.persistedLines = this.traces.length;
  }

  #profileMiss() {
    this.profileErrors += 1;
    return false;
  }
}

function metric(value, key) {
  const n = Number(value?.[key] || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
