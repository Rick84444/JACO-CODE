// Operator 2026-10-02: switch Nova's planner (e.g. to DeepSeek V4) from the GUI instead of .env.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-planner-choice-'));
process.env.NOVA_STATE_DIR = dir;
process.env.NOVA_BRAIN_MODE = 'direct';
const { orderedBrainProviders, brainCandidates } = await import('../../agents/hands-off-agent.mjs');
const { plannerChoiceFile, validatePlannerChoice, writePlannerChoice, clearPlannerChoice, testPlannerModel } = await import('../../agents/lib/planner-choice.mjs');

const file = path.join(dir, 'provider-preference.json');
const env = { JACO_PLANNER_CHOICE_FILE: file, JACO_PRIMARY_PROVIDER: 'groq' };

test('the environment primary leads the chain over a stale GUI choice', () => {
  writePlannerChoice(file, { provider: 'deepseek', model: 'deepseek-v4-pro' }, 'operator');
  const chain = orderedBrainProviders(env);
  assert.equal(chain[0].name, 'groq');
  assert.equal(chain.find(p => p.name === 'deepseek').chosen, undefined);
  assert.equal(chain.filter(p => p.name === 'deepseek').length, 1);
  assert.deepEqual(brainCandidates(env).filter(p => p.name === 'deepseek').map(p => p.model), ['deepseek-flash', 'deepseek-v4-pro']);
  clearPlannerChoice(file);
  assert.equal(orderedBrainProviders(env)[0].name, 'groq');
});

test('an operator choice applies only when the environment has no primary', () => {
  writePlannerChoice(file, { provider: 'deepseek', model: 'deepseek-v4-pro' }, 'operator');
  assert.equal(orderedBrainProviders({ JACO_PLANNER_CHOICE_FILE: file })[0].model, 'deepseek-v4-pro');
  clearPlannerChoice(file);
});

test('an agent choice stays free-only and behind the operator primary', () => {
  writePlannerChoice(file, { provider: 'deepseek', model: 'deepseek-v4-pro' }, 'aura-chat');
  assert.equal(orderedBrainProviders(env)[0].name, 'groq');
  assert.equal(orderedBrainProviders(env).find(p => p.name === 'deepseek').chosen, undefined);
  writePlannerChoice(file, { provider: 'openrouter', model: 'qwen/qwen3.8-27b:free' }, 'aura-chat');
  assert.deepEqual(orderedBrainProviders(env).slice(0, 2).map(p => p.name), ['groq', 'openrouter']);
  clearPlannerChoice(file);
});

test('only listed models with a key can be chosen; paid models are on unless JACO_ALLOW_PAID_MODELS=0', () => {
  const keyed = { DEEPSEEK_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '1' };
  assert.deepEqual(validatePlannerChoice({ provider: 'deepseek', model: 'deepseek-v4-pro' }, keyed), { provider: 'deepseek', model: 'deepseek-v4-pro', paid: true });
  assert.throws(() => validatePlannerChoice({ provider: 'deepseek', model: 'gpt-9' }, keyed), /PLANNER_MODEL_UNKNOWN/);
  assert.throws(() => validatePlannerChoice({ provider: 'nope' }, keyed), /PLANNER_PROVIDER_UNKNOWN/);
  assert.throws(() => validatePlannerChoice({ provider: 'deepseek', model: 'deepseek-v4-pro' }, { JACO_ALLOW_PAID_MODELS: '1' }), /PLANNER_KEY_MISSING:DEEPSEEK_API_KEY/);
  assert.throws(() => validatePlannerChoice({ provider: 'deepseek', model: 'deepseek-v4-pro' }, { DEEPSEEK_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '0' }), /PLANNER_PAID_MODELS_DISABLED/);
  assert.equal(validatePlannerChoice({ provider: 'deepseek', model: 'deepseek-v4-pro' }, { DEEPSEEK_API_KEY: 'x' }).paid, true, 'a configured key is enough');
});

