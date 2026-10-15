import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runVaultHelper } from '../../agents/lib/vault-tools.mjs';

function child() {
  const c = new EventEmitter();
  c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough();
  c.kill = () => {};
  return c;
}
test('missing executable becomes structured failure, not an unhandled process error', async () => {
  const c = child();
  const result = runVaultHelper([], 1000, { platform: 'win32', spawnFn: () => { queueMicrotask(() => c.emit('error', new Error('ENOENT'))); return c; } });
  assert.equal((await result).error, 'VAULT_HELPER_SPAWN_FAILED');
});
test('synchronous spawn failure is structured', async () => {
  assert.equal((await runVaultHelper([], 1000, { platform: 'win32', spawnFn: () => { throw new Error('denied'); } })).error, 'VAULT_HELPER_SPAWN_FAILED');
});
test('waits for pipe close and sends secret only through stdin', async () => {
  const c = child(); let argv; let input = '';
  c.stdin.on('data', b => { input += b; });
  const p = runVaultHelper(['-Action', 'Set', '-ValueFromStdin'], 1000, { platform: 'win32', input: '{"value":"test-only"}', spawnFn: (_file, args) => { argv=args; return c; } });
  c.emit('exit', 0);
  c.stdout.write('{"ok":true}'); c.emit('close', 0);
  assert.equal((await p).ok, true);
  assert.equal(argv.includes('test-only'), false);
  assert.equal(JSON.parse(input).value, 'test-only');
});
test('invalid output cannot leak raw secret material', async () => {
  const c = child();
  const p = runVaultHelper([], 1000, { platform: 'win32', spawnFn: () => c });
  c.stdout.write('secret-sensitive-output'); c.emit('close', 0);
  assert.deepEqual(await p, { ok: false, error: 'VAULT_PARSE_ERROR' });
});
test('helper timeout is bounded', async () => {
  let killed = false; const c = child(); c.kill = () => { killed = true; };
  const result = await runVaultHelper([], 5, { platform: 'win32', spawnFn: () => c });
  assert.equal(result.error, 'VAULT_HELPER_TIMEOUT'); assert.equal(killed, true);
});
