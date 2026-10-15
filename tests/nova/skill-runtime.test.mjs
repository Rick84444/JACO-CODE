import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRuntime } from '../../runtime/src/server/skills/skillRuntime.mjs';
import { SkillDeoptError } from '../../runtime/src/server/skills/skillMachine.mjs';
import { ContinuumRuntime } from '../../runtime/src/server/continuum/continuumRuntime.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-skill-runtime-'));
}

function writeSkill(root, manifest, procedure, instructions = 'SECRET-INSTRUCTIONS') {
  const folder = path.join(root, '.jaco', 'skills-runtime', manifest.id);
  fs.mkdirSync(path.join(folder, 'procedures'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'skill.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(folder, 'SKILL.md'), instructions);
  fs.writeFileSync(path.join(folder, 'procedures', 'main.json'), JSON.stringify(procedure, null, 2));
}

test('skill search uses compact metadata and instructions load just in time', () => {
  const root = tmp();
  writeSkill(root, {
    id: 'git.repair', version: '1.0.0', name: 'Git Repair', description: 'Repair broken git repositories and builds.',
    status: 'ACTIVE', intents: ['repair_repository'], tags: ['git'], substrates: ['terminal'], dependencies: [],
    entrypoints: { main: 'procedures/main.json' },
  }, { schema: 'jaco.skill.procedure.v1', id: 'main', steps: [{ id: 'done', kind: 'return', value: { ok: true } }] });
  const runtime = new SkillRuntime({ workspaceRoot: root });
  const matches = runtime.search('repair repository');
  assert.equal(matches[0].id, 'git.repair');
  assert.equal(JSON.stringify(matches).includes('SECRET-INSTRUCTIONS'), false);
  assert.equal(runtime.loadInstructions('git.repair'), 'SECRET-INSTRUCTIONS');
});

test('executor composes skills and returns child output', async () => {
  const root = tmp();
  writeSkill(root, {
    id: 'math.double', version: '1.0.0', name: 'Double Number', description: 'Double a numeric input deterministically.',
    status: 'ACTIVE', intents: ['double_number'], tags: [], substrates: ['runtime'], dependencies: [],
    entrypoints: { main: 'procedures/main.json' },
  }, { schema: 'jaco.skill.procedure.v1', id: 'main', steps: [
    { id: 'double', kind: 'script', script: 'double', args: { value: '$input.value' } },
    { id: 'done', kind: 'return', value: '$steps.double' },
  ]});
  writeSkill(root, {
    id: 'math.pipeline', version: '1.0.0', name: 'Double Pipeline', description: 'Compose a child arithmetic skill.',
    status: 'ACTIVE', intents: ['pipeline'], tags: [], substrates: ['runtime'], dependencies: ['math.double'],
    entrypoints: { main: 'procedures/main.json' },
  }, { schema: 'jaco.skill.procedure.v1', id: 'main', steps: [
    { id: 'child', kind: 'skill', skill: 'math.double', input: { value: '$input.value' } },
    { id: 'done', kind: 'return', value: '$steps.child' },
  ]});
  const runtime = new SkillRuntime({ workspaceRoot: root, scripts: { double: ({ value }) => ({ value: value * 2 }) } });
  const run = await runtime.execute('math.pipeline', { value: 7 });
  assert.equal(run.status, 'COMPLETED');
  assert.deepEqual(run.result, { value: 14 });
});

test('durable execution resumes without repeating completed side effects', async () => {
  const root = tmp();
  let writes = 0;
  let allowVerify = false;
  writeSkill(root, {
    id: 'durable.demo', version: '1.0.0', name: 'Durable Demo', description: 'Demonstrate checkpointed skill execution and resume.',
    status: 'ACTIVE', intents: ['durable_demo'], tags: [], substrates: ['runtime'], dependencies: [],
    entrypoints: { main: 'procedures/main.json' },
  }, { schema: 'jaco.skill.procedure.v1', id: 'main', steps: [
    { id: 'write', kind: 'tool', tool: 'write', args: { value: '$input.value' } },
    { id: 'verify', kind: 'tool', tool: 'verify', args: {} },
    { id: 'done', kind: 'return', value: '$steps.write' },
  ]});
  const runtime = new SkillRuntime({ workspaceRoot: root, tools: {
    write: ({ value }) => { writes++; return { value }; },
    verify: () => { if (!allowVerify) throw new Error('not yet'); return { ok: true }; },
  }});
  const first = await runtime.execute('durable.demo', { value: 42 }, { runId: 'resume-case' });
  assert.equal(first.status, 'FAILED');
  assert.equal(writes, 1);
  allowVerify = true;
  const second = await runtime.resume('resume-case');
  assert.equal(second.status, 'COMPLETED');
  assert.equal(writes, 1);
  assert.deepEqual(second.result, { value: 42 });
});

test('compiler distills repeated trajectories into parameterized candidate skill', () => {
  const root = tmp();
  const runtime = new SkillRuntime({ workspaceRoot: root });
  const result = runtime.compileCandidate({
    id: 'http.fetch', name: 'HTTP Fetch', description: 'Fetch an HTTP resource through an injected runtime tool.',
    intents: ['fetch_url'], tags: ['http'], substrates: ['api'],
    trajectories: [
      { success: true, evidenceRefs: ['e1'], actions: [{ kind: 'tool', tool: 'http.fetch', args: { url: 'https://one.test', method: 'GET' } }] },
      { success: true, evidenceRefs: ['e2'], actions: [{ kind: 'tool', tool: 'http.fetch', args: { url: 'https://two.test', method: 'GET' } }] },
    ],
  });
  assert.equal(result.manifest.status, 'CANDIDATE');
  assert.equal(result.procedure.steps[0].args.method, 'GET');
  assert.equal(result.procedure.steps[0].args.url, '$input.step_1_url');
  assert.deepEqual(result.manifest.provenance.evidenceRefs, ['e1', 'e2']);
  assert.equal(runtime.search('fetch url')[0].id, 'http.fetch');
});

test('candidate skills do not execute unless explicitly allowed', async () => {
  const root = tmp();
  const runtime = new SkillRuntime({ workspaceRoot: root, tools: { noop: () => ({ ok: true }) } });
  runtime.compileCandidate({
    id: 'candidate.demo', name: 'Candidate Demo', description: 'Candidate skill must not silently become active.',
    intents: ['candidate_demo'], trajectories: [
      { success: true, actions: [{ kind: 'tool', tool: 'noop', args: {} }] },
      { success: true, actions: [{ kind: 'tool', tool: 'noop', args: {} }] },
    ],
  });
  await assert.rejects(() => runtime.execute('candidate.demo', {}), /SKILL_NOT_ACTIVE/);
});


test('capability linker resolves dependencies into deterministic Skill IR', () => {
  const root = tmp();
  writeSkill(root, {
    id: 'test.run', version: '1.0.0', name: 'Run Tests', description: 'Run the repository verification suite.',
    status: 'ACTIVE', intents: ['run_tests'], tags: ['test'], substrates: ['terminal'], dependencies: [],
    entrypoints: { main: 'procedures/main.json' },
  }, { schema: 'jaco.skill.procedure.v1', id: 'main', steps: [{ id: 'done', kind: 'return', value: { passed: true } }] });
  writeSkill(root, {
    id: 'deploy.web', version: '1.0.0', name: 'Deploy Web', description: 'Deploy an application after repository tests succeed.',
    status: 'ACTIVE', intents: ['deploy_application'], tags: ['deploy'], substrates: ['api'], dependencies: ['test.run'],
    entrypoints: { main: 'procedures/main.json' },
  }, { schema: 'jaco.skill.procedure.v1', id: 'main', steps: [{ id: 'done', kind: 'return', value: { deployed: true } }] });

  const runtime = new SkillRuntime({ workspaceRoot: root });
  const linked = runtime.linkCapability({
    id: 'release.application',
    goal: 'test and deploy application',
    requirements: ['deploy_application'],
  });

  assert.deepEqual(linked.order, ['test.run', 'deploy.web']);
  assert.deepEqual(linked.ir.operations.map(op => op.op), ['CALL', 'CALL', 'RETURN']);
  assert.equal(linked.ir.metadata.graph.nodes.length, 2);
});

test('Skill Machine deoptimizes a failed fast path and learns the fallback for the environment', async () => {
  const root = tmp();
  let apiCalls = 0;
  let terminalCalls = 0;
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [
      {
        id: 'api',
        priority: 10,
        cost: 1,
        operations: ['WRITE'],
        substrates: ['api'],
        execute: async () => {
          apiCalls++;
          throw new SkillDeoptError('API route disappeared');
        },
      },
      {
        id: 'terminal',
        priority: 5,
        cost: 2,
        operations: ['WRITE'],
        substrates: ['terminal'],
        execute: async instruction => {
          terminalCalls++;
          return { backend: 'terminal', target: instruction.target, content: instruction.input.content };
        },
      },
    ],
  });

  const ir = {
    schema: 'jaco.skill.ir.v1',
    id: 'write.document',
    version: '1.0.0',
    goal: 'write a document using the best available backend',
    operations: [
      { id: 'write', op: 'WRITE', target: 'demo.txt', input: { content: '$input.content' } },
      { id: 'result', op: 'RETURN', input: '$ops.write' },
    ],
  };
  const environment = { host: 'test-machine', appVersion: '1' };

  const first = await runtime.executeIR(ir, { content: 'hello' }, { environment });
  assert.equal(first.status, 'COMPLETED');
  assert.equal(first.deopts, 1);
  assert.equal(first.output.backend, 'terminal');
  assert.equal(apiCalls, 1);
  assert.equal(terminalCalls, 1);

  const second = await runtime.executeIR(ir, { content: 'again' }, { environment });
  assert.equal(second.status, 'COMPLETED');
  assert.equal(second.deopts, 0);
  assert.equal(second.output.backend, 'terminal');
  assert.equal(apiCalls, 1);
  assert.equal(terminalCalls, 2);

  const snapshot = runtime.skillMachineSnapshot();
  assert.equal(snapshot.schema, 'jaco.skill-machine.snapshot/v1');
  assert.equal(snapshot.jit.deopts, 1);
  assert.equal(snapshot.jit.blockedBackends, 1);
  assert.equal(snapshot.recentEvents.some(event => event.type === 'skill.deoptimized'), true);
});