test('Ollama Cloud planner models come from environment', () => {
  const env = { OLLAMA_CLOUD_MODEL: 'gpt-oss:120b', JACO_OLLAMA_CLOUD_MODELS: 'gpt-oss:120b,another-priced-model', OLLAMA_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '1' };
  assert.deepEqual(validatePlannerChoice({ provider: 'ollama-cloud' }, env), { provider: 'ollama-cloud', model: 'gpt-oss:120b', paid: true });
  assert.deepEqual(validatePlannerChoice({ provider: 'ollama-cloud', model: 'another-priced-model' }, env).model, 'another-priced-model');
});

test('runtime and Nova resolve the same choice file through JACO_RUNTIME_DIR', () => {
  const runtimeDir = path.join(dir, 'runtime');
  assert.equal(plannerChoiceFile({ JACO_RUNTIME_DIR: runtimeDir, JACO_WORKSPACE_ROOT: path.join(dir, 'checkout') }), path.join(runtimeDir, '.jaco', 'state', 'provider-preference.json'));
});

test('Aura model probe always uses shared Continuum reserve/settle for a metered model', async () => {
  const env = { DEEPSEEK_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '1' };
  const paths = [];
  const fetchImpl = async (url, init) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/reserve')) {
      assert.equal(JSON.parse(init.body).providerId, 'deepseek');
      return Response.json({ success: true, reservationId: 'probe-1' });
    }
    if (url.endsWith('/settle')) return Response.json({ success: true, costUsd: 0.001 });
    assert.equal(JSON.parse(init.body).model, 'deepseek-v4-pro');
    return Response.json({ choices: [{ message: { content: ' OK ' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  };
  const ok = await testPlannerModel({ provider: 'deepseek', model: 'deepseek-v4-pro' }, { env, fetchImpl });
  assert.equal(ok.ok, true); assert.equal(ok.reply, 'OK'); assert.equal(typeof ok.latencyMs, 'number');
  assert.deepEqual(paths, ['/api/nova/ollama-cost/reserve', '/v1/chat/completions', '/api/nova/ollama-cost/settle']);
});

test('Aura probe refuses unapproved spend or denied reservation before contacting a provider', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(new URL(url).pathname); return Response.json({ success: false, error: 'AUTONOMOUS_CLOUD_BURST_LIMIT' }, { status: 403 }); };
  const off = await testPlannerModel({ provider: 'deepseek', model: 'deepseek-flash' }, { env: { DEEPSEEK_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '0' }, fetchImpl });
  assert.equal(off.ok, false); assert.match(off.error, /PAID_PROVIDER_DISABLED/); assert.deepEqual(calls, []);
  const denied = await testPlannerModel({ provider: 'deepseek', model: 'deepseek-flash' }, { env: { DEEPSEEK_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '1' }, fetchImpl });
  assert.equal(denied.ok, false); assert.match(denied.error, /AUTONOMOUS_CLOUD_BURST_LIMIT/);
  assert.deepEqual(calls, ['/api/nova/ollama-cost/reserve']);
});

test('Aura model probe releases definite no-charge failures and retains uncertain outcomes', async () => {
  const events = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    events.push(path);
    if (path.endsWith('/reserve')) return Response.json({ success: true, reservationId: 'r' });
    if (path.endsWith('/release') || path.endsWith('/unknown')) return Response.json({ success: true });
    if (path.endsWith('/chat/completions')) return Response.json({ error: { message: 'Insufficient Balance' } }, { status: 402 });
    throw new Error('unexpected request');
  };
  const rejected = await testPlannerModel({ provider: 'deepseek', model: 'deepseek-flash' }, { env: { DEEPSEEK_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '1' }, fetchImpl });
  assert.equal(rejected.ok, false); assert.equal(rejected.status, 402); assert.match(rejected.error, /Insufficient/);
  assert.deepEqual(events, ['/api/nova/ollama-cost/reserve', '/v1/chat/completions', '/api/nova/ollama-cost/release']);
  const stalledEvents = [];
  const stalled = await testPlannerModel({ provider: 'deepseek', model: 'deepseek-flash' }, {
    env: { DEEPSEEK_API_KEY: 'x', JACO_ALLOW_PAID_MODELS: '1' },
    fetchImpl: async url => {
      const p = new URL(url).pathname; stalledEvents.push(p);
      if (p.endsWith('/reserve')) return Response.json({ success: true, reservationId: 'r2' });
      if (p.endsWith('/unknown')) return Response.json({ success: true });
      throw new Error('The operation was aborted due to timeout');
    },
  });
  assert.equal(stalled.ok, false); assert.match(stalled.error, /timeout/);
  assert.deepEqual(stalledEvents, ['/api/nova/ollama-cost/reserve', '/v1/chat/completions', '/api/nova/ollama-cost/unknown']);
});

