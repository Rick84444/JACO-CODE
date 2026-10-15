import test from 'node:test';
import assert from 'node:assert/strict';
import { createHuggingFaceAccount } from '../../runtime/src/server/huggingface/huggingFaceAccount.mjs';

test('no credential has no fabricated identity or repositories', async () => {
  const account = createHuggingFaceAccount({ env: {}, fetchImpl: () => { throw new Error('unexpected network'); } });
  assert.equal((await account.status()).status, 'NOT_CONFIGURED');
  assert.deepEqual((await account.repos()).repos, []);
});
test('each customer account owns its observed repository query; secrets and fake verification are excluded', async () => {
  for (const username of ['customer-one', 'customer-two']) {
    const calls = [];
    const account = createHuggingFaceAccount({ env: { HF_TOKEN: 'fixture-secret' }, fetchImpl: async url => {
      calls.push(url);
      return { ok: true, json: async () => url.endsWith('whoami-v2') ? { name: username, email: 'private', auth: { accessToken: { token: 'fixture-secret' } } } : [{ id: `${username}/project`, likes: 2 }] };
    } });
    const result = await account.repos();
    assert.equal(result.author, username);
    assert.equal(result.repos.length, 3);
    assert.equal(result.role, null);
    assert.ok(calls.slice(1).every(url => new URL(url).searchParams.get('author') === username));
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret|private|verifiedLive|pricing/);
  }
});
test('invalid credentials and repository failures are unavailable, never successful empty observations', async () => {
  const rejected = createHuggingFaceAccount({ env: { HF_TOKEN: 'fixture' }, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal((await rejected.status()).error, 'HF_AUTH_REQUIRED');
  const failed = createHuggingFaceAccount({ env: { HF_TOKEN: 'fixture' }, fetchImpl: async url => ({ ok: url.endsWith('whoami-v2'), status: 503, json: async () => ({ name: 'customer' }) }) });
  assert.equal((await failed.repos()).success, false);
});