test('Skill Machine JIT cache is reused when assumptions remain valid', async () => {
  const root = tmp();
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [{
      id: 'api',
      priority: 10,
      cost: 1,
      operations: ['READ'],
      substrates: ['api'],
      execute: async instruction => ({ value: 'ok:' + instruction.target }),
    }],
  });
  const ir = {
    id: 'read.health',
    operations: [
      { id: 'read', op: 'READ', target: '/health' },
      { id: 'result', op: 'RETURN', input: '$ops.read' },
    ],
  };
  const environment = { host: 'stable-host' };

  const first = await runtime.executeIR(ir, {}, { environment });
  const second = await runtime.executeIR(ir, {}, { environment });

  assert.equal(first.status, 'COMPLETED');
  assert.equal(second.status, 'COMPLETED');
  assert.equal(second.plan.cacheHit, true);
});


test('Adaptive Skill Optimizer mines verified procedure families and promotes only a verified faster specialization', async () => {
  const root = tmp();
  const verification = {
    outcome: 'VERIFIED',
    preconditionsVerified: true,
    postconditionsVerified: true,
    independent: true,
  };

  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [
      {
        id: 'slow-native',
        priority: 10,
        cost: 5,
        operations: ['WRITE'],
        substrates: ['native'],
        available: (environment, instruction) => environment.mode === 'same' && instruction.target === '$environment.path',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return { ok: true, backend: 'slow-native' };
        },
      },
      {
        id: 'fast-api',
        priority: 10,
        cost: 1,
        operations: ['WRITE'],
        substrates: ['api'],
        available: (environment, instruction) => environment.mode === 'same' && instruction.target === '/tmp/demo.txt',
        execute: async () => ({ ok: true, backend: 'fast-api' }),
      },
    ],
  });

  const ir = {
    schema: 'jaco.skill.ir.v1',
    id: 'optimizer.write',
    version: '1.0.0',
    goal: 'write the same semantic artifact through the best backend',
    operations: [
      { id: 'write', op: 'WRITE', target: '$environment.path', input: { content: '$input.content' } },
      { id: 'result', op: 'RETURN', input: '$ops.write' },
    ],
  };

  for (let index = 0; index < 3; index++) {
    const run = await runtime.executeIR(ir, { content: 'baseline-' + index }, {
      environment: { mode: 'same', path: '/tmp/demo.txt' },
      verification,
      evidenceRefs: ['baseline-proof-' + index],
    });
    assert.equal(run.status, 'COMPLETED');
  }

  const families = runtime.discoverOptimizationFamilies({
    minimumVerified: 3,
    minimumIndependentEvidence: 3,
  });
  assert.equal(families.length, 1);
  assert.equal(families[0].verifiedRuns, 3);
  assert.equal(families[0].independentEvidenceSets, 3);

  const candidate = runtime.createOptimizationCandidate({
    familyId: families[0].id,
    ir,
    environment: { mode: 'same', path: '/tmp/demo.txt' },
    environmentBindings: { path: '/tmp/demo.txt' },
    label: 'fast-api specialization',
  });
  assert.equal(candidate.status, 'CANDIDATE');
  assert.equal(candidate.specializedIR.operations[0].target, '/tmp/demo.txt');
  assert.equal(candidate.specializedIR.operations[0].input.content, '$input.content');
  assert.equal(candidate.scope, 'ENVIRONMENT');
  assert.equal(candidate.promotable, true);

  const candidateRun = await runtime.executeIR(candidate.specializedIR, { content: 'candidate' }, {
    environment: { mode: 'same', path: '/tmp/demo.txt' },
    verification,
    evidenceRefs: ['candidate-independent-proof'],
  });
  assert.equal(candidateRun.status, 'COMPLETED');

  const baselineTrace = runtime.profiler.list({ irId: ir.id, verifiedOnly: true }).at(-1);
  const candidateTrace = runtime.profiler.list({ irId: candidate.specializedIR.id, verifiedOnly: true }).at(-1);
  const benchmark = runtime.evaluateOptimizationCandidate({
    candidateId: candidate.id,
    baselineTraceId: baselineTrace.traceId,
    candidateTraceId: candidateTrace.traceId,
    requiredOperations: ['write', 'result'],
  });

  assert.equal(benchmark.verification.outcome, 'VERIFIED');
  assert.equal(benchmark.decision, 'VERIFIED_BETTER');

  const promoted = runtime.promoteOptimizationCandidate(candidate.id, benchmark.id);
  assert.equal(promoted.status, 'PROMOTED');

  const snapshot = runtime.skillMachineSnapshot();
  assert.equal(snapshot.optimizer.promoted, 1);
  assert.equal(snapshot.optimizer.profiler.verified, 4);
});

