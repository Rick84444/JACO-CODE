#!/usr/bin/env node
// Run: node --import tsx scripts/verify_model_pool_providers.mjs
// The model pool must use an installed Ollama model and must not contact an unconfigured or failing LiteRT server
// on every generation.
import assert from 'node:assert/strict';
import http from 'node:http';

delete process.env.GEMINI_API_KEY;
delete process.env.OLLAMA_MODEL;
delete process.env.JACO_LITERT_URL;

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };

const seenModels = [];
const ollama = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'small:1b', size: 1 }, { name: 'big:4b', size: 99 }] }));
  if (req.url === '/api/generate') {
    let body = ''; for await (const chunk of req) body += chunk;
    seenModels.push(JSON.parse(body).model);
    return res.end(JSON.stringify({ response: 'local answer', done: true }));
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise(r => ollama.listen(0, '127.0.0.1', r));

let liteRtHits = 0;
const litert = http.createServer((req, res) => { liteRtHits += 1; res.statusCode = 503; res.end('{}'); });
await new Promise(r => litert.listen(0, '127.0.0.1', r));

try {
  const pool = await import('../src/server/modelPool/poolManager.ts');
  const { generateOnDevice } = await import('../src/server/modelPool/providers/litertProvider.ts');
  pool.updateProviderEndpoint('ollama', `http://127.0.0.1:${ollama.address().port}`);

  const result = await pool.generate({ prompt: 'hello', taskCategory: 'test' });
  assert.equal(result.providerUsed, 'Termux Local Ollama');
  assert.equal(result.text, 'local answer');
  assert.deepEqual(seenModels, ['big:4b'], 'largest installed model is used, not a hardcoded name');

  // Privacy routing must not pick LiteRT when it is not configured.
  assert.equal(pool.routeRequest('test', true).provider.type, 'ollama');

  // JACO_MODEL_PROVIDER=ollama keeps routing local even when a cloud provider would otherwise be chosen.
  process.env.JACO_MODEL_PROVIDER = 'ollama';
  assert.equal(pool.routeRequest('strategic_regulation').provider.type, 'ollama');
  delete process.env.JACO_MODEL_PROVIDER;

  // Unconfigured LiteRT is never contacted.
  assert.equal(await generateOnDevice('x'), null);
  assert.equal(warnings.filter(w => w.includes('LiteRT')).length, 0);

  // A failing LiteRT server is contacted once, logged once, then skipped during the cooldown.
  process.env.JACO_LITERT_URL = `http://127.0.0.1:${litert.address().port}/v1`;
  for (let i = 0; i < 5; i += 1) assert.equal(await generateOnDevice('x'), null);
  assert.equal(liteRtHits, 1);
  assert.equal(warnings.filter(w => w.includes('LiteRT')).length, 1);

  console.warn = originalWarn;
  console.log('MODEL_POOL_PROVIDERS: PASS (installed-ollama-model/privacy-routing/litert-unconfigured-silent/litert-failure-cooldown)');
} finally {
  console.warn = originalWarn;
  ollama.close(); litert.close();
}
