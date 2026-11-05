// A mission must be able to complete after the model rewrites a file with the same content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodingContract, contractVerificationStatus } from '../../agents/lib/coding-contract.mjs';
import { StuckDetector } from '../../agents/lib/stuck-detector.mjs';

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
