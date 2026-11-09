// Aura starts with every capability on; the operator turns things off and the runtime honours it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { CapabilityPolicy, taskCatalog, ALWAYS_ASK } from '../../runtime/src/server/capabilities/capabilityPolicy.mjs';
import { operatorApprovalCheck } from '../../agents/lib/operator-action-guard.mjs';
import { TASK_FIELDS } from '../../agents/lib/task-fields.mjs';

const taskIds = Object.keys(TASK_FIELDS);
const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-capabilities-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('everything is on by default and the catalog shows every task type in a group', () => {
  const policy = new CapabilityPolicy('does-not-exist.json', { taskIds });
  assert.deepEqual(policy.snapshot().disabledTasks, []);
  assert.ok(taskIds.every(id => policy.isTaskEnabled(id)));
  const listed = taskCatalog(taskIds).flatMap(group => group.tasks.map(task => task.id));
  assert.deepEqual([...listed].sort(), [...taskIds].sort(), 'no task type is hidden from the operator');
  assert.ok(ALWAYS_ASK.some(item => item.id === 'spend'), 'payments are shown as a fixed limit, not a switch');
});

test('turning things off persists across restart, validates ids and can be reset', t => {
  const file = path.join(tmp(t), 'state', 'capabilities.json');
  const policy = new CapabilityPolicy(file, { taskIds });
  policy.update({ tasks: { 'git-push': false, 'desktop-action': false }, skills: { 'community-post': false } });
  assert.equal(new CapabilityPolicy(file, { taskIds }).isTaskEnabled('git-push'), false);
  assert.equal(new CapabilityPolicy(file, { taskIds }).isSkillEnabled('community-post'), false);
  assert.deepEqual(policy.enabledTasks(['git-push', 'repo-read']), ['repo-read']);
  assert.throws(() => policy.update({ tasks: { 'no-such-task': false } }), /CAPABILITY_INVALID/);
  assert.throws(() => policy.update({ tasks: { 'git-push': 'no' } }), /CAPABILITY_INVALID/);
  policy.update({ tasks: { 'git-push': true } });
  assert.equal(policy.isTaskEnabled('git-push'), true);
  assert.deepEqual(policy.reset().disabledTasks, []);
  fs.writeFileSync(file, '{ damaged');
  assert.deepEqual(new CapabilityPolicy(file, { taskIds }).snapshot().disabledTasks, [], 'a damaged file means everything on, not everything off');
});

function control(t, capabilities) {
  // The database must be closed before its folder can be removed on Windows.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-capabilities-mission-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return new NovaMissionControl(bus, capabilities ? { capabilities } : {});
}

test('with the switches, a mission starts with every enabled task; without them the legacy scope is unchanged', t => {
  const policy = new CapabilityPolicy(path.join(tmp(t), 'c.json'), { taskIds });
  const full = control(t, policy).create({ goal: 'Do whatever the goal needs', idempotencyKey: 'cap-1' });
  for (const task of ['shell', 'browser-click', 'mcp-write', 'skill-load', 'vault-get-secret', 'desktop-action', 'web-fetch'])
    assert.ok(full.allowedTasks.includes(task), task);
  assert.ok(!full.allowedTasks.includes('repo-scan'), 'a paid scan stays explicit');
  assert.ok(!full.allowedTasks.includes('windows-wmi-read'), 'a desktop-executor task is not given to the plain executor');
  const legacy = control(t).create({ goal: 'Do whatever the goal needs', idempotencyKey: 'cap-2' });
  assert.ok(!legacy.allowedTasks.includes('shell'), 'legacy scope never injected raw shell');
});

test('a task the operator turned off is missing from new missions and refused for running ones', t => {
  const policy = new CapabilityPolicy(path.join(tmp(t), 'c.json'), { taskIds });
  const missions = control(t, policy);
  const mission = missions.create({ goal: 'Look at the page', idempotencyKey: 'cap-3' });
  assert.ok(mission.allowedTasks.includes('browser-click'));
  policy.update({ tasks: { 'browser-click': false } });
  assert.ok(!missions.get(mission.id).allowedTasks.includes('browser-click'), 'existing mission must see the live operator restriction');
  assert.ok(!missions.create({ goal: 'Look at another page', idempotencyKey: 'cap-4' }).allowedTasks.includes('browser-click'));
  const { token } = missions.claim(mission.id, 'agent');
  assert.throws(() => missions.begin(mission.id, { owner: 'agent', token, task: { type: 'browser-click', data: { selector: 'a' } } }), /TASK_TURNED_OFF_BY_OPERATOR:browser-click/);
});

test('Aura\'s own outward tools ask like other connector writes', () => {
  for (const tool of ['wordpress_update_page', 'wordpress_apply_css', 'a2a_outbound', 'store_secret', 'provider_register'])
    assert.ok(operatorApprovalCheck({ type: 'mcp-write', data: { server: 'jaco', tool } }), tool);
  for (const tool of ['jaco_system_health', 'wordpress_status', 'knowledge_search'])
    assert.equal(operatorApprovalCheck({ type: 'mcp-write', data: { server: 'jaco', tool } }), null, tool);
});
