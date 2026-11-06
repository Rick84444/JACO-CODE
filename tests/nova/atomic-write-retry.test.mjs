import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson, readJson } from '../../runtime/src/server/continuum/util.mjs';

const withRename = async (fake, fn) => {
  const real = fs.renameSync;
  fs.renameSync = fake(real);
  try { await fn(); } finally { fs.renameSync = real; }
};
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-'));

test('a rename that fails briefly with EPERM (a scanner holds the file) is retried and the write lands', async () => {
  const d = dir(); const file = path.join(d, 'state.json');
  let failures = 0;
  try {
    await withRename(real => (from, to) => { if (failures < 3) { failures++; throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } return real(from, to); },
      () => atomicWriteJson(file, { ok: 1 }));
    assert.equal(failures, 3);
    assert.deepEqual(readJson(file), { ok: 1 });
    assert.deepEqual(fs.readdirSync(d), ['state.json'], 'no temp file is left behind');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a rename that never succeeds throws and removes its temp file; other errors are not retried', async () => {
  const d = dir(); const file = path.join(d, 'state.json');
  try {
    await withRename(() => () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); }, () => assert.throws(() => atomicWriteJson(file, { a: 1 }), /EPERM/));
    assert.deepEqual(fs.readdirSync(d), []);
    let calls = 0;
    await withRename(() => () => { calls++; throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); }, () => assert.throws(() => atomicWriteJson(file, { a: 1 }), /ENOSPC/));
    assert.equal(calls, 1);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
