// The ChatGPT plan account: kept encrypted on this computer, refreshed, used only as the operator allowed, and
// removed on disconnect. Fixtures only; nothing here reaches OpenAI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ChatGPTPlanSession, chatGPTAccountStore } from '../../runtime/src/server/connected/chatgptPlanSession.mjs';
import { completePlan, refreshSession, restoreSession, revokeSession } from '../../runtime/src/server/connected/chatgptPlanTransport.mjs';
import { manualAuraProviderCompletion } from '../../runtime/src/server/connected/auraOllamaChat.mjs';
import { summarizeAuraModelCosts } from '../../agents/lib/aura-seer-chat.mjs';

const AUTH = 'https://auth.openai.com';
const clientId = 'oaiapp_fixture';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' }] };
const jwt = claims => {
  const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = enc({ alg: 'RS256', kid: 'fixture' }) + '.' + enc({ iss: AUTH, sub: 'fixture-sub', aud: clientId, iat: now, exp: now + 600, ...claims });
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), keys.privateKey).toString('base64url');
};
const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
const stream = text => new Response([{ type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 1 } } }].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''));

const record = (overrides = {}) => ({ issuer: AUTH, subject: 'fixture-sub', email: 'person@example.com', clientId, accessToken: 'access-1', refreshToken: 'refresh-1',
  scopes: ['openid', 'resource.invoke', 'chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3_600_000, ...overrides });

// A fake OpenAI: counts every call and rotates the refresh token as the real service does.
function openai({ refreshStatus = 200 } = {}) {
  const calls = [];
  let n = 1;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth/token')) {
      assert.equal(init.body.get('grant_type'), 'refresh_token');
      if (refreshStatus !== 200) return json({ error: 'invalid_grant' }, refreshStatus);
      n++;
      return json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, token_type: 'Bearer', expires_in: 3600 });
    }
    if (url.endsWith('/models')) return json({ models: [{ slug: 'plan-model', visibility: 'list', display_name: 'Plan model' }] });
    if (url.endsWith('/responses')) return stream('hello');
    if (url.endsWith('/openid-configuration')) return json({ revocation_endpoint: AUTH + '/api/accounts/oauth/revoke' });
    if (url.endsWith('/revoke')) return new Response('', { status: 200 });
    if (url.endsWith('/jwks.json')) return json(jwks);
    throw Error('unexpected ' + url);
  };
  return { calls, fetchImpl };
}
const memoryStore = initial => { let saved = initial; return { load: () => saved, save: v => { saved = structuredClone(v); }, clear: () => { saved = null; }, get saved() { return saved; } }; };
const session = (store, api) => new ChatGPTPlanSession({ store, fetchImpl: api.fetchImpl, hostId: () => 'urn:uuid:12345678-1234-4321-9876-123456789abc' });

test('system text travels as instructions, never as a system input item', async () => {
  const api = openai();
  await completePlan(restoreSession(record()), { model: 'plan-model', messages: [{ role: 'system', content: 'You are Aura.' }, { role: 'user', content: 'hi' }], fetchImpl: api.fetchImpl });
  const body = JSON.parse(api.calls.at(-1).init.body);
  assert.equal(body.instructions, 'You are Aura.');
  assert.deepEqual(body.input, [{ role: 'user', content: 'hi' }]);
  assert.equal(body.store, false);
  for (const omitted of ['temperature', 'max_output_tokens', 'user']) assert.equal(body[omitted], undefined);
});

test('a refresh sends the issued client, no scope, and keeps the verified account', async () => {
  const api = openai();
  const next = await refreshSession(restoreSession(record()), { fetchImpl: api.fetchImpl });
  const body = api.calls[0].init.body;
  assert.equal(body.get('client_id'), clientId);
  assert.equal(body.get('refresh_token'), 'refresh-1');
  assert.equal(body.get('resource'), 'https://api.openai.com/v1');
  assert.equal(body.get('scope'), null);
  assert.equal(next.refreshToken, 'refresh-2');
  assert.equal(next.subject, 'fixture-sub');
  await assert.rejects(refreshSession(restoreSession(record()), { fetchImpl: async () => json({ access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 60, scope: 'openid' }) }), /SIWC_PLAN_NOT_GRANTED/);
  await assert.rejects(refreshSession(restoreSession(record()), { fetchImpl: async url => url.endsWith('/jwks.json') ? json(jwks)
    : json({ access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 60, id_token: jwt({ sub: 'someone-else' }) }) }), /SIWC_ACCOUNT_MISMATCH/);
});

test('revocation goes only to an OpenAI endpoint', async () => {
  const api = openai();
  await revokeSession(restoreSession(record()), { fetchImpl: api.fetchImpl });
  assert.equal(api.calls.at(-1).init.body.get('token_type_hint'), 'refresh_token');
  await assert.rejects(revokeSession(restoreSession(record()), { fetchImpl: async () => json({ revocation_endpoint: 'https://elsewhere.example/revoke' }) }), /SIWC_REVOCATION_INVALID/);
  assert.throws(() => restoreSession(record({ scopes: ['openid'] })), /SIWC_ACCOUNT_INVALID/);
});

