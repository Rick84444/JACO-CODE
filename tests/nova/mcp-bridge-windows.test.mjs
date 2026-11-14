import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultJacoctl } from '../../runtime/gateway/src/config.mjs';

const repoRoot = path.resolve('/repo');
const cli = path.join(repoRoot, 'agents', 'jaco-cli.mjs');
const wrapper = path.join('/home/u', '.local', 'bin', 'jacoctl');

test('an explicit JACOCTL_PATH always wins', () => {
  assert.equal(defaultJacoctl({ env: { JACOCTL_PATH: '/x/jacoctl' }, platform: 'win32', home: '/home/u', repoRoot, exists: () => true }), '/x/jacoctl');
});
test('Windows uses the checkout CLI, never the missing Termux wrapper', () => {
  assert.equal(defaultJacoctl({ env: {}, platform: 'win32', home: '/home/u', repoRoot, exists: p => p === cli }), cli);
});
test('Termux and Linux keep the installed wrapper when it exists', () => {
  assert.equal(defaultJacoctl({ env: {}, platform: 'android', home: '/home/u', repoRoot, exists: () => true }), wrapper);
});
test('without a wrapper a POSIX checkout falls back to its own CLI', () => {
  assert.equal(defaultJacoctl({ env: {}, platform: 'linux', home: '/home/u', repoRoot, exists: p => p === cli }), cli);
});
