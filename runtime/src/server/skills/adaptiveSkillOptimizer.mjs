import crypto from 'node:crypto';
import { fingerprintEnvironment, normalizeSkillIR } from './skillIR.mjs';
import { ProceduralFamilyMiner } from './proceduralFamilyMiner.mjs';
import { specializeSkillIR } from './partialEvaluator.mjs';
import { ProcessVerifier } from './processVerifier.mjs';
import { BenchmarkArena } from './benchmarkArena.mjs';
import { OptimizationStore } from './optimizationStore.mjs';

export class AdaptiveSkillOptimizer {
  constructor({ profiler, targetCompiler, storeFile, evidenceValidator = null }) {
    if (!profiler || !targetCompiler || !storeFile) throw new Error('SKILL_OPTIMIZER_DEPENDENCY_REQUIRED');
    this.profiler = profiler;
    this.targetCompiler = targetCompiler;
    this.evidenceValidator = typeof evidenceValidator === 'function' ? evidenceValidator : null;
    this.miner = new ProceduralFamilyMiner();
    this.verifier = new ProcessVerifier();
    this.arena = new BenchmarkArena({ verifier: this.verifier });
    this.store = new OptimizationStore(storeFile);
  }

  discoverFamilies(options = {}) {
    const traces = this.profiler
      .list({ limit: options.limit || 2000 })
      .filter(trace => this.#evidenceIsValid(trace.evidenceRefs));

    const families = this.miner.mine(traces, options);
    for (const family of families) this.store.putFamily(family);
    return families;
  }

  createCandidate({
    familyId,
    ir,
    environment = {},
    inputBindings = {},
    environmentBindings = {},
    label = null,
  }) {
    const family = this.store.getFamily(familyId);
    const normalizedIR = normalizeSkillIR(ir);
    if (!family.irIds.includes(normalizedIR.id)) {
      throw new Error('SKILL_OPTIMIZATION_IR_NOT_IN_FAMILY:' + normalizedIR.id);
    }

    assertEnvironmentBindings(environment, environmentBindings);

    const specializedIR = specializeSkillIR(normalizedIR, {
      inputBindings,
      environmentBindings,
      label,
    });
    const plan = this.targetCompiler.compile(specializedIR, { environment });
    const frozenInputKeys = specializedIR.metadata?.specialization?.frozenInputKeys || [];
    const scope = frozenInputKeys.length ? 'INSTANCE' : 'ENVIRONMENT';

    const candidate = {
      schema: 'jaco.skill.optimization-candidate/v1',
      id: 'opt-' + crypto.randomBytes(8).toString('hex'),
      familyId,
      status: 'CANDIDATE',
      scope,
      promotable: scope !== 'INSTANCE',
      createdAt: new Date().toISOString(),
      specializedIR,
      environment,
      environmentFingerprint: fingerprintEnvironment(environment),
      plan,
      benchmarkId: null,
    };
    return this.store.putCandidate(candidate);
  }

  evaluateCandidate({ candidateId, baselineTraceId, candidateTraceId, requiredOperations = [] }) {
    const candidate = this.store.getCandidate(candidateId);
    const family = this.store.getFamily(candidate.familyId);
    const baseline = this.profiler.get(baselineTraceId);
    const candidateTrace = this.profiler.get(candidateTraceId);

    if (candidateTrace.irId !== candidate.specializedIR.id) {
      throw new Error('SKILL_OPTIMIZATION_TRACE_NOT_FROM_CANDIDATE');
    }
    if (!family.irIds.includes(baseline.irId)) {
      throw new Error('SKILL_OPTIMIZATION_BASELINE_NOT_FROM_FAMILY');
    }
    if (candidateTrace.environmentFingerprint !== candidate.environmentFingerprint) {
      throw new Error('SKILL_OPTIMIZATION_CANDIDATE_ENVIRONMENT_MISMATCH');
    }
    if (!this.#evidenceIsValid(baseline.evidenceRefs) || !this.#evidenceIsValid(candidateTrace.evidenceRefs)) {
      throw new Error('SKILL_OPTIMIZATION_EVIDENCE_NOT_VERIFIED');
    }

    const benchmark = this.arena.compare({
      baseline,
      candidate: candidateTrace,
      requiredOperations,
    });
    const saved = this.store.putBenchmark({ candidateId, ...benchmark });

    candidate.status = saved.decision === 'REJECTED' ? 'REJECTED' : candidate.status;
    candidate.benchmarkId = saved.id;
    this.store.putCandidate(candidate);
    return saved;
  }

  promote(candidateId, benchmarkId = null) {
    const candidate = this.store.getCandidate(candidateId);
    const resolvedBenchmarkId = benchmarkId || candidate.benchmarkId;
    if (!resolvedBenchmarkId) throw new Error('SKILL_OPTIMIZATION_BENCHMARK_REQUIRED');

    const benchmark = this.store.getBenchmark(resolvedBenchmarkId);
    const evidenceRefs = benchmark.verification?.evidenceRefs || [];
    if (!this.#evidenceIsValid(evidenceRefs)) {
      throw new Error('SKILL_OPTIMIZATION_EVIDENCE_NOT_VERIFIED');
    }
    return this.store.promote(candidateId, resolvedBenchmarkId);
  }

  snapshot() {
    return {
      ...this.store.snapshot(),
      profiler: this.profiler.snapshot(),
    };
  }

  #evidenceIsValid(refs) {
    if (!Array.isArray(refs) || refs.length === 0) return false;
    if (!this.evidenceValidator) return true;
    try {
      this.evidenceValidator(refs);
      return true;
    } catch {
      return false;
    }
  }
}

function assertEnvironmentBindings(environment, bindings) {
  for (const [key, value] of Object.entries(bindings || {})) {
    if (!Object.prototype.hasOwnProperty.call(environment || {}, key)) {
      throw new Error('SKILL_OPTIMIZATION_ENVIRONMENT_BINDING_MISSING:' + key);
    }
    if (JSON.stringify(environment[key]) !== JSON.stringify(value)) {
      throw new Error('SKILL_OPTIMIZATION_ENVIRONMENT_BINDING_MISMATCH:' + key);
    }
  }
}