test('the account survives a restart, and an expired access token is refreshed once for concurrent requests', async () => {
  const store = memoryStore(record({ expiresAt: Date.now() - 1 }));
  const api = openai();
  const plan = session(store, api);
  assert.equal(plan.status().connected, true);
  const [a, b] = await Promise.all([plan.complete({ model: 'plan-model', system: 's', user: 'one' }), plan.complete({ model: 'plan-model', system: 's', user: 'two' })]);
  assert.equal(a.content, 'hello'); assert.equal(b.content, 'hello');
  assert.equal(api.calls.filter(c => c.url.endsWith('/oauth/token')).length, 1);
  assert.equal(store.saved.refreshToken, 'refresh-2');
});

test('a refused refresh asks for a new sign-in and sends nothing else', async () => {
  const store = memoryStore(record({ expiresAt: Date.now() - 1 }));
  const api = openai({ refreshStatus: 400 });
  const plan = session(store, api);
  await assert.rejects(plan.complete({ model: 'plan-model', system: 's', user: 'hi' }), /SIWC_RECONNECT_REQUIRED/);
  assert.equal(plan.status().state, 'expired');
  assert.equal(plan.chatChoice(), null);
  assert.ok(!api.calls.some(c => c.url.endsWith('/responses')));
});

test('chat uses the plan only after the operator turned it on, and background work needs its own consent', async () => {
  const store = memoryStore(record());
  const api = openai();
  const plan = session(store, api);
  assert.equal(plan.chatChoice(), null, 'signing in alone routes nothing');
  await plan.discover();
  assert.throws(() => plan.use({ enabled: true, model: 'unknown' }), /SIWC_MODEL_NOT_DISCOVERED/);
  plan.use({ enabled: true, model: 'plan-model' });
  assert.deepEqual(plan.chatChoice(), { providerId: 'chatgpt-plan', model: 'plan-model' });
  assert.deepEqual(session(store, api).chatChoice(), { providerId: 'chatgpt-plan', model: 'plan-model' }, 'remembered across a restart');
  await assert.rejects(plan.complete({ model: 'plan-model', system: 's', user: 'u', background: true }), /SIWC_BACKGROUND_CONSENT_REQUIRED/);
  plan.use({ enabled: true, model: 'plan-model', backgroundAllowed: true });
  assert.equal((await plan.complete({ model: 'plan-model', system: 's', user: 'u', background: true })).content, 'hello');
});

test('status never carries a token or the full address, and disconnect revokes and forgets', async () => {
  const store = memoryStore(record());
  const api = openai();
  const plan = session(store, api);
  const text = JSON.stringify(plan.status());
  for (const secret of ['access-1', 'refresh-1', 'person@example.com', clientId, 'fixture-sub']) assert.ok(!text.includes(secret), secret);
  assert.match(plan.status().account, /^p.*@example\.com$/);
  const after = await plan.disconnect();
  assert.equal(after.connected, false);
  assert.equal(after.revoked, true);
  assert.equal(store.saved, null);
});

test('the account is written encrypted to its own folder, away from the vault that tools list', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-siwc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = chatGPTAccountStore({ JACO_STATE_DIR: dir });
  assert.equal(store.load(), null);
  store.save(record());
  assert.equal(store.load().refreshToken, 'refresh-1');
  const files = fs.readdirSync(path.join(dir, 'siwc'));
  assert.ok(files.includes('secrets.json'));
  assert.ok(!fs.readFileSync(path.join(dir, 'siwc', 'secrets.json'), 'utf8').includes('refresh-1'));
  assert.ok(!fs.existsSync(path.join(dir, 'secrets.json')), 'nothing in the shared vault');
  store.clear();
  assert.equal(store.load(), null);
});

test('an answer from the plan is not billed to the cloud budget', async () => {
  const economic = new Proxy({}, { get: () => () => { throw Error('the budget must not be touched'); } });
  const plan = { complete: async ({ model }) => ({ model, content: 'from the plan', finishReason: 'stop' }) };
  const providers = { list: () => [] };
  const r = await manualAuraProviderCompletion({ providerId: 'chatgpt-plan', model: 'plan-model', system: 's', user: 'u' }, { providers, economic, plan });
  assert.deepEqual([r.text, r.provider, r.model, r.costStatus], ['from the plan', 'chatgpt-plan', 'plan-model', 'PLAN']);
  await assert.rejects(manualAuraProviderCompletion({ providerId: 'chatgpt-plan', model: 'plan-model', system: 's', user: 'u' }, { providers, economic }), /AURA_PROVIDER_NOT_REGISTERED/);
  assert.equal(summarizeAuraModelCosts([{ status: 'PLAN', usd: null }]).costStatus, 'PLAN');
  assert.equal(summarizeAuraModelCosts([{ status: 'PLAN' }, { status: 'OUTCOME_UNKNOWN' }]).costStatus, 'OUTCOME_UNKNOWN');
});

test('the runtime uses the plan only for the operator\'s own interface and never falls back to a paid model', () => {
  const server = fs.readFileSync(new URL('../../runtime/server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /JACO_LOCAL_SIWC !== '1'/);
  assert.match(server, /background: !fromOperatorInterface/);
  assert.match(server, /const planOnly = chatChoice\?\.providerId === 'chatgpt-plan'/);
});
