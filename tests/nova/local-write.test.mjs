// Contract: Aura may write one file anywhere on the computer only with the operator's one-shot yes, never in the
// places no mission should touch, and every write is read back and hashed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLocalWritePath, checkLocalWriteTask, performLocalWrite, LOCAL_WRITE_MAX_BYTES } from '../../agents/lib/local-write.mjs';
import { operatorApprovalCheck } from '../../agents/lib/operator-action-guard.mjs';
import { validateTask, NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { READ_ONLY_TASKS } from '../../agents/lib/approval-policy.mjs';

const win = { platform: 'win32' };

test('paths must be absolute, concrete, outside the protected places', () => {
  assert.equal(checkLocalWritePath('C:\\Users\\dickj\\Documents\\notes\\plan.md', win).path, 'C:\\Users\\dickj\\Documents\\notes\\plan.md');
  assert.throws(() => checkLocalWritePath('notes\\plan.md', win), /NOT_ABSOLUTE/);
  assert.throws(() => checkLocalWritePath('C:\\Users\\dickj\\..\\other\\a.txt', win), /PARENT_SEGMENT/);
  assert.throws(() => checkLocalWritePath('C:\\Users\\dickj\\*.md', win), /GLOB_NOT_SUPPORTED/);
  assert.throws(() => checkLocalWritePath('C:\\', win), /IS_ROOT/);
  for (const [bad, why] of [
    ['C:\\Windows\\System32\\drivers\\etc\\hosts', /Windows system folder/],
    ['C:\\Program Files\\App\\a.dll', /program folder/],
    ['C:\\Users\\dickj\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\run.cmd', /startup folder/],
    ['C:\\Users\\dickj\\.ssh\\authorized_keys', /credential folder/],
    ['C:\\Users\\dickj\\project\\.env', /credential or key file/],
    ['C:\\Users\\dickj\\project\\.git\\config', /git internals/],
    ['C:\\Users\\dickj\\project\\.jaco\\license.key', /JACO's own state/],
    ['C:\\Users\\dickj\\certs\\site.pem', /credential or key file/],
  ]) assert.throws(() => checkLocalWritePath(bad, win), why, bad);
  assert.throws(() => checkLocalWritePath('/etc/passwd', { platform: 'linux' }), /system folder/);
});

test('content must be text within the size limit', () => {
  assert.throws(() => checkLocalWriteTask({ path: 'C:\\x\\a.txt', content: 5 }, win), /CONTENT_INVALID/);
  assert.throws(() => checkLocalWriteTask({ path: 'C:\\x\\a.txt', content: 'a'.repeat(LOCAL_WRITE_MAX_BYTES + 1) }, win), /CONTENT_TOO_LARGE/);
});

test('a write is performed, read back and hashed; links and directories are refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lw-'));
  const target = path.join(dir, 'sub', 'note.txt');
  const first = performLocalWrite({ path: target, content: 'hej\n' });
  assert.deepEqual([first.ok, first.verified, first.overwrote, first.bytes], [true, true, false, 4]);
  assert.equal(fs.readFileSync(target, 'utf8'), 'hej\n');
  const second = performLocalWrite({ path: target, content: 'hej igen\n' });
  assert.equal(second.overwrote, true);
  assert.equal(second.previousSha256, first.sha256, 'the receipt names what was replaced');
  assert.equal(performLocalWrite({ path: path.join(dir, 'sub'), content: 'x' }).error, 'LOCAL_WRITE_TARGET_NOT_A_FILE');
  const link = path.join(dir, 'link.txt');
  try { fs.symlinkSync(target, link); assert.equal(performLocalWrite({ path: link, content: 'x' }).error, 'LOCAL_WRITE_TARGET_IS_LINK'); } catch (error) { if (error.code !== 'EPERM') throw error; }
  assert.match(performLocalWrite({ path: '..\\x', content: 'x' }).error, /NOT_ABSOLUTE|PARENT/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the guard always asks for local-write, even inside a contract sandbox, and it is not a read-only task', () => {
  const task = { type: 'local-write', data: { path: 'C:\\Users\\dickj\\Documents\\a.md', content: 'x' } };
  assert.match(operatorApprovalCheck(task, { sandbox: false }).reason, /write a file outside the project: C:\\Users\\dickj\\Documents\\a\.md/);
  assert.match(operatorApprovalCheck(task, { sandbox: true }).reason, /outside the project/);
  assert.ok(!READ_ONLY_TASKS.has('local-write'));
});

test('a mission blocks on local-write until the operator approves exactly that action once', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lw-mission-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = new NovaMissionControl(bus, { allowedTasks: ['local-write', 'web-fetch'] });
  const target = path.join(dir, 'out', 'a.md');
  const m = control.create({ goal: 'write a note outside the repo', idempotencyKey: 'lw1', allowedTasks: ['local-write'] });
  const task = { type: 'local-write', data: { path: target, content: 'hello' }, expectedOutcome: 'file exists' };
  let lease = control.claim(m.id, 'nova-test');
  assert.throws(() => control.begin(m.id, { owner: 'nova-test', token: lease.token, task }), /OPERATOR_APPROVAL_REQUIRED: write a file outside the project/);
  assert.equal(control.get(m.id).status, 'BLOCKED');
  assert.ok(control.pendingOperatorAction(m.id), 'the approval center has something to show');
  // An automated resume does not approve it.
  control.resolve(m.id, { decision: 'resume', note: 'auto-resumed (level 5): transient', authority: 'operator' });
  lease = control.claim(m.id, 'nova-test');
  assert.throws(() => control.begin(m.id, { owner: 'nova-test', token: lease.token, task }), /OPERATOR_APPROVAL_REQUIRED/);
  // The operator's own decision covers exactly this action, once.
  control.resolve(m.id, { decision: 'resume', note: 'Operator explicitly confirmed resume: write the note', authority: 'operator' });
  lease = control.claim(m.id, 'nova-test');
  const action = control.begin(m.id, { owner: 'nova-test', token: lease.token, task });
  assert.equal(action.type, 'local-write');
  control.finish(m.id, { owner: 'nova-test', token: lease.token, actionId: action.id, receipt: { ok: true, verified: true } });
  lease = control.claim(m.id, 'nova-test');
  const other = { type: 'local-write', data: { path: path.join(dir, 'out', 'b.md'), content: 'hello' } };
  assert.throws(() => control.begin(m.id, { owner: 'nova-test', token: lease.token, task: other }), /OPERATOR_APPROVAL_REQUIRED/, 'a second write asks again');
});

test('validateTask refuses a protected path before anything is asked of the operator', () => {
  assert.throws(() => validateTask({ type: 'local-write', data: { path: 'C:\\Windows\\a.txt', content: 'x' } }, ['local-write']), /LOCAL_WRITE_PATH_FORBIDDEN/);
  assert.throws(() => validateTask({ type: 'local-write', data: { path: 'C:\\x\\a.txt', content: 'x' } }, ['web-fetch']), /TASK_NOT_ALLOWED/);
  assert.equal(validateTask({ type: 'local-write', data: { path: 'C:\\Users\\dickj\\Documents\\a.md', content: 'x' } }, ['local-write']).type, 'local-write');
});
