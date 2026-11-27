// The structured start of JACO: every tick comes from what the runtime reports (operator 2026-11-25).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupSteps, suggestModel, plausibleKey, vaultRows, STEP_IDS } from '../../runtime/operator-stage/setupSteps.mjs';

const ready = { ok: true, runtime: { up: true }, providers: [{ id: 'ollama', active: true }], planner: { provider: 'ollama', model: 'q', reachable: true }, tools: { toolCount: 12 } };
const ids = r => r.steps.map(s => s.id).join(',');

test('the steps come in the operator\'s order', () => {
  assert.deepEqual([...STEP_IDS], ['api', 'brain', 'vault', 'provider', 'activate']);
  assert.equal(ids(setupSteps({})), 'api,brain,vault,provider,activate');
});

test('nothing is ticked before the runtime answers, and the first step is current', () => {
  const r = setupSteps({});
  assert.equal(r.current, 'api'); assert.equal(r.ready, false);
  assert.equal(setupSteps({ error: 'x', report: ready }).current, 'api', 'an error means the runtime cannot be trusted');
});

test('the flow moves api, brain, vault, provider, activate as the report improves', () => {
  const up = { runtime: { up: true }, providers: [], planner: null, tools: { toolCount: 0 } };
  assert.equal(setupSteps({ report: up }).current, 'brain');
  const withModel = { ...up, providers: [{ id: 'gemini', active: true }] };
  assert.equal(setupSteps({ report: withModel, vault: { available: true, keys: ['GROQ_API_KEY'], configured: [] } }).current, 'vault');
  assert.equal(setupSteps({ report: withModel }).current, 'provider', 'nothing to fetch: the vault step is done');
  const verified = { ...withModel, planner: { provider: 'gemini', model: 'm', reachable: true } };
  assert.equal(setupSteps({ report: verified }).current, 'activate');
  const all = setupSteps({ report: ready });
  assert.equal(all.current, null); assert.equal(all.ready, true);
});

test('the vault step is optional: skipping it moves on, but never marks it done', () => {
  const report = { runtime: { up: true }, providers: [{ active: true }], planner: null, tools: { toolCount: 0 } };
  const vault = { available: true, keys: ['A_KEY', 'B_KEY'], configured: ['B_KEY'] };
  const open = setupSteps({ report, vault });
  assert.equal(open.current, 'vault'); assert.equal(open.steps[2].detail, '1 to fetch');
  const skipped = setupSteps({ report, vault, skippedVault: true });
  assert.equal(skipped.current, 'provider'); assert.equal(skipped.steps[2].done, false); assert.equal(skipped.steps[2].skipped, true);
});

test('a model that is connected but has not answered is not a connected provider', () => {
  const r = setupSteps({ report: { runtime: { up: true }, providers: [{ active: true }], planner: { provider: 'gemini', model: 'm', reachable: false }, tools: { toolCount: 9 }, ok: true } });
  assert.equal(r.current, 'provider'); assert.equal(r.steps[3].detail, 'NOT_VERIFIED');
  assert.equal(r.steps[4].done, false, 'tools only count once the model is verified');
});

test('ready needs the agent runtime ok, not only started tools', () => {
  const r = setupSteps({ report: { ...ready, ok: false } });
  assert.equal(r.ready, false); assert.equal(r.current, 'activate');
});

test('a local model is suggested before a cloud one, with its own default', () => {
  const providers = [
    { id: 'gemini', local: false, credentialReady: true, defaultModel: 'g1', models: ['g1', 'g2'] },
    { id: 'ollama', local: true, credentialReady: true, defaultModel: 'missing', models: ['qwen3:0.6b', 'qwen2.5:3b'] },
    { id: 'groq', local: false, credentialReady: false, defaultModel: 'x', models: ['x'] },
  ];
  assert.deepEqual(suggestModel(providers), { provider: 'ollama', model: 'qwen3:0.6b', local: true });
  assert.deepEqual(suggestModel(providers.slice(0, 1)), { provider: 'gemini', model: 'g1', local: false });
  assert.equal(suggestModel([{ id: 'groq', credentialReady: false, models: ['x'] }, { id: 'e', models: [] }]), null);
});

test('only a key-shaped single token is accepted from the field', () => {
  assert.equal(plausibleKey(' AIzaSyExampleExampleExample1234 '), true);
  for (const bad of ['', 'short', 'two words in a key value', 'x'.repeat(401), null]) assert.equal(plausibleKey(bad), false);
});

// Observed 2026-11-26: every Windows vault key was already stored, but Setup listed 14 of them as not fetched,
// because it compared against a list of known service names only. A stored key must show as fetched.
test('a key JACO has stored shows as fetched, whatever its name', () => {
  const vault = { available: true, keys: ['NOVA_X402_PAY_TO', 'GEMINI_API_KEY', 'NEW_KEY'], fetched: ['NOVA_X402_PAY_TO'], configured: ['GEMINI_API_KEY'] };
  assert.deepEqual(vaultRows(vault), [
    { name: 'NOVA_X402_PAY_TO', state: 'FETCHED' },
    { name: 'GEMINI_API_KEY', state: 'PRESENT' },
    { name: 'NEW_KEY', state: 'PENDING' },
  ]);
  const report = { runtime: { up: true }, providers: [{ active: true }] };
  const step = v => setupSteps({ report, vault: v }).steps.find(s => s.id === 'vault');
  assert.equal(step(vault).done, false);
  assert.equal(step(vault).detail, '1 to fetch');
  assert.equal(step({ ...vault, fetched: ['NOVA_X402_PAY_TO', 'NEW_KEY'] }).done, true);
});
