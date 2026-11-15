import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalOllamaChat, withLocalOllamaContext } from '../../agents/lib/ollama-native.mjs';
import { invokeSeerProvider } from '../../gateway/src/seer-model-provider.mjs';

const CHAT = 'http://127.0.0.1:11434/v1/chat/completions';
const init = body => ({ method: 'POST', headers: {}, body: JSON.stringify(body) });

test('a local Ollama chat goes native with a real context size and answers in the OpenAI shape', async () => {
  let sent, sentUrl;
  const fetchImpl = async (url, options) => { sentUrl = url; sent = JSON.parse(options.body); return Response.json({ model: 'm', done_reason: 'stop', prompt_eval_count: 8000, eval_count: 3, message: { content: '', tool_calls: [{ function: { name: 'repo_read', arguments: { path: 'a' } } }] } }); };
  const response = await withLocalOllamaContext(fetchImpl, {})(CHAT, init({ model: 'm', temperature: 0.2, max_tokens: 50, tool_choice: 'auto', tools: [{ type: 'function', function: { name: 'repo_read' } }],
    messages: [{ role: 'user', content: 'goal' }, { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'repo_read', arguments: '{"path":"b"}' } }] }, { role: 'tool', content: 'ok' }] }));
  assert.equal(sentUrl, 'http://127.0.0.1:11434/api/chat');
  assert.deepEqual(sent.options, { num_ctx: 16384, temperature: 0.2, num_predict: 50 });
  assert.equal(sent.stream, false);
  assert.deepEqual(sent.messages[1].tool_calls[0].function.arguments, { path: 'b' }, 'native tool arguments are objects');
  const data = await response.json();
  assert.equal(data.usage.prompt_tokens, 8000);
  const call = data.choices[0].message.tool_calls[0];
  assert.deepEqual([call.function.name, JSON.parse(call.function.arguments).path, data.choices[0].finish_reason], ['repo_read', 'a', 'tool_calls']);
});

test('the error text survives so a model without tools is still recognized, and the context size is configurable', async () => {
  let sent;
  const fetchImpl = async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ error: 'm does not support tools' }, { status: 400 }); };
  const response = await withLocalOllamaContext(fetchImpl, { JACO_OLLAMA_NUM_CTX: '8192' })(CHAT, init({ model: 'm', messages: [] }));
  assert.equal(response.status, 400);
  assert.match(await response.text(), /does not support tools/);
  assert.equal(sent.options.num_ctx, 8192);
});

test('everything that is not a local Ollama chat passes through untouched', async () => {
  const urls = [];
  const fetchImpl = async url => { urls.push(url); return Response.json({ choices: [] }); };
  const wrapped = withLocalOllamaContext(fetchImpl, {});
  for (const url of ['https://api.deepseek.com/v1/chat/completions', 'http://127.0.0.1:1234/v1/chat/completions', 'http://127.0.0.1:11434/api/tags']) await wrapped(url, init({ model: 'm' }));
  assert.deepEqual(urls, ['https://api.deepseek.com/v1/chat/completions', 'http://127.0.0.1:1234/v1/chat/completions', 'http://127.0.0.1:11434/api/tags']);
  assert.equal(isLocalOllamaChat('https://example.com:11434/v1/chat/completions', {}), false);
  assert.equal(isLocalOllamaChat('http://localhost:9999/v1/chat/completions', { OLLAMA_BASE_URL: 'http://localhost:9999' }), true);
});

test('SEER sends only Ollama providers natively, even when another local provider shares the configured port', async () => {
  const urls = [];
  const fetchFn = async url => { urls.push(url); return Response.json({ choices: [{ message: { content: 'ok' } }] }); };
  const env = { OLLAMA_BASE_URL: 'http://127.0.0.1:9999' };
  const url = 'http://127.0.0.1:9999/v1/chat/completions';
  for (const name of ['litert', 'ollama']) await invokeSeerProvider({ name, url, model: 'm', local: true }, { system: 's', user: 'u' }, { env, fetchFn });
  assert.deepEqual(urls, [url, 'http://127.0.0.1:9999/api/chat']);
});

test('an error object from Ollama keeps its message, so a tools refusal is still recognized', async () => {
  const fetchImpl = async () => Response.json({ error: { message: 'native tool calling unsupported' } }, { status: 400 });
  const response = await withLocalOllamaContext(fetchImpl, {})(CHAT, init({ model: 'm', tools: [{ type: 'function', function: { name: 'x' } }] }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.message, 'native tool calling unsupported');
});
