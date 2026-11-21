import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateStartupEvidence, readStartupEvidence, startupEvidenceRoots } from '../../agents/lib/startup-evidence.mjs';

const READY = {
  schema: 'jaco.local-startup/v1', state: 'READY', phase: 'complete',
  browserAttachment: 'ATTACHED', expected: { browserAttachment: true },
};

function receiptIn(dir, body = READY) {
  fs.mkdirSync(path.join(dir, 'logs', 'startup'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs', 'startup', 'status.json'), JSON.stringify(body));
  return dir;
}
function workspace(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-startup-evidence-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const make = name => { const dir = path.join(base, name); fs.mkdirSync(dir, { recursive: true }); return dir; };
  return { base, make };
}

// Observed 2026-11-21 on Windows: every service answered, the starter had written a READY checkpoint with
// browserAttachment ATTACHED, and the health tool still reported DEGRADED with startup UNVERIFIED. Nothing
// sets JACO_ROOT on Windows (install-activation.sh is the Linux/Termux installer), so the caller derived its
// root from the ~/.local/bin wrapper and looked for the checkpoint under $HOME, where it has never been.
test('the checkpoint is found in the root the starter actually wrote it to', t => {
  const { make } = workspace(t);
  const home = make('home'), install = receiptIn(make('install'));
  assert.equal(readStartupEvidence(home, { env: {}, cwd: home }).state, 'UNVERIFIED', 'the reported bug');
  for (const env of [{ JACO_DATA_DIR: install }, { JACO_INSTALL_ROOT: install }, { JACO_REPO_ROOT: install }, { JACO_ROOT: install }]) {
    const found = readStartupEvidence(home, { env, cwd: home });
    assert.equal(found.ok, true, Object.keys(env)[0]);
    assert.equal(found.browserAttachment, 'ATTACHED');
  }
  // The process was launched from the checkout, so its own directory is a legitimate last resort.
  assert.equal(readStartupEvidence(home, { env: {}, cwd: install }).ok, true);
});

test('it still fails closed: no canonical checkpoint anywhere means UNVERIFIED', t => {
  const { make } = workspace(t);
  const empty = make('empty');
  assert.deepEqual(readStartupEvidence(empty, { env: {}, cwd: empty }), evaluateStartupEvidence(null));
  // A file that is not the canonical checkpoint never counts, and never stops the search either.
  const foreign = receiptIn(make('foreign'), { schema: 'something.else/v1', state: 'READY', phase: 'complete', browserAttachment: 'ATTACHED' });
  assert.equal(readStartupEvidence(foreign, { env: {}, cwd: foreign }).state, 'UNVERIFIED');
  const real = receiptIn(make('real'));
  assert.equal(readStartupEvidence(foreign, { env: { JACO_DATA_DIR: real }, cwd: foreign }).ok, true, 'a foreign file must not hide the real one');
  // Readiness is never inferred from a path: a checkpoint that is not READY stays not READY.
  const degraded = receiptIn(make('degraded'), { ...READY, state: 'DEGRADED', browserAttachment: 'FAILED' });
  const seen = readStartupEvidence(degraded, { env: {}, cwd: degraded });
  assert.equal(seen.state, 'DEGRADED');
  assert.equal(seen.ok, false);
});

test('the roots are searched in a stable order, deduplicated, and ignore empty settings', t => {
  const { make } = workspace(t);
  const a = make('a'), b = make('b');
  assert.deepEqual(startupEvidenceRoots(a, { JACO_DATA_DIR: b }, a), [path.resolve(a), path.resolve(b)]);
  assert.deepEqual(startupEvidenceRoots(a, { JACO_DATA_DIR: a, JACO_ROOT: '  ' }, a), [path.resolve(a)], 'duplicates and blanks are dropped');
  assert.deepEqual(startupEvidenceRoots(undefined, {}, a), [path.resolve(a)]);
});
