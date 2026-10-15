import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fingerprintEnvironment, fingerprintIR, normalizeSkillIR } from './skillIR.mjs';

const RUNTIME_OPS = new Set(['CALL', 'RETURN', 'ASSERT', 'COMPARE', 'SELECT', 'RECOVER']);

export class JitPlanCache {
  constructor(file) {
    this.file = path.resolve(file);
    this.state = { version: 1, plans: {}, deopts: {} };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed?.version === 1) this.state = parsed;
    } catch {}
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  key(ir, environment) {
    return fingerprintIR(ir) + ':' + fingerprintEnvironment(environment);
  }

  get(ir, environment) {
    return this.state.plans[this.key(ir, environment)] || null;
  }

  put(ir, environment, plan) {
    this.state.plans[this.key(ir, environment)] = { ...plan, cachedAt: new Date().toISOString() };
    this.save();
  }

  blocked(ir, environment) {
    return Array.isArray(this.state.deopts[this.key(ir, environment)]?.blocked)
      ? [...this.state.deopts[this.key(ir, environment)].blocked]
      : [];
  }

  invalidate(ir, environment, { reason = 'deopt', operationId = null, backend = null } = {}) {
    const key = this.key(ir, environment);
    delete this.state.plans[key];
    const prior = this.state.deopts[key] || { count: 0, blocked: [] };
    const blockedKey = operationId && backend ? operationId + ':' + backend : null;
    this.state.deopts[key] = {
      count: Number(prior.count || 0) + 1,
      blocked: [...new Set([...(prior.blocked || []), ...(blockedKey ? [blockedKey] : [])])],
      lastReason: String(reason),
      at: new Date().toISOString(),
    };
    this.save();
  }

  stats() {
    return {
      plans: Object.keys(this.state.plans).length,
      deoptimizedEnvironments: Object.keys(this.state.deopts).length,
      deopts: Object.values(this.state.deopts).reduce((sum, item) => sum + Number(item.count || 0), 0),
      blockedBackends: Object.values(this.state.deopts).reduce((sum, item) => sum + (Array.isArray(item.blocked) ? item.blocked.length : 0), 0),
    };
  }
}

export class TargetCompiler {
  constructor({ adapters = [], cache = null } = {}) {
    this.adapters = new Map();
    for (const adapter of adapters) this.registerAdapter(adapter);
    this.cache = cache;
  }

  registerAdapter(adapter) {
    const id = String(adapter?.id || '').trim();
    if (!id) throw new Error('SKILL_ADAPTER_ID_REQUIRED');
    if (typeof adapter.execute !== 'function') throw new Error('SKILL_ADAPTER_EXECUTE_REQUIRED:' + id);
    this.adapters.set(id, {
      priority: 0,
      cost: 1,
      operations: [],
      substrates: [],
      available: () => true,
      ...adapter,
      id,
    });
    return this;
  }

  compile(irInput, { environment = {}, excluded = [] } = {}) {
    const ir = normalizeSkillIR(irInput);
    const explicitExcluded = new Set(excluded.map(String));
    const learnedExcluded = new Set(this.cache?.blocked(ir, environment) || []);
    const excludedSet = new Set([...explicitExcluded, ...learnedExcluded]);

    if (!explicitExcluded.size && this.cache) {
      const cached = this.cache.get(ir, environment);
      if (cached && cached.operations.every(item =>
        item.backend === 'runtime'
        || (this.adapters.has(item.backend) && !excludedSet.has(item.instruction.id + ':' + item.backend))
      )) {
        return { ...cached, cacheHit: true };
      }
    }

    const operations = ir.operations.map(instruction => {
      if (RUNTIME_OPS.has(instruction.op)) return { instruction, backend: 'runtime', score: 0 };

      const candidates = [...this.adapters.values()]
        .filter(adapter => !excludedSet.has(instruction.id + ':' + adapter.id))
        .filter(adapter => adapter.operations.includes('*') || adapter.operations.includes(instruction.op))
        .filter(adapter => !instruction.requires.length || instruction.requires.every(required => adapter.substrates.includes(required)))
        .filter(adapter => {
          try { return adapter.available(environment, instruction) !== false; } catch { return false; }
        })
        .map(adapter => ({
          adapter,
          score: Number(adapter.priority || 0) * 1000 - Number(adapter.cost || 0),
        }))
        .sort((a, b) => b.score - a.score || a.adapter.id.localeCompare(b.adapter.id));

      if (!candidates.length) throw new Error('SKILL_NO_BACKEND:' + instruction.op + ':' + instruction.id);
      return { instruction, backend: candidates[0].adapter.id, score: candidates[0].score };
    });

    const plan = {
      schema: 'jaco.skill.execution-plan/v1',
      id: 'plan-' + crypto.createHash('sha256').update(fingerprintIR(ir) + fingerprintEnvironment(environment)).digest('hex').slice(0, 20),
      irId: ir.id,
      irVersion: ir.version,
      environmentFingerprint: fingerprintEnvironment(environment),
      compiledAt: new Date().toISOString(),
      cacheHit: false,
      learnedExclusions: [...learnedExcluded],
      operations,
    };
    if (!explicitExcluded.size && this.cache) this.cache.put(ir, environment, plan);
    return plan;
  }

  adapter(id) {
    return this.adapters.get(id) || null;
  }

  deopt(ir, environment, details = {}) {
    this.cache?.invalidate(ir, environment, details);
  }
}