test('optimizer refuses promotion without independent process verification', async () => {
  const root = tmp();
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [{
      id: 'api',
      priority: 10,
      cost: 1,
      operations: ['READ'],
      substrates: ['api'],
      execute: async () => ({ ok: true }),
    }],
  });

  const ir = {
    id: 'optimizer.verify-boundary',
    operations: [
      { id: 'read', op: 'READ', target: '/health' },
      { id: 'result', op: 'RETURN', input: '$ops.read' },
    ],
  };
  const verified = {
    outcome: 'VERIFIED',
    preconditionsVerified: true,
    postconditionsVerified: true,
    independent: true,
  };

  for (let index = 0; index < 3; index++) {
    await runtime.executeIR(ir, {}, {
      environment: { host: 'same-host' },
      verification: verified,
      evidenceRefs: ['proof-' + index],
    });
  }
  const family = runtime.discoverOptimizationFamilies({
    minimumVerified: 3,
    minimumIndependentEvidence: 3,
  })[0];
  const candidate = runtime.createOptimizationCandidate({
    familyId: family.id,
    ir,
    environment: { host: 'same-host' },
  });

  await runtime.executeIR(candidate.specializedIR, {}, {
    environment: { host: 'same-host' },
    verification: { ...verified, independent: false },
    evidenceRefs: ['self-proof'],
  });

  const baselineTrace = runtime.profiler.list({ irId: ir.id, verifiedOnly: true }).at(-1);
  const candidateTrace = runtime.profiler.list({ irId: candidate.specializedIR.id }).at(-1);
  const benchmark = runtime.evaluateOptimizationCandidate({
    candidateId: candidate.id,
    baselineTraceId: baselineTrace.traceId,
    candidateTraceId: candidateTrace.traceId,
  });

  assert.equal(benchmark.decision, 'REJECTED');
  assert.equal(benchmark.verification.reasons.includes('CANDIDATE_NOT_VERIFIED'), true);
  assert.throws(() => runtime.promoteOptimizationCandidate(candidate.id, benchmark.id), /PROMOTION_REQUIRES_VERIFIED_BETTER/);
});


