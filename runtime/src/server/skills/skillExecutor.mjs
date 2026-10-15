import { SkillRunStore } from './skillRunStore.mjs';

export class SkillExecutor {
  constructor({ index, runStore, tools = {}, scripts = {}, model = null, maxDepth = 8 } = {}) {
    if (!index) throw new Error('SKILL_INDEX_REQUIRED');
    this.index = index;
    this.runStore = runStore || new SkillRunStore('.jaco/skill-runs');
    this.tools = tools;
    this.scripts = scripts;
    this.model = model;
    this.maxDepth = maxDepth;
  }

  async execute(skillId, input = {}, options = {}) {
    const depth = Number(options.depth || 0);
    if (depth > this.maxDepth) throw new Error('SKILL_MAX_COMPOSITION_DEPTH');
    const manifest = this.index.getDescriptor(skillId);
    if (manifest.status !== 'ACTIVE' && options.allowCandidate !== true) throw new Error('SKILL_NOT_ACTIVE:' + skillId);
    const procedure = this.index.loadProcedure(skillId, options.entrypoint || 'main');

    let state;
    if (options.runId && this.runStore.exists(options.runId)) {
      state = this.runStore.load(options.runId);
      if (state.skillId !== skillId || state.version !== manifest.version) throw new Error('SKILL_RUN_IDENTITY_MISMATCH');
      if (state.status === 'COMPLETED') return state;
      state.status = 'RUNNING';
      state.error = null;
      this.runStore.save(state);
      this.runStore.append(state.id, { type: 'run.resumed' });
    } else {
      state = this.runStore.create({ skillId, version: manifest.version, input, runId: options.runId || null, parentRunId: options.parentRunId || null });
    }

    const runtime = {
      input: state.input,
      steps: state.stepOutputs,
      context: options.context || {},
    };

    try {
      for (const step of procedure.steps) {
        if (state.completedSteps.includes(step.id)) continue;
        if (!matchesWhen(step.when, runtime)) {
          state = this.runStore.checkpoint(state.id, step.id, { skipped: true });
          runtime.steps = state.stepOutputs;
          continue;
        }

        const output = await this.runStep(step, runtime, { ...options, depth, parentRunId: state.id });
        const metric = step.kind === 'tool' ? 'toolCalls' : step.kind === 'script' ? 'scriptCalls' : step.kind === 'model' ? 'modelCalls' : step.kind === 'skill' ? 'childSkills' : null;
        state = this.runStore.checkpoint(state.id, step.id, output, metric);
        runtime.steps = state.stepOutputs;

        if (step.kind === 'return') return this.runStore.complete(state.id, output);
      }

      const last = procedure.steps[procedure.steps.length - 1];
      const result = state.stepOutputs[last.id] ?? null;
      return this.runStore.complete(state.id, result);
    } catch (error) {
      return this.runStore.fail(state.id, error, currentIncomplete(procedure.steps, state.completedSteps));
    }
  }

  async runStep(step, runtime, options) {
    const args = resolveValue(step.args ?? step.input ?? {}, runtime);
    if (step.kind === 'tool') {
      const name = String(step.tool || '');
      const fn = this.tools[name];
      if (typeof fn !== 'function') throw new Error('SKILL_TOOL_UNAVAILABLE:' + name);
      return await fn(args, { step, runtime, options });
    }

    if (step.kind === 'script') {
      const name = String(step.script || '');
      const fn = this.scripts[name];
      if (typeof fn !== 'function') throw new Error('SKILL_SCRIPT_UNAVAILABLE:' + name);
      return await fn(args, { step, runtime, options });
    }

    if (step.kind === 'model') {
      if (typeof this.model !== 'function') throw new Error('SKILL_MODEL_UNAVAILABLE');
      return await this.model({ prompt: resolveValue(step.prompt || '', runtime), input: args, step, context: runtime.context });
    }

    if (step.kind === 'skill') {
      const childId = String(resolveValue(step.skill || '', runtime));
      const childInput = resolveValue(step.input || {}, runtime);
      const child = await this.execute(childId, childInput, { ...options, depth: options.depth + 1, runId: null, parentRunId: options.parentRunId });
      if (child.status !== 'COMPLETED') throw new Error('SKILL_CHILD_FAILED:' + childId + ':' + (child.error || child.status));
      return child.result;
    }

    if (step.kind === 'assert') {
      const actual = resolveValue(step.actual, runtime);
      const expected = resolveValue(step.equals, runtime);
      if (!deepEqual(actual, expected)) throw new Error('SKILL_ASSERTION_FAILED:' + step.id);
      return { passed: true, actual };
    }

    if (step.kind === 'return') return resolveValue(step.value ?? step.output ?? null, runtime);
    throw new Error('SKILL_UNSUPPORTED_STEP_KIND:' + step.kind);
  }
}

function currentIncomplete(steps, completed) {
  return steps.find(step => !completed.includes(step.id))?.id || null;
}

function matchesWhen(condition, runtime) {
  if (!condition) return true;
  const actual = resolveValue(condition.ref, runtime);
  if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return deepEqual(actual, resolveValue(condition.equals, runtime));
  if (Object.prototype.hasOwnProperty.call(condition, 'notEquals')) return !deepEqual(actual, resolveValue(condition.notEquals, runtime));
  return Boolean(actual);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function resolveValue(value, runtime) {
  if (Array.isArray(value)) return value.map(item => resolveValue(item, runtime));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, runtime)]));
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  const parts = value.slice(1).split('.').filter(Boolean);
  let cursor = runtime;
  for (const part of parts) {
    if (cursor === null || cursor === undefined || !Object.prototype.hasOwnProperty.call(Object(cursor), part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}
