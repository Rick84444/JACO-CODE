import crypto from 'node:crypto';
import { resolveValue } from './skillExecutor.mjs';
import { CapabilityLinker } from './capabilityLinker.mjs';
import { normalizeSkillIR } from './skillIR.mjs';

export class SkillMachine {
  constructor({ runtime, targetCompiler, telemetry, profiler = null }) {
    if (!runtime || !targetCompiler || !telemetry) throw new Error('SKILL_MACHINE_DEPENDENCY_REQUIRED');
    this.runtime = runtime;
    this.targetCompiler = targetCompiler;
    this.telemetry = telemetry;
    this.profiler = profiler;
    this.linker = new CapabilityLinker({ index: runtime.index });
  }

  link(spec) {
    const linked = this.linker.link(spec);
    this.telemetry.emit('skill.linked', {
      capabilityId: linked.ir.id,
      selectedSkills: linked.selected.map(item => item.skillId),
      nodeCount: linked.nodes.length,
    });
    return linked;
  }

  async executeCapability(spec, input = {}, options = {}) {
    const linked = this.link(spec);
    return await this.executeIR(linked.ir, input, options);
  }

  async executeIR(irInput, input = {}, {
    environment = {},
    context = {},
    maxDeopts = 3,
    verification = null,
    evidenceRefs = [],
    metrics = {},
  } = {}) {
    const ir = normalizeSkillIR(irInput);
    const executionId = 'skillmachine-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const runtimeState = { input, ops: {}, context, environment };
    let excluded = [];
    let deopts = 0;
    let plan = this.targetCompiler.compile(ir, { environment, excluded });

    this.profiler?.begin({ executionId, ir, environment, plan });
    this.telemetry.emit('skill.started', {
      executionId, irId: ir.id, planId: plan.id, cacheHit: plan.cacheHit,
    });
    this.telemetry.emit('skill.compiled', {
      executionId, irId: ir.id, planId: plan.id, cacheHit: plan.cacheHit,
      backends: plan.operations.map(item => ({ operationId: item.instruction.id, op: item.instruction.op, backend: item.backend })),
    });

    try {
      for (let index = 0; index < plan.operations.length; index++) {
        let planned = plan.operations[index];
        const instruction = planned.instruction;
        let output;

        while (true) {
          try {
            output = await this.executeOperation(planned, runtimeState, executionId);
            break;
          } catch (error) {
            if (!isDeopt(error) || deopts >= maxDeopts || planned.backend === 'runtime') throw error;
            deopts++;
            this.profiler?.deoptimized(executionId);
            const failed = instruction.id + ':' + planned.backend;
            excluded = [...new Set([...excluded, failed])];
            const reason = error instanceof Error ? error.message : String(error);
            this.targetCompiler.deopt(ir, environment, { reason, operationId: instruction.id, backend: planned.backend });
            this.telemetry.emit('skill.deoptimized', {
              executionId,
              irId: ir.id,
              operationId: instruction.id,
              failedBackend: planned.backend,
              reason,
              deopts,
            });
            plan = this.targetCompiler.compile(ir, { environment, excluded });
            planned = plan.operations.find(item => item.instruction.id === instruction.id);
            if (!planned) throw new Error('SKILL_DEOPT_RECOMPILE_LOST_OPERATION:' + instruction.id);
            this.telemetry.emit('skill.recompiled', {
              executionId,
              operationId: instruction.id,
              backend: planned.backend,
              deopts,
            });
          }
        }

        runtimeState.ops[instruction.id] = output;
        if (instruction.op === 'RETURN') {
          this.telemetry.emit('skill.completed', { executionId, irId: ir.id, deopts });
          this.profiler?.finish(executionId, { status: 'COMPLETED', verification, evidenceRefs, extraMetrics: metrics });
          return {
            schema: 'jaco.skill-machine.result/v1',
            executionId,
            status: 'COMPLETED',
            output,
            deopts,
            plan,
          };
        }
      }

      const output = runtimeState.ops[ir.operations.at(-1).id] ?? null;
      this.telemetry.emit('skill.completed', { executionId, irId: ir.id, deopts });
      this.profiler?.finish(executionId, { status: 'COMPLETED', verification, evidenceRefs, extraMetrics: metrics });
      return { schema: 'jaco.skill-machine.result/v1', executionId, status: 'COMPLETED', output, deopts, plan };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.telemetry.emit('skill.failed', { executionId, irId: ir.id, deopts, error: message });
      this.profiler?.finish(executionId, { status: 'FAILED', verification, evidenceRefs, extraMetrics: metrics });
      return { schema: 'jaco.skill-machine.result/v1', executionId, status: 'FAILED', error: message, deopts, plan };
    }
  }

  async executeOperation(planned, runtimeState, executionId) {
    const instruction = planned.instruction;
    const resolvedTarget = resolveValue(instruction.target, runtimeState);
    const resolvedInput = resolveValue(instruction.input, runtimeState);

    this.profiler?.operationStarted(executionId, {
      instruction,
      backend: planned.backend,
      target: resolvedTarget,
      input: resolvedInput,
    });
    this.telemetry.emit('skill.operation.started', {
      executionId, operationId: instruction.id, op: instruction.op, backend: planned.backend,
    });

    try {
      let output;
      if (instruction.op === 'CALL') {
        const skillId = String(resolvedTarget);
        const child = await this.runtime.execute(skillId, resolvedInput, {});
        if (child.status !== 'COMPLETED') throw new Error('SKILL_CALL_FAILED:' + skillId + ':' + (child.error || child.status));
        output = child.result;
      } else if (instruction.op === 'RETURN') {
        output = resolvedInput;
      } else if (instruction.op === 'ASSERT') {
        const actual = resolveValue(instruction.input?.actual, runtimeState);
        const expected = resolveValue(instruction.input?.equals, runtimeState);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('SKILL_IR_ASSERTION_FAILED:' + instruction.id);
        output = { passed: true, actual };
      } else {
        const adapter = this.targetCompiler.adapter(planned.backend);
        if (!adapter) throw new Error('SKILL_BACKEND_UNAVAILABLE:' + planned.backend);
        output = await adapter.execute({
          ...instruction,
          input: resolvedInput,
          target: resolvedTarget,
        }, { runtimeState, executionId });
      }

      this.profiler?.operationCompleted(executionId, instruction.id, output);
      this.telemetry.emit('skill.operation.completed', {
        executionId, operationId: instruction.id, op: instruction.op, backend: planned.backend,
      });
      return output;
    } catch (error) {
      this.profiler?.operationFailed(executionId, instruction.id, error);
      throw error;
    }
  }
}

export class SkillDeoptError extends Error {
  constructor(message = 'backend assumption invalidated') {
    super('SKILL_DEOPT:' + message);
    this.name = 'SkillDeoptError';
    this.code = 'SKILL_DEOPT';
  }
}

function isDeopt(error) {
  return error?.code === 'SKILL_DEOPT' || String(error?.message || error).startsWith('SKILL_DEOPT:');
}
