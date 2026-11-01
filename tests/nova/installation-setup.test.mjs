import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSetup, saveSetup, installationEnv } from '../../lite/setup-state.mjs';
import { discoverLocalModels, LOCAL_MODEL_ENDPOINTS } from '../../runtime/src/server/connected/connectionSetup.mjs';
import { importProviderEnvText } from '../../agents/lib/provider-env-import.mjs';
import { automaticConnections } from '../../runtime/src/server/connected/automaticConnections.mjs';

const choices = { confirmed: true, language: 'en', discoverLocal: true, connectTools: true, runAgent: true, cloudModels: false };

test('installed first start waits for explicit choices; a saved receipt survives restart without secrets', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-installation-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  assert.equal(readSetup(project), null);
  assert.throws(() => saveSetup(project, { ...choices, confirmed: false }), /CONFIRMATION_REQUIRED/);
  assert.throws(() => saveSetup(project, { ...choices, runAgent: 'true' }), /OPTION_INVALID/);
  assert.throws(() => saveSetup(project, { ...choices, language: 'arbitrary' }), /LANGUAGE_INVALID/);
  const pending = installationEnv({ JACO_REQUIRE_SETUP: '1' }, null);
  assert.equal(pending.JACO_SETUP_PENDING, '1');
  assert.equal(pending.JACO_PROVIDER_DISCOVERY, '0');
  assert.equal(pending.JACO_AUTO_START_TOOLS, '0');
  assert.equal(pending.JACO_ALLOW_PAID_MODELS, '0');
  const saved = saveSetup(project, { ...choices, token: 'never-store-this', arbitraryGrant: true });
  assert.deepEqual(readSetup(project), saved);
  assert.equal(JSON.stringify(saved).includes('never-store'), false);
  assert.equal(Object.hasOwn(saved, 'arbitraryGrant'), false);
  const env = installationEnv({ JACO_REQUIRE_SETUP: '1', KEEP: 'value' }, readSetup(project));
  assert.equal(env.JACO_SETUP_PENDING, '0'); assert.equal(env.KEEP, 'value');
  assert.equal(env.JACO_AUTO_START_TOOLS, '1');
  assert.equal(env.JACO_ALLOW_PAID_MODELS, undefined, 'the existing economic policy remains the cloud permission owner');
  assert.deepEqual(installationEnv({ EXISTING: 'installation' }, null), { EXISTING: 'installation' });
});

test('setup rejects a linked state directory and malformed receipt instead of trusting it', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-setup-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-setup-outside-'));
  t.after(() => { fs.rmSync(project, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.symlinkSync(outside, path.join(project, '.jaco'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => saveSetup(project, choices), /PATH_UNSAFE/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(project, '.jaco')); fs.mkdirSync(path.join(project, '.jaco'));
  fs.writeFileSync(path.join(project, '.jaco', 'installation.json'), '{malformed');
  assert.equal(readSetup(project), null);
});

test('local discovery requires approval, checks only four known loopback services and rejects HTML and large bodies', async () => {
  const calls = [], registered = [];
  const registry = { providers: new Map(), register: provider => registered.push(provider) };
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes(':1234')) return new Response('<html>not a provider</html>', { headers: { 'content-type': 'text/html' } });
    if (url.includes(':9379')) return new Response('x'.repeat(300 * 1024), { headers: { 'content-type': 'application/json' } });
    if (url.includes(':9380')) return Response.json({ data: [{ other: 'not an ID' }] });
    return Response.json({ data: [{ id: 'embedding' }, { id: 'coder' }, { id: 'coder' }] });
  };
  await assert.rejects(discoverLocalModels({ registry, fetchImpl }), /CONFIRMATION_REQUIRED/);
  assert.equal(calls.length, 0);
  const result = await discoverLocalModels({ confirmed: true, registry, fetchImpl });
  assert.deepEqual(calls, LOCAL_MODEL_ENDPOINTS.map(p => p.baseUrl + '/models'));
  assert.equal(registered.length, 1); assert.equal(registered[0].defaultModel, 'coder');
  assert.deepEqual(result.providers[0].models, ['embedding', 'coder']);
  assert.equal(result.providers.filter(p => p.state === 'UNAVAILABLE').length, 3);
  assert.ok(result.providers.every(p => p.inference === 'UNTESTED'));
});

test('environment-file import accepts only catalogued model keys and never returns values or replaces credentials', () => {
  const stored = new Map([['OPENAI_API_KEY', 'existing-private-value']]);
  const store = { has: name => stored.has(name), set: (name, value) => stored.set(name, value) };
  const text = 'OPENAI_API_KEY=sk-proj-dummy-key-for-test\nGEMINI_API_KEY=AIzaDummyKeyForImportTest\nSTRIPE_SECRET_KEY=do-not-copy-payments\nUNKNOWN_TOKEN=do-not-copy\n';
  assert.throws(() => importProviderEnvText({ text, store }), /CONFIRMATION_REQUIRED/);
  const result = importProviderEnvText({ text, store, confirmed: true });
  assert.deepEqual(result.imported, ['gemini']); assert.deepEqual(result.kept, ['openai']);
  assert.equal(stored.get('OPENAI_API_KEY'), 'existing-private-value');
  assert.equal(stored.has('STRIPE_SECRET_KEY') || stored.has('UNKNOWN_TOKEN'), false);
  assert.equal(JSON.stringify(result).includes('AIzaDummy'), false);
  assert.throws(() => importProviderEnvText({ text: 'x'.repeat(128 * 1024 + 1), confirmed: true, store }), /TOO_LARGE/);
});

test('first-run background connections do not open a vault, scan providers or launch tools', async () => {
  const unexpected = () => { throw Error('unexpected action before setup'); };
  const connections = automaticConnections({ registry: { ensureDefaults: unexpected, list: unexpected },
    mcpHost: { status: unexpected }, loadCredentials: unexpected,
    env: { JACO_PROVIDER_DISCOVERY: '0', JACO_AUTO_START_TOOLS: '0' } });
  const result = await connections.refresh();
  assert.equal(result.state, 'DISCOVERY_DISABLED'); assert.equal(result.ok, false);
  assert.deepEqual(result.providers, []); assert.deepEqual(result.tools, []);
});
