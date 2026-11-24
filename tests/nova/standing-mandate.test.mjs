import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutonomyMandateStore, actuatorGrantExpiry } from '../../runtime/src/server/autonomy/autonomyMandate.ts';

const fixture = fn => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-standing-mandate-'));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
};

test('a newly signed mandate is standing, survives restart and does not expire in a year', () => fixture(root => {
  let store = new AutonomyMandateStore(root);
  const original = store.create({ name: 'Standing authority', mission: 'Develop software within operator authority.' });
  assert.equal(original.validity, 'STANDING');
  assert.equal(original.expiresAt, null);
  const signed = store.sign(original.id);
  assert.equal(store.isActive(original.id), true);
  assert.equal(signed.expiresAt, null);
  const firstRevision = signed.revision;
  store = new AutonomyMandateStore(root);
  assert.equal(store.isActive(original.id), true);
  assert.equal(store.get(original.id).revision, firstRevision);
  assert.equal(store.get(original.id).signedAt, signed.signedAt);
  store.revoke(original.id);
  assert.equal(store.isActive(original.id), false);
  store = new AutonomyMandateStore(root);
  assert.equal(store.isActive(original.id), false, 'revoked mandate must not rebootstrap');
}));

test('existing timed grants remain timed; operator can explicitly convert to standing', () => fixture(root => {
  const store = new AutonomyMandateStore(root);
  const timed = store.sign(store.create({ name: 'One-hour test', mission: 'Run one time-boxed test mission.', maxHours: 1 }).id);
  assert.equal(timed.validity, 'TIMED');
  assert.ok(Date.parse(timed.expiresAt) > Date.now());
  const standing = store.updateOperator(timed.id, { validity: 'STANDING' }, timed.revision);
  assert.equal(standing.expiresAt, null);
  assert.equal(store.isActive(standing.id), true);
  const timedAgain = store.updateOperator(standing.id, { validity: 'TIMED', maxHours: 2 }, standing.revision);
  assert.equal(timedAgain.validity, 'TIMED');
  assert.ok(Date.parse(timedAgain.expiresAt) > Date.now());
  assert.ok(Date.parse(timedAgain.expiresAt) < Date.now() + 2 * 3600_000 + 5000);
}));

test('operator edits are revisioned and apply on next evaluation without a new signature', () => fixture(root => {
  const store = new AutonomyMandateStore(root);
  const current = store.sign(store.create({ name: 'Operator choice', mission: 'Continue existing mission without repeated grants.' }).id);
  const edited = store.updateOperator(current.id, { decisions: { PUBLISH: 'DENY', EXTERNAL_MUTATION: 'REVIEW' }, additionalRules: 'Use the existing runtime.' }, current.revision);
  assert.equal(edited.signedAt, current.signedAt);
  assert.equal(edited.additionalRules, 'Use the existing runtime.');
  assert.equal(store.evaluate(current.id, 'PUBLISH', true).decision, 'DENY');
  assert.equal(store.evaluate(current.id, 'EXTERNAL_MUTATION', true).requireReview, true);
  assert.throws(() => store.updateOperator(current.id, { name: 'Stale' }, current.revision), /MANDATE_REVISION_CONFLICT/);
  assert.equal(store.get(current.id).name, current.name);
}));

test('free text cannot expand authority, and unsafe direct patches are rejected', () => fixture(root => {
  const store = new AutonomyMandateStore(root);
  const signed = store.sign(store.create({ name: 'Strict operator', mission: 'Keep credentials and spend under review.' }).id);
  const blocked = [
    { enabled: false }, { signedByOperator: false }, { expiresAt: '9999-01-01T00:00:00Z' },
    { decisions: { FINANCIAL: 'ALLOW' } }, { decisions: { UNKNOWN: 'ALLOW' } },
    { additionalRules: 'a'.repeat(4001) }, { validity: 'FOREVER' },
    { browserScope: 'ORIGINS', allowedOrigins: [] },
  ];
  for (const patch of blocked) assert.throws(() => store.updateOperator(signed.id, patch, signed.revision), Error);
  const policy = store.updateOperator(signed.id, { additionalRules: 'Never spend or alter secrets.' }, signed.revision);
  assert.equal(store.evaluate(policy.id, 'FINANCIAL', true).decision, 'REVIEW');
}));

test('standing authority produces renewable short-lived adapter grants', () => {
  const now = Date.UTC(2026, 10, 24, 0, 0, 0);
  assert.equal(actuatorGrantExpiry({ expiresAt: null }, now), new Date(now + 300000).toISOString());
  const timed = '2026-11-24T00:02:00.000Z';
  assert.equal(actuatorGrantExpiry({ expiresAt: timed }, now), timed);
});

test('corrupt state cannot recreate a revoked operator signature', () => fixture(root => {
  let store = new AutonomyMandateStore(root);
  const signed = store.sign(store.create({ name: 'Must persist', mission: 'Do not restore authority from damaged state.' }).id);
  const file = path.join(root, '.jaco', 'state', 'autonomy', 'mandates.json');
  fs.writeFileSync(file, '{bad-json');
  store = new AutonomyMandateStore(root);
  assert.equal(store.isActive(signed.id), false);
  assert.throws(() => store.create({ mission: 'New attempt remains blocked.' }), /SyntaxError|MANDATE_STORE_INVALID/);
}));
