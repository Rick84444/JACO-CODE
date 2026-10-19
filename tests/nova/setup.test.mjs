import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureGatewayToken } from '../../scripts/setup.mjs';
import { configuration } from '../../agents/lib/local-stack.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(root, 'server.ts'), '// /api/runtime/identity');
  return root;
}

test('setup creates a token accepted by startup and preserves unrelated configuration', t => {
  const root = fixture(t), file = path.join(root, '.env');
  fs.writeFileSync(file, 'JACO_MODEL_PROVIDER=ollama');
  ensureGatewayToken(root, {});
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.startsWith('JACO_MODEL_PROVIDER=ollama\n'));
  assert.equal(configuration(root, {}).env.GATEWAY_TOKEN.length, 64);
  ensureGatewayToken(root, {});
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('setup respects quoted and inherited tokens and rejects short tokens without changing the file', t => {
  const root = fixture(t), file = path.join(root, '.env');
  const content = 'GATEWAY_TOKEN="a-valid-token-with-at-least-24-characters" # local\n';
  fs.writeFileSync(file, content);
  ensureGatewayToken(root, {});
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.throws(() => ensureGatewayToken(root, { JACO_GATEWAY_TOKEN: 'short' }), /MIN_24/);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  fs.unlinkSync(file);
  ensureGatewayToken(root, { GATEWAY_TOKEN: 'a-valid-token-with-at-least-24-characters' });
  assert.equal(fs.existsSync(file), false);
});