test('ContinuumRuntime is the single production owner of the canonical Skill Runtime snapshot', () => {
  const root = tmp();
  const browserSessions = {
    snapshot: () => ({ attached: false, cdpPort: null, urlIncludes: null, attachedAt: null }),
    getClient: () => null,
    targets: async () => [],
    attach: async () => ({ attached: false }),
    detach: async () => {},
  };

  const runtime = new ContinuumRuntime({ workspaceRoot: root, browserSessions });
  const status = runtime.status();

  assert.equal(status.skills.schema, 'jaco.skill-machine.snapshot/v1');
  assert.equal(status.skills.optimizer.schema, 'jaco.skill-optimizer.snapshot/v1');
  assert.equal(status.truth.canonicalSkillRuntimeOwner, 'CONTINUUM_RUNTIME');
  assert.equal(runtime.skills.workspaceRoot, path.resolve(root));
});


test('execution profiler never persists raw operation inputs or targets', async () => {
  const root = tmp();
  const secret = 'sk-live-super-secret-value';
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [{
      id: 'safe-api',
      priority: 10,
      cost: 1,
      operations: ['WRITE'],
      substrates: ['api'],
      execute: async () => ({ ok: true }),
    }],
  });

  const ir = {
    id: 'privacy.trace',
    operations: [
      { id: 'write', op: 'WRITE', target: '/private/workspace/secret.txt', input: { token: '$input.token', url: '$input.url' } },
      { id: 'result', op: 'RETURN', input: '$ops.write' },
    ],
  };

  const run = await runtime.executeIR(ir, {
    token: secret,
    url: 'https://internal.example/private',
  });
  assert.equal(run.status, 'COMPLETED');

  const traceFile = path.join(root, '.jaco', 'skill-execution-traces.jsonl');
  const raw = fs.readFileSync(traceFile, 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes('/private/workspace/secret.txt'), false);
  assert.equal(raw.includes('https://internal.example/private'), false);
  assert.equal(raw.includes('{{path}}'), true);
  assert.equal(raw.includes('{{url}}'), true);

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(traceFile).mode & 0o777, 0o600);
  }
});

