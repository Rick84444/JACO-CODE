// Harmful actions stop for the operator; ordinary local work and reads do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { operatorApprovalCheck } from '../../runtime/src/server/connected/operatorActionGuard.mjs';
import { autoResolution } from '../../agents/lib/approval-policy.mjs';

const shell = command => ({ type: 'shell', data: { command } });

test('guard stops harmful shell commands anywhere in the command line', () => {
  for (const command of [
    'cd repo && rm -rf src', 'rm -r /tmp/x', 'rmdir /s /q C:\\work', 'del /f /s *.txt',
    'Remove-Item C:\\work -Recurse -Force', 'cd x && git reset --hard', 'git push --force origin x',
    'git push -f origin x', 'git push origin main', 'git clean -fd', 'git branch -D old',
    'gh pr merge 12', 'gh repo delete a/b', 'npm publish', 'npx wrangler deploy', 'curl -X DELETE https://a.example/1',
  ]) assert.ok(operatorApprovalCheck(shell(command)), command);
});

test('guard leaves ordinary local work autonomous', () => {
  for (const command of [
    'npm test', 'git status', 'git commit -m "remove old format"', 'git push origin jaco/mission-1', 'rm file.txt',
    'rm -rf node_modules', 'rm -rf ./dist', 'rm -rf runtime/dist', 'node scripts/build.mjs', 'git checkout main',
  ]) assert.equal(operatorApprovalCheck(shell(command)), null, command);
  assert.equal(operatorApprovalCheck({ type: 'web-fetch', data: { url: 'https://example.com/delete' } }), null);
  assert.equal(operatorApprovalCheck({ type: 'repo-write', data: { path: 'a.txt', content: 'send' } }), null);
  assert.equal(operatorApprovalCheck({ type: 'browser-click', data: { text: 'Next page' } }), null);
  assert.equal(operatorApprovalCheck({ type: 'mcp-write', data: { server: 'gmail', tool: 'create_draft' } }), null);
});

test('guard stops outward clicks and connector writes, in English and Swedish', () => {
  for (const text of ['Delete account', 'Publish', 'Send', 'Skicka', 'Ta bort', 'Logga in', 'Sign in'])
    assert.ok(operatorApprovalCheck({ type: 'browser-click', data: { text } }), text);
  assert.ok(operatorApprovalCheck({ type: 'mcp-write', data: { server: 'gmail', tool: 'send_message' } }));
  assert.ok(operatorApprovalCheck({ type: 'browser-type', data: { text: 'vault:NOVA_PASSWORD' } }));
});

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-action-gate-'));
  const bus = new DurableMissionBus(dir);
  const control = new NovaMissionControl(bus, { allowedTasks: ['shell'] });
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return control;
}
const leased = (control, id) => {
  const { token } = control.claim(id, 'agent');
  return { owner: 'agent', token };
};

test('a harmful action blocks the mission until the operator approves exactly that action, once', t => {
  const control = setup(t);
  const { id } = control.create({ goal: 'clean the workspace', idempotencyKey: 'gate-1', allowedTasks: ['shell'] });
  const harmful = shell('rm -rf src');

  assert.throws(() => control.begin(id, { ...leased(control, id), task: harmful }), /OPERATOR_APPROVAL_REQUIRED/);
  assert.equal(control.get(id).status, 'BLOCKED');
  assert.equal(control.pendingOperatorAction(id).reason, 'recursive delete');

  // The auto-approval policy leaves this block for the operator.
  assert.equal(autoResolution(control.get(id), { level: 5, lastError: 'OPERATOR_APPROVAL_REQUIRED: recursive delete' }), null);

  // An automated resume approves nothing.
  control.resolve(id, { decision: 'resume', note: 'auto-resumed: test', authority: 'operator' });
  assert.throws(() => control.begin(id, { ...leased(control, id), task: harmful }), /OPERATOR_APPROVAL_REQUIRED/);

  // Approval of one action does not cover another.
  control.resolve(id, { decision: 'resume', note: 'yes, go ahead', authority: 'operator' });
  assert.throws(() => control.begin(id, { ...leased(control, id), task: shell('rm -rf docs') }), /OPERATOR_APPROVAL_REQUIRED/);

  control.resolve(id, { decision: 'resume', note: 'yes, docs too', authority: 'operator' });
  const lease = leased(control, id);
  const action = control.begin(id, { ...lease, task: shell('rm -rf docs') });
  assert.equal(action.type, 'shell');
  assert.equal(control.pendingOperatorAction(id), null);
  control.finish(id, { ...lease, actionId: action.id, receipt: { ok: true, verified: true } });

  // Single use: the same action asks again.
  assert.throws(() => control.begin(id, { ...leased(control, id), task: shell('rm -rf docs') }), /OPERATOR_APPROVAL_REQUIRED/);
});

test('ordinary shell work runs without asking', t => {
  const control = setup(t);
  const { id } = control.create({ goal: 'run tests', idempotencyKey: 'gate-2', allowedTasks: ['shell'] });
  assert.equal(control.begin(id, { ...leased(control, id), task: shell('npm test') }).type, 'shell');
});
