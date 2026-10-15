// Found live 2026-09-29: the Android typing path already refused to type passwords/OTPs/tokens
// itself, but the CDP browser-type path (agents/lib "lawnmower".typeInto) had no equivalent guard
// at all -- an LLM-composed password could be typed straight into a real login/signup form. This
// covers the fix: resolveGuardedTypeText() refuses secret-looking fields unless the text is a
// "vault:<key>" reference, which it resolves for real via the actual vault-tools fast path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-guarded-type-'));
process.env.NOVA_STATE_DIR = dir;
process.env.NOVA_BRAIN_MODE = 'direct';
const { resolveGuardedTypeText } = await import('../../agents/hands-off-agent.mjs');

test('a field that is not secret-labeled types its literal text unchanged', async () => {
  const result = await resolveGuardedTypeText('Repository name', 'improved-goggles');
  assert.equal(result.error, undefined);
  assert.equal(result.text, 'improved-goggles');
});

test('a secret-labeled field refuses a literal (LLM-composed) value', async () => {
  for (const name of ['Password', 'Confirm password', 'One-time code', '2FA code', 'CVV', 'API key', 'Recovery phrase']) {
    const result = await resolveGuardedTypeText(name, 'whatever-the-model-made-up');
    assert.equal(result.ok, false, `expected ${name} to be refused`);
    assert.equal(result.error, 'SECRET_FIELD_REQUIRES_VAULT_REF');
  }
});

test('a secret-labeled field accepts a vault:<key> reference and resolves the real value', async () => {
  process.env.NOVA_TEST_LOGIN_PASSWORD = 'the-real-secret-value';
  try {
    const result = await resolveGuardedTypeText('Password', 'vault:NOVA_TEST_LOGIN_PASSWORD');
    assert.equal(result.error, undefined);
    assert.equal(result.text, 'the-real-secret-value');
  } finally {
    delete process.env.NOVA_TEST_LOGIN_PASSWORD;
  }
});

test('a vault:<key> reference to a secret that does not exist fails loudly, not silently', async () => {
  const result = await resolveGuardedTypeText('Password', 'vault:NOVA_DOES_NOT_EXIST_12345');
  assert.equal(result.ok, false);
  assert.match(result.error, /^VAULT_SECRET_UNAVAILABLE:/);
});

test('a non-secret field may still use a vault: reference (e.g. a stored username)', async () => {
  process.env.NOVA_TEST_STORED_USERNAME = 'operator@example.com';
  try {
    const result = await resolveGuardedTypeText('Email', 'vault:NOVA_TEST_STORED_USERNAME');
    assert.equal(result.text, 'operator@example.com');
  } finally {
    delete process.env.NOVA_TEST_STORED_USERNAME;
  }
});

test('runtime credentials cannot be typed into a page by vault reference', async () => {
  process.env.STRIPE_SECRET_KEY_TEST_ONLY = 'sk_live_should_never_be_typed';
  try {
    const result = await resolveGuardedTypeText('API key', 'vault:STRIPE_SECRET_KEY_TEST_ONLY');
    assert.equal(result.ok, false);
    assert.match(result.error, /^VAULT_KEY_NOT_TYPEABLE:/);
    assert.equal(result.text, undefined);
  } finally {
    delete process.env.STRIPE_SECRET_KEY_TEST_ONLY;
  }
});
