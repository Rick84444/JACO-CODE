import path from 'node:path';
import { SkillIndex } from './skillIndex.mjs';
import { SkillRunStore } from './skillRunStore.mjs';
import { SkillExecutor } from './skillExecutor.mjs';
import { SkillCompiler } from './skillCompiler.mjs';
import { SkillTelemetry } from './skillTelemetry.mjs';
import { JitPlanCache, TargetCompiler } from './targetCompiler.mjs';
import { SkillMachine } from './skillMachine.mjs';
import { ExecutionProfiler } from './executionProfiler.mjs';
import { AdaptiveSkillOptimizer } from './adaptiveSkillOptimizer.mjs';

export class SkillRuntime {
  constructor({
    workspaceRoot = process.cwd(),
    skillRoots = null,
    tools = {},
    scripts = {},
    model = null,
    adapters = [],
    telemetrySink = null,
    evidenceValidator = null,
  } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.skillsRoot = path.join(this.workspaceRoot, '.jaco', 'skills-runtime');
    this.index = new SkillIndex({ roots: skillRoots || [this.skillsRoot] });
    this.runStore = new SkillRunStore(path.join(this.workspaceRoot, '.jaco', 'skill-runs'));
    this.executor = new SkillExecutor({ index: this.index, runStore: this.runStore, tools, scripts, model });
    this.compiler = new SkillCompiler({ skillsRoot: this.skillsRoot });

    this.telemetry = new SkillTelemetry();
    this.jitCache = new JitPlanCache(path.join(this.workspaceRoot, '.jaco', 'skill-jit-cache.json'));
    this.targetCompiler = new TargetCompiler({ adapters, cache: this.jitCache });
    this.profiler = new ExecutionProfiler({
      file: path.join(this.workspaceRoot, '.jaco', 'skill-execution-traces.jsonl'),
      telemetrySink,
    });
    this.machine = new SkillMachine({
      runtime: this,
      targetCompiler: this.targetCompiler,
      telemetry: this.telemetry,
      profiler: this.profiler,
    });
    this.optimizer = new AdaptiveSkillOptimizer({
      profiler: this.profiler,
      targetCompiler: this.targetCompiler,
      storeFile: path.join(this.workspaceRoot, '.jaco', 'skill-optimizer.json'),
      evidenceValidator,
    });
  }

  refresh() {
    return this.index.refresh();
  }

  search(query, options = {}) {
    return this.index.search(query, options);
  }

  inspect(id) {
    return this.index.getDescriptor(id);
  }

  loadInstructions(id) {
    return this.index.loadInstructions(id);
  }

  async execute(id, input = {}, options = {}) {
    return await this.executor.execute(id, input, options);
  }

  compileCandidate(spec) {
    const result = this.compiler.compileFromTrajectories(spec);
    this.refresh();
    return result;
  }

  resume(runId, options = {}) {
    const state = this.runStore.load(runId);
    return this.execute(state.skillId, state.input, { ...options, runId });
  }

  registerAdapter(adapter) {
    this.targetCompiler.registerAdapter(adapter);
    return this;
  }

  linkCapability(spec) {
    return this.machine.link(spec);
  }

  executeCapability(spec, input = {}, options = {}) {
    return this.machine.executeCapability(spec, input, options);
  }

  executeIR(ir, input = {}, options = {}) {
    return this.machine.executeIR(ir, input, options);
  }

  discoverOptimizationFamilies(options = {}) {
    return this.optimizer.discoverFamilies(options);
  }

  createOptimizationCandidate(spec) {
    return this.optimizer.createCandidate(spec);
  }

  evaluateOptimizationCandidate(spec) {
    return this.optimizer.evaluateCandidate(spec);
  }

  promoteOptimizationCandidate(candidateId, benchmarkId = null) {
    return this.optimizer.promote(candidateId, benchmarkId);
  }

  skillMachineSnapshot(options = {}) {
    const snapshot = this.telemetry.snapshot(options);
    const skills = this.index.list();
    return {
      ...snapshot,
      catalog: {
        count: skills.length,
        active: skills.filter(skill => skill.status === 'ACTIVE').length,
        candidate: skills.filter(skill => skill.status === 'CANDIDATE').length,
      },
      jit: this.jitCache.stats(),
      optimizer: this.optimizer.snapshot(),
    };
  }
}

export function createSkillRuntime(options = {}) {
  return new SkillRuntime(options);
}