test('keyless HTTPS providers remain budgeted; real loopback local models are free', async () => {
  const extra = { team: { label: 'Team', paid: true, keyEnv: null, url: 'https://llm.team.test/v1/chat/completions', models: ['qwen3:32b'] } };
  const metered = [];
  const result = await testPlannerModel({ provider: 'team', model: 'qwen3:32b' }, {
    env: { JACO_ALLOW_PAID_MODELS: '1' }, extra,
    fetchImpl: async (url, init) => {
      const p = new URL(url).pathname; metered.push(p);
      if (p.endsWith('/reserve')) return Response.json({ success: true, reservationId: 'keyless' });
      if (p.endsWith('/settle')) return Response.json({ success: true });
      assert.equal(init.headers.Authorization, undefined);
      return Response.json({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 2, completion_tokens: 2 } });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(metered, ['/api/nova/ollama-cost/reserve', '/v1/chat/completions', '/api/nova/ollama-cost/settle']);
  const localCalls = [];
  const local = await testPlannerModel({ provider: 'ollama', model: 'gemma3:4b' }, {
    env: {},
    fetchImpl: async url => { localCalls.push(new URL(url).pathname); return Response.json({ choices: [{ message: { content: 'OK' } }] }); },
  });
  assert.equal(local.ok, true);
  assert.deepEqual(localCalls, ['/v1/chat/completions']);
  const refused = await testPlannerModel({ provider: 'ollama', model: 'gpt-oss:120b-cloud' }, {
    env: { OLLAMA_MODEL: 'gpt-oss:120b-cloud' },
    fetchImpl: async () => assert.fail('an Ollama cloud relay cannot be treated as free local inference'),
  });
  assert.equal(refused.ok, false); assert.match(refused.error, /OLLAMA_CLOUD_RELAY_NOT_RESERVABLE/);
});

// Operator 2026-10-13: a provider connected from a URL or a key, and a model the fixed list does not know,
// can be chosen for Nova (they were invisible, so switching "did not work").
import { plannerChoices as _pc, validatePlannerChoice as _validate } from '../../agents/lib/planner-choice.mjs';
const EXTRA = {
  mistral: { label: 'mistral', paid: true, keyEnv: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/chat/completions', models: ['mistral-large-latest'] },
  ollama: { label: 'ollama (lokal)', paid: false, keyEnv: null, url: 'http://127.0.0.1:11434/v1/chat/completions', models: ['qwen2.5-coder:1.5b'] },
};
test('connected providers are offered next to the fixed ones, merged by name', () => {
  const all = _pc({}, EXTRA);
  assert.ok(all.mistral && all.mistral.models.includes('mistral-large-latest'));
  assert.ok(all.ollama.models.includes('qwen2.5-coder:1.5b'), 'a connected model joins the fixed list');
  assert.ok(all.ollama.models.includes('gemma3:4b'), 'the fixed model stays');
  assert.ok(!_pc({}).mistral, 'without the registry only the fixed list exists');
});
test('a connected provider and any model it serves can be chosen; a fixed one is still held to its list', () => {
  const env = { MISTRAL_API_KEY: 'k', JACO_STATE_DIR: '/nonexistent-state' };
  assert.deepEqual(_validate({ provider: 'mistral', model: 'mistral-small-latest' }, env, EXTRA), { provider: 'mistral', model: 'mistral-small-latest', paid: true });
  assert.throws(() => _validate({ provider: 'mistral', model: 'bad model!' }, env, EXTRA), /PLANNER_MODEL_UNKNOWN/);
  assert.throws(() => _validate({ provider: 'groq', model: 'anything' }, { GROQ_API_KEY: 'k' }), /PLANNER_MODEL_UNKNOWN/);
  assert.throws(() => _validate({ provider: 'mistral', model: 'm' }, { JACO_STATE_DIR: '/nonexistent-state' }, EXTRA), /PLANNER_KEY_MISSING/);
  assert.throws(() => _validate({ provider: 'nope', model: 'm' }, env, EXTRA), /PLANNER_PROVIDER_UNKNOWN/);
});

const { setConnectedProvidersForTest } = await import('../../agents/hands-off-agent.mjs');
test('Nova plans with the operator\'s chosen connected provider, which is not in its fixed chain', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  const file = path.join(dir, 'provider-preference.json');
  const env = { JACO_PLANNER_CHOICE_FILE: file, MISTRAL_API_KEY: 'k' };
  t.after(() => setConnectedProvidersForTest([]));
  setConnectedProvidersForTest([{ name: 'mistral', url: 'https://api.mistral.ai/v1/chat/completions', envKey: 'MISTRAL_API_KEY', model: 'mistral-large-latest' }]);
  assert.ok(!orderedBrainProviders(env).some(p => p.name === 'mistral'), 'not chosen: not in the chain');
  fs.writeFileSync(file, JSON.stringify({ provider: 'mistral', model: 'mistral-small-latest', by: 'operator' }));
  const first = orderedBrainProviders(env)[0];
  assert.equal(first.name, 'mistral');
  assert.equal(first.model, 'mistral-small-latest', 'the chosen model wins');
  assert.equal(first.chosen, true);
  // a local model chosen by name keeps working through the fixed entry, with the chosen model
  fs.writeFileSync(file, JSON.stringify({ provider: 'ollama', model: 'qwen2.5-coder:1.5b', by: 'operator' }));
  const local = orderedBrainProviders(env)[0];
  assert.equal(local.name, 'ollama'); assert.equal(local.model, 'qwen2.5-coder:1.5b');
});

// 2026-10-31: the GUI saved gemini/models/gemini-2.5-pro-preview-tts as Nova's planner; every turn failed with HTTP 400.
test('speech, embedding, image and video models are never planners', async () => {
  const { nonTextModelKind, readPlannerChoice } = await import('../../agents/lib/planner-choice.mjs');
  for (const [model, kind] of [['models/gemini-2.5-pro-preview-tts', 'tts'], ['text-embedding-004', 'embedding'],
    ['models/gemini-embedding-001', 'embedding'], ['imagen-4.0-generate-001', 'image'], ['veo-3.0-generate-preview', 'video'],
    ['gemini-2.5-flash-native-audio-dialog', 'audio'], ['whisper-large-v3', 'audio'], ['models/aqa', 'attributed-qa']]) {
    assert.equal(nonTextModelKind(model), kind, model);
  }
  for (const model of ['models/gemini-2.5-flash', 'deepseek-v4-pro', 'openai/gpt-oss-120b', 'gemma3:4b', 'qwen/qwen3.8-27b:free'])
    assert.equal(nonTextModelKind(model), null, model);

  const extra = { gemini: { label: 'Gemini', paid: true, keyEnv: null, url: 'https://example.invalid/v1/chat/completions', models: ['models/gemini-2.5-pro-preview-tts', 'models/gemini-2.5-flash'] } };
  assert.throws(() => validatePlannerChoice({ provider: 'gemini', model: 'models/gemini-2.5-pro-preview-tts' }, {}, extra), /PLANNER_MODEL_NOT_TEXT:tts/);
  let called = false;
  const probe = await testPlannerModel({ provider: 'gemini', model: 'models/gemini-2.5-pro-preview-tts' }, { env: {}, extra, fetchImpl: async () => { called = true; } });
  assert.equal(probe.ok, false);
  assert.match(probe.error, /PLANNER_MODEL_NOT_TEXT:tts/);
  assert.equal(called, false);

  // An already saved non-text choice is ignored, not deleted: Nova falls back to its automatic chain.
  const saved = path.join(dir, 'tts-choice.json');
  writePlannerChoice(saved, { provider: 'gemini', model: 'models/gemini-2.5-pro-preview-tts' }, 'operator');
  assert.equal(readPlannerChoice(saved), null);
  assert.ok(fs.existsSync(saved));
  const chain = orderedBrainProviders({ JACO_PLANNER_CHOICE_FILE: saved, GEMINI_MODEL: 'x' });
  assert.equal(chain.some(p => p.chosen), false);
});