test('procedural families require full independent pre/post verification', async () => {
  const root = tmp();
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [{
      id: 'api',
      priority: 10,
      cost: 1,
      operations: ['READ'],
      substrates: ['api'],
      execute: async () => ({ ok: true }),
    }],
  });
  const ir = {
    id: 'family.verification',
    operations: [
      { id: 'read', op: 'READ', target: '/health' },
      { id: 'result', op: 'RETURN', input: '$ops.read' },
    ],
  };

  for (let index = 0; index < 3; index++) {
    await runtime.executeIR(ir, {}, {
      environment: { host: 'same' },
      verification: {
        outcome: 'VERIFIED',
        preconditionsVerified: true,
        postconditionsVerified: true,
        independent: false,
      },
      evidenceRefs: ['not-independent-' + index],
    });
  }

  assert.deepEqual(runtime.discoverOptimizationFamilies({
    minimumVerified: 3,
    minimumIndependentEvidence: 3,
  }), []);
});

test('optimizer rejects cross-environment speed comparisons', async () => {
  const root = tmp();
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [{
      id: 'api',
      priority: 10,
      cost: 1,
      operations: ['READ'],
      substrates: ['api'],
      execute: async () => ({ ok: true }),
    }],
  });
  const ir = {
    id: 'environment.compare',
    operations: [
      { id: 'read', op: 'READ', target: '/health' },
      { id: 'result', op: 'RETURN', input: '$ops.read' },
    ],
  };
  const verification = {
    outcome: 'VERIFIED',
    preconditionsVerified: true,
    postconditionsVerified: true,
    independent: true,
  };

  for (let index = 0; index < 3; index++) {
    await runtime.executeIR(ir, {}, {
      environment: { host: 'a' },
      verification,
      evidenceRefs: ['env-proof-' + index],
    });
  }
  const family = runtime.discoverOptimizationFamilies({
    minimumVerified: 3,
    minimumIndependentEvidence: 3,
  })[0];

  const candidate = runtime.createOptimizationCandidate({
    familyId: family.id,
    ir,
    environment: { host: 'b' },
  });
  await runtime.executeIR(candidate.specializedIR, {}, {
    environment: { host: 'b' },
    verification,
    evidenceRefs: ['candidate-env-proof'],
  });

  const baselineTrace = runtime.profiler.list({ irId: ir.id }).at(-1);
  const candidateTrace = runtime.profiler.list({ irId: candidate.specializedIR.id }).at(-1);
  const benchmark = runtime.evaluateOptimizationCandidate({
    candidateId: candidate.id,
    baselineTraceId: baselineTrace.traceId,
    candidateTraceId: candidateTrace.traceId,
  });

  assert.equal(benchmark.decision, 'REJECTED');
  assert.deepEqual(benchmark.benchmarkReasons, ['ENVIRONMENT_FINGERPRINT_CHANGED']);
});

