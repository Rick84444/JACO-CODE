// No publishable text file, including tests or fixtures, is exempt from secret detection.
// This is not a substitute for history scanning or rotating compromised credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { scanRepositorySecrets } from '../../agents/lib/repo-secret-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (root, args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

function temporaryRepository(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-secret-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q']);
  return dir;
}

test('no tracked or publishable source, documentation, test or fixture holds a key-shaped secret', () => {
  const audit = scanRepositorySecrets({ root });
  assert.deepEqual(audit.errors, [], 'tracked content must be readable');
  assert.deepEqual(audit.findings, [], 'remove and rotate any committed secret');
  assert.ok(audit.filesChecked > 0, 'an empty or skipped scan is not proof');
});

test('a secret committed in tests is detected without publishing its value in a receipt', t => {
  const dir = temporaryRepository(t);
  const fixture = path.join(dir, 'tests', 'fixture.txt');
  fs.mkdirSync(path.dirname(fixture), { recursive: true });
  // Construct a synthetic test token at execution time: no key-shaped fixture in Git.
  const synthetic = 'gh' + 'p_' + 'Z'.repeat(36);
  fs.writeFileSync(fixture, 'fixture: ' + synthetic);
  git(dir, ['add', 'tests/fixture.txt']);
  const result = scanRepositorySecrets({ root: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ path: 'tests/fixture.txt', kind: 'github' }]);
  assert.ok(!JSON.stringify(result).includes(synthetic), 'diagnostics never return the key');
});

test('a missing tracked text file fails closed', t => {
  const dir = temporaryRepository(t);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'not a secret');
  git(dir, ['add', 'tracked.txt']);
  fs.rmSync(path.join(dir, 'tracked.txt'));
  const result = scanRepositorySecrets({ root: dir });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, 'tracked.txt');
});

test('a binary file is recognized by contents, not by an excluded filename', t => {
  const dir = temporaryRepository(t);
  fs.writeFileSync(path.join(dir, 'picture.png'), Buffer.from([0, 137, 80, 78, 71, 0]));
  fs.writeFileSync(path.join(dir, 'fixture.test.mjs'), 'export const safe = true;\n');
  git(dir, ['add', '.']);
  const result = scanRepositorySecrets({ root: dir });
  assert.equal(result.ok, true);
  assert.equal(result.binaryFiles, 1);
  assert.equal(result.filesChecked, 1);
});

test('untracked but publishable files are scanned; ignored private files remain local', t => {
  const dir = temporaryRepository(t);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
  fs.writeFileSync(path.join(dir, '.env'), 'AWS_SECRET_ACCESS_KEY=local-only\n');
  fs.writeFileSync(path.join(dir, 'publishable.txt'), 'gh' + 'p_' + 'K'.repeat(36));
  git(dir, ['add', '.gitignore']);
  const result = scanRepositorySecrets({ root: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ path: 'publishable.txt', kind: 'github' }]);
  assert.equal(result.errors.length, 0);
});

test('short Ed25519 PKCS#8 PEM private keys are detected', t => {
  const dir = temporaryRepository(t);
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  // A real ephemeral key is generated only inside the disposable test repository.
  fs.writeFileSync(path.join(dir, 'short-key.txt'), pem);
  git(dir, ['add', 'short-key.txt']);
  const result = scanRepositorySecrets({ root: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ path: 'short-key.txt', kind: 'private-key-block' }]);
  assert.equal(result.errors.length, 0);
});

test('Latin-1 text with valid ASCII credential characters is never skipped', t => {
  const dir = temporaryRepository(t);
  const synthetic = 'gh' + 'p_' + 'R'.repeat(36);
  fs.writeFileSync(path.join(dir, 'latin1.txt'), Buffer.concat([
    Buffer.from('caf', 'ascii'), Buffer.from([0xe9]), Buffer.from(' ' + synthetic, 'ascii'),
  ]));
  git(dir, ['add', 'latin1.txt']);
  const result = scanRepositorySecrets({ root: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ path: 'latin1.txt', kind: 'github' }]);
  assert.equal(result.binaryFiles, 0);
});

test('UTF-16 private data is detected even when NUL bytes are present', t => {
  const dir = temporaryRepository(t);
  const synthetic = 'gh' + 'p_' + 'M'.repeat(36);
  fs.writeFileSync(path.join(dir, 'utf16.txt'), Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('token ' + synthetic, 'utf16le'),
  ]));
  git(dir, ['add', 'utf16.txt']);
  const result = scanRepositorySecrets({ root: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ path: 'utf16.txt', kind: 'github' }]);
});
