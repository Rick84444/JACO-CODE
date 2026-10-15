import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { buildSelfDevelopmentGraph } from '../src/seer-self-development.mjs';
import { createMissionGraph } from '../src/seer-mission-graph.mjs';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';
import { checkedReceipt } from '../../agents/lib/mission-client.mjs';

function graphFixture() {
  const db = new DatabaseSync(':memory:');
  let seq = 0;
  let clock = 1_800_000_000;
  const graph = createMissionGraph({
    db,
    uid: () => `g-${++seq}`,
    now: () => ++clock,
    emit: () => {},
    js: JSON.stringify,
    jp: (value, fallback = {}) => {
      if (value == null) return fallback;
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return fallback; }
    },
  });
  return { db, graph };
}

async function runCodingTurn({ control, missionId, workspace, task, actor = 'nova-e2e' }) {
  const lease = control.claim(missionId, actor);
  const action = control.begin(missionId, { owner: actor, token: lease.token, task });
  const before = control.get(missionId);
  const result = await workspace.execute(action, before.contract, { actor, receipts: before.receipts });
  const receipt = checkedReceipt(action, result);
  const mission = control.finish(missionId, {
    owner: actor,
    token: lease.token,
    actionId: action.id,
    receipt,
  });
  return { action, result, receipt, mission };
}

test('self-development closes SEER -> Mission Graph -> Nova -> coding workspace -> verified git commit', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-selfdev-e2e-'));
  const busDir = path.join(root, '.mission-bus');
  fs.mkdirSync(busDir, { recursive: true });

  const { db, graph } = graphFixture();
  const bus = new DurableMissionBus(busDir);
  t.after(() => {
    bus.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'jaco-e2e@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'JACO E2E'], { cwd: root });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'src/a.mjs'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: baseline'], { cwd: root });

  const selfDevelopment = buildSelfDevelopmentGraph({
    title: 'E2E self-development',
    objective: 'Change a source file and prove the change before release',
    scope: { allowed: ['src/**'] },
    acceptance: ['source syntax passes', 'falsifier passes', 'scoped git commit exists'],
    verification: {
      commands: ['node --check src/a.mjs'],
      tests_required: true,
      falsifier_required: true,
    },
    execution: { allow_git_commit: true },
  });

  const createdGraph = graph.create(selfDevelopment);
  assert.equal(createdGraph.nodes[0].status, 'READY');

  const dispatchSpec = graph.dispatchSpec(createdGraph.id, 'code-change');
  assert.equal(dispatchSpec.contract.schema, 'jaco.coding-contract/v1');
  assert.equal(dispatchSpec.source, 'seer-mission-graph');

  const control = new NovaMissionControl(bus, {
    allowedTasks: ['repo-read', 'repo-write', 'repo-test', 'git-status', 'git-diff', 'git-commit'],
  });
  const novaMission = control.create(dispatchSpec);
  assert.equal(novaMission.contract.schema, 'jaco.coding-contract/v1');
  assert.deepEqual(novaMission.contract.scope.allowed, ['src/**']);

  graph.bindNova(createdGraph.id, 'code-change', novaMission.id);
  graph.running(createdGraph.id, 'code-change', novaMission.id);

  const workspace = createCodingWorkspace({ root });

  await runCodingTurn({
    control,
    missionId: novaMission.id,
    workspace,
    task: { type: 'repo-write', data: { path: 'src/a.mjs', content: 'export const value = 2;\n' } },
  });

  await runCodingTurn({
    control,
    missionId: novaMission.id,
    workspace,
    task: { type: 'repo-test', data: { command: 'node --check src/a.mjs', kind: 'test' } },
  });

  await runCodingTurn({
    control,
    missionId: novaMission.id,
    workspace,
    task: { type: 'repo-test', data: { command: 'node --check src/a.mjs', kind: 'falsifier' } },
  });

  const committed = await runCodingTurn({
    control,
    missionId: novaMission.id,
    workspace,
    task: { type: 'git-commit', data: { message: 'fix: verified self-development' } },
  });

  assert.match(committed.result.commit, /^[0-9a-f]{40}$/);
  assert.match(committed.result.tree, /^[0-9a-f]{40}$/);
  assert.deepEqual(committed.result.files, ['src/a.mjs']);
  assert.equal(
    execFileSync('git', ['show', `${committed.result.commit}:src/a.mjs`], { cwd: root, encoding: 'utf8' }),
    'export const value = 2;\n',
  );

  let lease = control.claim(novaMission.id, 'nova-e2e');
  const awaiting = control.release(novaMission.id, {
    owner: 'nova-e2e',
    token: lease.token,
    completionProposed: true,
  });
  assert.equal(awaiting.status, 'AWAITING_VERIFICATION');
  assert.equal(awaiting.contractStatus.machineVerified, true);

  const beforeOperator = graph.reconcileNova(createdGraph.id, 'code-change', awaiting);
  assert.equal(beforeOperator.outcome, 'awaiting_operator');
  assert.equal(beforeOperator.graph.nodes[0].status, 'RUNNING');

  const done = control.resolve(novaMission.id, {
    decision: 'confirm',
    note: 'E2E operator confirms verified local commit',
  });
  assert.equal(done.status, 'DONE');

  const reconciled = graph.reconcileNova(createdGraph.id, 'code-change', done);
  assert.equal(reconciled.outcome, 'verified');
  assert.equal(reconciled.graph.status, 'VERIFIED');
  assert.equal(reconciled.graph.nodes[0].status, 'VERIFIED');
  assert.ok(reconciled.graph.nodes[0].evidence_refs.some(ref => ref.includes(done.id)));
});
