import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class OptimizationStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.state = {
      schema: 'jaco.skill.optimization-store/v1',
      families: {},
      candidates: {},
      benchmarks: {},
      promotions: {},
      updatedAt: null,
    };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      throw new Error('SKILL_OPTIMIZATION_STORE_CORRUPT:' + String(error?.message || error));
    }
    if (parsed?.schema !== this.state.schema) {
      throw new Error('SKILL_OPTIMIZATION_STORE_SCHEMA_UNSUPPORTED');
    }
    this.state = parsed;
    try { fs.chmodSync(this.file, 0o600); } catch {}
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
  }

  putFamily(family) {
    this.state.families[family.id] = structuredClone(family);
    this.save();
    return structuredClone(family);
  }

  getFamily(id) {
    const family = this.state.families[id];
    if (!family) throw new Error('SKILL_OPTIMIZATION_FAMILY_NOT_FOUND:' + id);
    return structuredClone(family);
  }

  putCandidate(candidate) {
    this.state.candidates[candidate.id] = structuredClone(candidate);
    this.save();
    return structuredClone(candidate);
  }

  putBenchmark(benchmark) {
    const id = 'benchmark-' + crypto.randomBytes(8).toString('hex');
    this.state.benchmarks[id] = { id, at: new Date().toISOString(), ...structuredClone(benchmark) };
    this.save();
    return structuredClone(this.state.benchmarks[id]);
  }

  promote(candidateId, benchmarkId) {
    const candidate = this.state.candidates[candidateId];
    const benchmark = this.state.benchmarks[benchmarkId];
    if (!candidate) throw new Error('SKILL_OPTIMIZATION_CANDIDATE_NOT_FOUND:' + candidateId);
    if (!benchmark) throw new Error('SKILL_OPTIMIZATION_BENCHMARK_NOT_FOUND:' + benchmarkId);
    if (candidate.promotable === false) throw new Error('SKILL_OPTIMIZATION_INSTANCE_SCOPE_NOT_PROMOTABLE');
    if (benchmark.candidateId !== candidateId) throw new Error('SKILL_OPTIMIZATION_BENCHMARK_CANDIDATE_MISMATCH');
    if (benchmark.decision !== 'VERIFIED_BETTER') throw new Error('SKILL_OPTIMIZATION_PROMOTION_REQUIRES_VERIFIED_BETTER');

    candidate.status = 'PROMOTED';
    candidate.promotedAt = new Date().toISOString();
    candidate.benchmarkId = benchmarkId;
    this.state.promotions[candidateId] = { candidateId, benchmarkId, at: candidate.promotedAt };
    this.save();
    return structuredClone(candidate);
  }

  getCandidate(id) {
    const candidate = this.state.candidates[id];
    if (!candidate) throw new Error('SKILL_OPTIMIZATION_CANDIDATE_NOT_FOUND:' + id);
    return structuredClone(candidate);
  }

  getBenchmark(id) {
    const benchmark = this.state.benchmarks[id];
    if (!benchmark) throw new Error('SKILL_OPTIMIZATION_BENCHMARK_NOT_FOUND:' + id);
    return structuredClone(benchmark);
  }

  snapshot() {
    return {
      schema: 'jaco.skill-optimizer.snapshot/v1',
      families: Object.keys(this.state.families).length,
      candidates: Object.values(this.state.candidates).filter(item => item.status === 'CANDIDATE').length,
      rejected: Object.values(this.state.candidates).filter(item => item.status === 'REJECTED').length,
      promoted: Object.values(this.state.candidates).filter(item => item.status === 'PROMOTED').length,
      benchmarks: Object.keys(this.state.benchmarks).length,
      updatedAt: this.state.updatedAt,
    };
  }
}
