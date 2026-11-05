// A mission must be able to complete after the model rewrites a file with the same content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodingContract, contractVerificationStatus } from '../../agents/lib/coding-contract.mjs';
import { StuckDetector } from '../../agents/lib/stuck-detector.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';

const contract = () => normalizeCodingContract({
  objective: 'x', scope: { allowed: ['**'] }, acceptance: ['a'],
  execution: { autonomous: true, allow_git_commit: true, require_git_commit: true },
  verification: { tests_required: false, commands: [] },
}, 'x');
const receipt = (type, turn, result = {}) => ({ type, ok: true, verified: true, actionId: `m:turn:${turn}`, result });

test('rewriting a file with identical content does not demand another commit', () => {
  const c = contract();
  const committed = [receipt('repo-write', 1, { beforeSha256: null, afterSha256: 'A' }), receipt('git-commit', 2)];
  assert.equal(contractVerificationStatus(c, committed).machineVerified, true);
  const again = [...committed, receipt('repo-write', 3, { beforeSha256: 'A', afterSha256: 'A' })];
  assert.equal(contractVerificationStatus(c, again).machineVerified, true, 'an unchanged write is not a new change');
  const changed = [...committed, receipt('repo-write', 3, { beforeSha256: 'A', afterSha256: 'B' })];
  assert.deepEqual(contractVerificationStatus(c, changed).missing, ['commit'], 'a real change after the commit still needs its own commit');
});

test('a circle seen at the start of a run keeps its history, so the next repeated step is caught', () => {
  const stuck = new StuckDetector();
  const cycle = [['repo-write', 'w'], ['repo-edit', 'e'], ['mcp-call', 'v'], ['git-commit', 'c']];
  for (let round = 0; round < 4; round++) for (const [name, args] of cycle) stuck.record({ name, args, ok: true, result: 'ok' });
  assert.equal(stuck.check().stuck, true, 'the inherited history shows the circle');
  stuck.nudges++; // what the loop does at the start of a run
  assert.equal(stuck.steps.length, 16, 'the history is not wiped');
  stuck.record({ name: 'repo-write', args: 'w', ok: true, result: 'ok' });
  const verdict = stuck.check();
  assert.equal(verdict.stuck, true, 'one more repeated step is enough');
  assert.ok(stuck.nudge() > 1, 'which is a second nudge: the loop blocks the mission');
});

test('an identical rewrite preserves POSIX executable mode and remains a no-op', async t => {
  if (process.platform === 'win32') return t.skip('POSIX mode bits are not supported by Windows');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-preserve-mode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'run.sh');
  fs.writeFileSync(file, '#!/bin/sh\necho working\n');
  fs.chmodSync(file, 0o755);
  const ws = createCodingWorkspace({ root });
  const result = await ws.execute({ type: 'repo-write', data: {
    path: 'run.sh', content: '#!/bin/sh\necho working\n',
  } }, contract(), { actor: 'mode-test' });
  assert.equal(result.ok, true);
  assert.equal(result.beforeSha256, result.afterSha256, 'content is unchanged');
  assert.equal(fs.statSync(file).mode & 0o777, 0o755, 'executable mode is unchanged');
});

test('text edits refuse undecodable bytes without damaging the original file', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-byte-preservation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'binary.txt');
  const original = Buffer.from([0x61, 0x0d, 0x0a, 0xff, 0x62]);
  fs.writeFileSync(file, original);
  const ws = createCodingWorkspace({ root });
  await assert.rejects(
    ws.execute({ type: 'repo-edit', data: { path: 'binary.txt', old: 'a', new: 'b' } },
      contract(), { actor: 'byte-test' }),
    /CODING_EDIT_BINARY_REFUSED/,
  );
  assert.deepEqual(fs.readFileSync(file), original, 'a failed text edit must not corrupt the file');
});

test('a normalized CRLF edit preserves the UTF-8 BOM and does not require a new commit', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-bom-preservation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'text.txt');
  const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('hello\r\n')]);
  fs.writeFileSync(file, original);
  const ws = createCodingWorkspace({ root });
  const result = await ws.execute({ type: 'repo-edit', data: {
    path: 'text.txt', old: 'hello\n', new: 'hello\r\n',
  } }, contract(), { actor: 'bom-test' });
  assert.equal(result.ok, true);
  assert.equal(result.beforeSha256, result.afterSha256);
  assert.deepEqual(fs.readFileSync(file), original, 'byte-for-byte identical replacement');
});
