import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeProjectRoot, projectNodeContract, projectGraphPolicy, projectGoalGraph, projectGoalDone, PROJECT_TASKS } from '../../gateway/src/seer-project.mjs';

test('a project goal with a verified graph is done and is not executed again', () => {
  const graphs = [
    { status: 'CANCELLED', policy: { strategic_goal_id: 'g1' } },
    { status: 'VERIFIED', policy: { strategic_goal_id: 'g2' } },
  ];
  assert.equal(projectGoalDone(graphs, 'g2'), true);
  assert.equal(projectGoalDone(graphs, 'g1'), false, 'a cancelled run does not complete the goal');
  assert.equal(projectGoalDone(graphs, null), false);
  assert.equal(projectGoalDone(undefined, 'g2'), false);
});
import { normalizeCodingContract, CODE_TASKS } from '../../agents/lib/coding-contract.mjs';

const absolute = path.resolve(os.tmpdir(), 'jaco-project-mode');

test('project root is normalised and only absolute paths are accepted', () => {
  assert.equal(normalizeProjectRoot(null), null);
  assert.equal(normalizeProjectRoot(''), null);
  assert.equal(normalizeProjectRoot(absolute + path.sep), absolute);
  for (const bad of ['relative/dir', 42, 'x\0y', '/'.repeat(501)]) assert.throws(() => normalizeProjectRoot(bad), /PROJECT_ROOT_INVALID/);
});

test('project node contract is a valid coding contract that commits but never pushes or merges', () => {
  const contract = normalizeCodingContract(projectNodeContract({ title: 'Add multiply', objective: 'Add mul(a,b) to src/math.js', mainGoal: 'Extend the math helpers' }));
  assert.deepEqual(contract.scope.allowed, ['**']);
  assert.ok(contract.scope.forbidden.includes('.env'), 'default secrets stay forbidden');
  assert.equal(contract.execution.allow_git_commit, true);
  assert.equal(contract.execution.require_git_commit, true);
  assert.equal(contract.execution.allow_git_push, false);
  assert.equal(contract.execution.allow_git_merge, false);
  assert.equal(contract.execution.require_human_before_destructive_action, true);
  assert.match(contract.objective, /Extend the math helpers/);
  assert.throws(() => projectNodeContract({ title: '', objective: '' }), /PROJECT_NODE_OBJECTIVE_REQUIRED/);
});

test('project graph policy routes to Nova with code tools only when a project is set', () => {
  assert.deepEqual(projectGraphPolicy(null), {});
  const policy = projectGraphPolicy(absolute);
  assert.equal(policy.project_root, absolute);
  assert.equal(policy.executor, 'nova');
  assert.ok(PROJECT_TASKS.filter(t => t !== 'web-fetch').every(t => CODE_TASKS.has(t)));
  assert.ok(!PROJECT_TASKS.includes('git-push') && !PROJECT_TASKS.includes('git-merge'));
});

test('an operator instruction on a project becomes one direct node, not a re-strategised plan', () => {
  const statement = 'Add mul(a, b) to src/math.js and a node:test for it, then commit.';
  const graph = projectGoalGraph({ id: 'goal-1', statement, project_root: absolute });
  assert.equal(graph.objective, statement);
  assert.equal(graph.policy.strategic_goal_id, 'goal-1');
  assert.equal(graph.policy.project_root, absolute);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].objective, statement);
  assert.ok(normalizeCodingContract(graph.nodes[0].contract).execution.allow_git_commit);
  assert.throws(() => projectGoalGraph({ id: 'g', statement, project_root: null }), /PROJECT_GOAL_REQUIRED/);
  assert.throws(() => projectGoalGraph({ id: 'g', statement: '  ', project_root: absolute }), /PROJECT_GOAL_REQUIRED/);
});

test('a Nova mission carries the project root in its metadata', async () => {
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-project-mode-'))));
  const contract = projectNodeContract({ title: 'Add multiply', objective: 'Add mul(a,b)', mainGoal: 'math' });
  const mission = control.create({ goal: 'Add mul(a,b)', idempotencyKey: 'project-mode-1', contract, allowedTasks: ['repo-list', 'repo-read', 'repo-write', 'git-commit'], projectRoot: absolute });
  assert.equal(mission.metadata.projectRoot, absolute);
  const plain = control.create({ goal: 'Something else entirely', idempotencyKey: 'project-mode-2', contract, allowedTasks: ['repo-list'] });
  assert.equal(plain.metadata.projectRoot, undefined);
});

test('invalid project missions are refused', async () => {
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-project-mode-'))));
  const contract = projectNodeContract({ title: 'x', objective: 'x', mainGoal: 'x' });
  assert.throws(() => control.create({ goal: 'g', idempotencyKey: 'bad-1', contract, allowedTasks: ['repo-list'], projectRoot: 'relative/dir' }), /PROJECT_ROOT_INVALID/);
  assert.throws(() => control.create({ goal: 'g', idempotencyKey: 'bad-2', projectRoot: absolute }), /PROJECT_MISSION_REQUIRES_CONTRACT/);
});
