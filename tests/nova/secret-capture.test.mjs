// Operator 2026-10-03: agents create logins and API keys; secrets must never reach the planner or receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
const { redactText, redactDeep, takeHeld, generateSecret, validateVaultKey, looksSecret, handleOf } = await import('../../agents/lib/secret-capture.mjs');
const { validateTask } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');

test('keys and tokens on a page become handles; hashes, URLs and words stay', () => {
  const page = 'Your API key: sk_live_51NxAbCdEfGhIjKlMnOpQr. Token Zq8vX2mN4pL7tR9wB3yK6hJ1 created. Commit 48768d918eebaf8c48afb1019e4642a8a155cc6b at https://example.com/a/b/c ok';
  const { text, handles } = redactText(page);
  assert.equal(handles.length, 2);
  assert.ok(!text.includes('sk_live_51NxAbCdEfGhIjKlMnOpQr') && !text.includes('Zq8vX2mN4pL7tR9wB3yK6hJ1'));
  assert.ok(text.includes('48768d918eebaf8c48afb1019e4642a8a155cc6b'), 'a commit hash is evidence, not a secret');
  assert.ok(text.includes('https://example.com/a/b/c'));
  assert.equal(takeHeld(handles[0]), 'sk_live_51NxAbCdEfGhIjKlMnOpQr');
  assert.equal(takeHeld(`[${handles[1]}]`), 'Zq8vX2mN4pL7tR9wB3yK6hJ1', 'a bracketed handle works too');
  assert.equal(handleOf('Zq8vX2mN4pL7tR9wB3yK6hJ1'), handles[1]);
  assert.equal(looksSecret('implementationActorVerified'), false);
});

test('observations are redacted deeply and handles expire', () => {
  const obs = redactDeep({ url: 'https://x.test', targets: [{ text: 'ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5' }], nested: { a: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'] } });
  assert.match(obs.targets[0].text, /^\[secret:[0-9a-f]{12}\]$/);
  assert.match(obs.nested.a[0], /^\[secret:[0-9a-f]{12}\]$/);
  const { handles } = redactText('code QwErTy123456UiOpAsDfGh7890', 0);
  assert.equal(takeHeld(handles[0], 31 * 60_000), null, 'kept 30 minutes at most');
});

test('generated passwords are strong; only NOVA_ keys are usable by the planner', () => {
  const a = generateSecret(24), b = generateSecret(24);
  assert.equal(a.length, 24);
  assert.notEqual(a, b);
  assert.ok(/[A-Z]/.test(a) && /[a-z]/.test(a) && /\d/.test(a) && /[!#%+=?]/.test(a));
  assert.equal(validateVaultKey('NOVA_SMITHERY_PASSWORD'), 'NOVA_SMITHERY_PASSWORD');
  assert.throws(() => validateVaultKey('STRIPE_SECRET_KEY'), /VAULT_KEY_MUST_START_WITH_NOVA_/);
  assert.throws(() => validateVaultKey('nova_lower'), /VAULT_KEY_INVALID/);
  const allowed = ['vault-generate-secret', 'vault-get-secret', 'secret-store'];
  assert.equal(validateTask({ type: 'secret-store', data: { handle: '[secret:0123456789ab]', key: 'NOVA_X_API_KEY' } }, allowed).type, 'secret-store');
  assert.throws(() => validateTask({ type: 'vault-get-secret', data: { key: 'DEEPSEEK_API_KEY' } }, allowed), /INVALID_VAULT_KEY/);
  assert.throws(() => validateTask({ type: 'secret-store', data: { handle: 'sk_live_x', key: 'NOVA_X_KEY' } }, allowed), /INVALID_SECRET_HANDLE/);
});