test('instance-bound partial evaluation can be benchmarked but never promoted globally', async () => {
  const root = tmp();
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [
      {
        id: 'generic',
        priority: 10,
        cost: 5,
        operations: ['WRITE'],
        substrates: ['api'],
        available: (_environment, instruction) => instruction.input?.content === '$input.content',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 15));
          return { ok: true };
        },
      },
      {
        id: 'constant-fast-path',
        priority: 20,
        cost: 1,
        operations: ['WRITE'],
        substrates: ['api'],
        available: (_environment, instruction) => instruction.input?.content === 'constant',
        execute: async () => ({ ok: true }),
      },
    ],
  });
  const verification = {
    outcome: 'VERIFIED',
    preconditionsVerified: true,
    postconditionsVerified: true,
    independent: true,
  };
  const ir = {
    id: 'instance.specialization',
    operations: [
      { id: 'write', op: 'WRITE', target: '/tmp/x', input: { content: '$input.content' } },
      { id: 'result', op: 'RETURN', input: '$ops.write' },
    ],
  };

  for (let index = 0; index < 3; index++) {
    await runtime.executeIR(ir, { content: 'value-' + index }, {
      environment: { host: 'same' },
      verification,
      evidenceRefs: ['instance-base-' + index],
    });
  }
  const family = runtime.discoverOptimizationFamilies({
    minimumVerified: 3,
    minimumIndependentEvidence: 3,
  })[0];
  const candidate = runtime.createOptimizationCandidate({
    familyId: family.id,
    ir,
    environment: { host: 'same' },
    inputBindings: { content: 'constant' },
  });
  assert.equal(candidate.scope, 'INSTANCE');
  assert.equal(candidate.promotable, false);

  await runtime.executeIR(candidate.specializedIR, {}, {
    environment: { host: 'same' },
    verification,
    evidenceRefs: ['instance-candidate-proof'],
  });

  const benchmark = runtime.evaluateOptimizationCandidate({
    candidateId: candidate.id,
    baselineTraceId: runtime.profiler.list({ irId: ir.id }).at(-1).traceId,
    candidateTraceId: runtime.profiler.list({ irId: candidate.specializedIR.id }).at(-1).traceId,
  });
  assert.equal(benchmark.decision, 'VERIFIED_BETTER');
  assert.throws(
    () => runtime.promoteOptimizationCandidate(candidate.id, benchmark.id),
    /INSTANCE_SCOPE_NOT_PROMOTABLE/,
  );
});

test('production evidence validator excludes fabricated evidence from optimization families', async () => {
  const root = tmp();
  const valid = new Set(['real-1', 'real-2', 'real-3']);
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    evidenceValidator: refs => {
      for (const ref of refs) if (!valid.has(ref)) throw new Error('not in ledger');
    },
    adapters: [{
      id: 'api',
      priority: 10,
      cost: 1,
      operations: ['READ'],
      substrates: ['api'],
      execute: async () => ({ ok: true }),
    }],
  });
  const ir = {
    id: 'evidence.boundary',
    operations: [
      { id: 'read', op: 'READ', target: '/health' },
      { id: 'result', op: 'RETURN', input: '$ops.read' },
    ],
  };
  const verification = {
    outcome: 'VERIFIED',
    preconditionsVerified: true,
    postconditionsVerified: true,
    independent: true,
  };

  for (let index = 0; index < 3; index++) {
    await runtime.executeIR(ir, {}, {
      environment: { host: 'same' },
      verification,
      evidenceRefs: ['fabricated-' + index],
    });
  }

  assert.deepEqual(runtime.discoverOptimizationFamilies({
    minimumVerified: 3,
    minimumIndependentEvidence: 3,
  }), []);
});

test('output fingerprinting tolerates circular objects and bigint without breaking execution', async () => {
  const root = tmp();
  const runtime = new SkillRuntime({
    workspaceRoot: root,
    adapters: [{
      id: 'api',
      priority: 10,
      cost: 1,
      operations: ['READ'],
      substrates: ['api'],
      execute: async () => {
        const result = { count: 1n };
        result.self = result;
        return result;
      },
    }],
  });
  const run = await runtime.executeIR({
    id: 'fingerprint.robustness',
    operations: [
      { id: 'read', op: 'READ', target: '/health' },
      { id: 'result', op: 'RETURN', input: { ok: true } },
    ],
  });
  assert.equal(run.status, 'COMPLETED');
  assert.equal(runtime.profiler.snapshot().profileErrors, 0);
});
