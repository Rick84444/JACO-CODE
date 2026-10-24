import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeSeerProvider, callSeerGovernorProvider } from '../src/seer-model-provider.mjs';

const provider = { name: 'deepseek', envKey: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', url: 'https://provider.invalid/chat/completions' };
const args = { system: 'system', user: 'user', image: 'private-image' };
const success = async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason:'stop', message: { content: ' answer ' } }] }) });

test('production planner preserves credentials, remote identity and image restriction', async () => {
  let request;
  const result = await callSeerGovernorProvider(args, {
    providers: [provider], env: { JACO_CLOUD_PLANNER: '1', JACO_ALLOW_PAID_MODELS: '1', JACO_PRIMARY_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-only' },
    fetchFn: async (url, options) => { request = options; return success(); },
    fallback: () => assert.fail('unexpected fallback'),
  });
  assert.equal(request.headers.Authorization, 'Bearer test-only');
  assert.equal(JSON.parse(request.body).messages[1].content, 'user');
  // Room for the full candidate plans: 2048 truncated DeepSeek's answers (2026-10-09).
  assert.equal(JSON.parse(request.body).max_tokens, 8192);
  assert.equal(result.local, false);
  assert.equal(result.text, 'answer');
  assert.equal(result.finishReason, 'stop');
});

test('planner fallback when disabled or missing key makes no cloud request', async () => {
  for (const env of [{ DEEPSEEK_API_KEY: 'test-only' }, { JACO_CLOUD_PLANNER: '1' }, { JACO_CLOUD_PLANNER: '1', JACO_ALLOW_PAID_MODELS: '1', JACO_PRIMARY_PROVIDER: 'groq', DEEPSEEK_API_KEY: 'test-only' }, {}]) {
    const result = await callSeerGovernorProvider(args, {
      providers: [provider], env, fetchFn: () => assert.fail('cloud forbidden'),
      fallback: async () => ({ ok: true, provider: 'ollama' }),
    });
    assert.equal(result.provider, 'ollama');
  }
});

test('JACO_ALLOW_PAID_MODELS=0 stops every cloud provider, planner or not', async () => {
  for (const [p, purpose] of [[provider, 'inference'], [{ ...provider, name: 'qwen' }, 'planner']]) {
    const failures = [];
    assert.equal(await invokeSeerProvider(p, args, {
      env: { JACO_CLOUD_PLANNER: '1', JACO_ALLOW_PAID_MODELS: '0', DEEPSEEK_API_KEY: 'test-only' }, purpose,
      fetchFn: () => assert.fail('paid inference forbidden'), onFailure: f => failures.push(f),
    }), null);
    assert.equal(failures[0].code, 'PAID_PROVIDER_DISABLED');
  }
});

test('HTTP failure falls back and exposes status without response body or credentials', async () => {
  const failures = [];
  const result = await callSeerGovernorProvider(args, {
    providers: [provider], env: { JACO_CLOUD_PLANNER: '1', JACO_ALLOW_PAID_MODELS: '1', JACO_PRIMARY_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-only' },
    fetchFn: async () => ({ ok: false, status: 401, text: () => assert.fail('must not read raw error') }),
    onFailure: f => failures.push(f), fallback: async () => ({ ok: false, error: 'all_providers_failed' }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(failures, [{ provider: 'deepseek', model: 'deepseek-chat', code: 'PROVIDER_HTTP_ERROR', status: 401 }]);
});

test('configured non-DeepSeek provider can serve the governor', async () => {
  const groq = { name: 'groq', envKey: 'GROQ_API_KEY', model: 'configured-model', url: 'https://provider.invalid/chat/completions' };
  const result = await callSeerGovernorProvider(args, {
    providers: [provider, groq],
    env: { JACO_CLOUD_PLANNER: '1', JACO_ALLOW_PAID_MODELS: '1', JACO_PRIMARY_PROVIDER: 'groq', GROQ_API_KEY: 'test-only' },
    fetchFn: success, fallback: () => assert.fail('unexpected fallback'),
  });
  assert.equal(result.provider, 'groq');
  assert.equal(result.model, 'configured-model');
});

test('malformed, whitespace and empty provider content fail closed', async () => {
  for (const content of [null, '', '  ', {}, []]) {
    const failures = [];
    const result = await invokeSeerProvider(provider, args, {
      env: { JACO_ALLOW_PAID_MODELS: '1', DEEPSEEK_API_KEY: 'test-only' },
      fetchFn: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }),
      onFailure: f => failures.push(f),
    });
    assert.equal(result, null);
    assert.equal(failures[0].code, 'PROVIDER_EMPTY_CONTENT');
  }
});

test('timeouts are classified without leaking raw exceptions', async () => {
  const failures = [];
  await invokeSeerProvider(provider, args, {
    env: { JACO_ALLOW_PAID_MODELS: '1', DEEPSEEK_API_KEY: 'test-only', JACO_SEER_INFERENCE_TIMEOUT_MS: 'invalid' },
    fetchFn: async () => { throw new DOMException('sensitive content', 'TimeoutError'); },
    onFailure: f => failures.push(f),
  });
  assert.equal(failures[0].code, 'PROVIDER_TIMEOUT');
  assert.equal(JSON.stringify(failures).includes('sensitive'), false);
});
