// Harmful actions stop for the operator; ordinary local work and reads do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { operatorApprovalCheck } from '../../agents/lib/operator-action-guard.mjs';
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
  for (const tool of ['stripe_charge', 'payments_checkout', 'stripe_refund', 'wallet_withdraw', 'stripe_create_payment_intent', 'stripe_payout_create']) {
    assert.ok(operatorApprovalCheck({type:'mcp-write', data:{server:'payments',tool}}), tool);
  }
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

  // An approved exact action must run first. A planner cannot silently
  // replace it with another action while reusing the same human decision.
  control.resolve(id, { decision: 'resume', note: 'yes, go ahead', authority: 'operator' });
  assert.equal(control.get(id).approvedTask.data.command,'rm -rf src');
  let lease = leased(control, id);
  assert.throws(() => control.begin(id, { ...lease, task: shell('rm -rf docs') }), /APPROVED_ACTION_PENDING_EXACT_TASK/);
  control.release(id, lease);
  lease = leased(control, id);
  const first = control.begin(id, { ...lease, task: control.get(id).approvedTask });
  control.finish(id, { ...lease, actionId: first.id, receipt: { ok: true, verified: true } });

  assert.throws(() => control.begin(id, { ...leased(control, id), task: shell('rm -rf docs') }), /OPERATOR_APPROVAL_REQUIRED/);
  control.resolve(id, { decision: 'resume', note: 'yes, docs too', authority: 'operator' });
  lease = leased(control, id);
  const action = control.begin(id, { ...lease, task: control.get(id).approvedTask });
  assert.equal(action.type, 'shell');
  assert.equal(control.pendingOperatorAction(id), null);
  control.finish(id, { ...lease, actionId: action.id, receipt: { ok: true, verified: true } });

  // Single use: the same mutation asks again if the agent proposes it again.
  assert.throws(() => control.begin(id, { ...leased(control, id), task: shell('rm -rf docs') }), /OPERATOR_APPROVAL_REQUIRED/);
});

test('ordinary shell work runs without asking', t => {
  const control = setup(t);
  const { id } = control.create({ goal: 'run tests', idempotencyKey: 'gate-2', allowedTasks: ['shell'] });
  assert.equal(control.begin(id, { ...leased(control, id), task: shell('npm test') }).type, 'shell');
});

test('inside a contract the worktree is the sandbox: local clean-up is free, leaving it still asks', () => {
  const sandbox = { sandbox: true };
  for (const command of ['rm -rf src', 'rm -rf tooltest', 'rm -rf build/out', 'git reset --hard', 'git clean -fd', 'Remove-Item tmpdir -Recurse -Force'])
    assert.equal(operatorApprovalCheck(shell(command), sandbox), null, command);
  for (const command of [
    'rm -rf ..', 'rm -rf ../other', 'rm -rf /', 'rm -rf C:/Users', 'rm -rf ~', 'rm -rf *', 'rm -rf .', 'rm -rf .git', 'rmdir /s /q ../x',
    'git push --force origin x', 'git push origin main', 'git branch -D other', 'gh pr merge 1', 'npm publish', 'npx wrangler deploy',
  ]) assert.ok(operatorApprovalCheck(shell(command), sandbox), command);
  // Outward actions are never part of a sandbox.
  assert.ok(operatorApprovalCheck({ type: 'browser-click', data: { text: 'Publish' } }, sandbox));
  assert.ok(operatorApprovalCheck({ type: 'mcp-write', data: { server: 'gmail', tool: 'send_message' } }, sandbox));
  // Outside a contract the same local delete still asks.
  assert.ok(operatorApprovalCheck(shell('rm -rf src')));
});
