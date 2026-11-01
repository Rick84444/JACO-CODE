import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import express from 'express';
import { mountNativeEngineSetup } from './pairing.js';

async function fixture(t: any, health: any = { product: 'JACO Native Engine', serviceHealthy: true, healthy: true, modelId: 'local-coder', backend: 'cpu' }) {
  const token = 'android-test-token-' + 'a'.repeat(32), gateway = 'gateway-test-token-' + 'b'.repeat(32);
  const stored: any[] = [], registered: any[] = [], calls: any[] = [];
  const engine = net.createServer(socket => {
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      const end = buffer.indexOf('\n'); if (end < 0) return;
      const request = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      calls.push({ method: request.method, model: request.params?.request?.model });
      if (request.token !== token) return socket.end(JSON.stringify({ id: request.id, error: { message: 'unauthorized' } }) + '\n');
      const result = request.method === 'health' ? health : { modelId: 'local-coder', text: 'A real protocol response', toolCalls: [] };
      socket.end(JSON.stringify({ id: request.id, result }) + '\n');
    });
  });
  await new Promise<void>(resolve => engine.listen(0, '127.0.0.1', resolve));
  const env: any = { JACO_NATIVE_ENGINE_PORT: String((engine.address() as net.AddressInfo).port), JACO_GATEWAY_TOKEN: gateway };
  const app = express(); app.use(express.json());
  const guard: express.RequestHandler = (req, res, next) => req.headers['x-forwarded-for']
    ? res.status(403).json({ success: false, error: 'LOCAL_ONLY' }) : next();
  mountNativeEngineSetup(app, guard, { env, store: { set: (...args: any[]) => stored.push(args) }, registry: { register: (p: any) => registered.push(p) } });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await new Promise<void>(resolve => engine.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const post = (route: string, body: any, headers: any = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { post, base, stored, registered, calls, env, token, gateway };
}

test('native pairing verifies authenticated TCP health, saves no plaintext receipt and rejects replay', async t => {
  const f = await fixture(t);
  const challenge = (await (await f.post('/api/startup/native/pair/challenge', {})).json()).challenge;
  const response = await f.post('/api/startup/native/pair/complete', { ...challenge, token: f.token });
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.state, 'PAIRED'); assert.equal(result.inference, 'UNTESTED');
  assert.equal(f.stored.length, 1); assert.equal(f.registered[0].id, 'android-native');
  assert.equal(f.registered[0].defaultModel, 'local-coder');
  assert.equal(JSON.stringify(result).includes(f.token), false);
  assert.equal((await f.post('/api/startup/native/pair/complete', { ...challenge, token: f.token })).status, 409);
  assert.equal(f.stored.length, 1);
});

test('wrong native product never persists pairing; relayed setup requests are rejected', async t => {
  const f = await fixture(t, { product: 'unrelated server', serviceHealthy: true });
  const challenge = (await (await f.post('/api/startup/native/pair/challenge', {})).json()).challenge;
  assert.equal((await f.post('/api/startup/native/pair/complete', { ...challenge, token: f.token })).status, 503);
  assert.equal(f.stored.length, 0); assert.equal(f.registered.length, 0);
  assert.equal((await f.post('/api/startup/native/pair/challenge', {}, { 'x-forwarded-for': '203.0.113.5' })).status, 403);
});

test('native model adapter requires authentication and forwards actual completion protocol results', async t => {
  const f = await fixture(t); f.env.JACO_NATIVE_ENGINE_TOKEN = f.token;
  assert.equal((await fetch(f.base + '/api/native/v1/models')).status, 401);
  const auth = { authorization: 'Bearer ' + f.gateway };
  const models = await (await fetch(f.base + '/api/native/v1/models', { headers: auth })).json();
  assert.equal(models.data[0].id, 'local-coder');
  const result = await (await f.post('/api/native/v1/chat/completions', { model: 'local-coder', messages: [{ role: 'user', content: 'test' }] }, auth)).json();
  assert.equal(result.choices[0].message.content, 'A real protocol response');
  assert.deepEqual(f.calls.at(-1), { method: 'completion.create', model: 'local-coder' });
  assert.equal(JSON.stringify(result).includes(f.token), false);
  assert.equal((await f.post('/api/native/v1/chat/completions', { model: 'local-coder', messages: [{}], stream: true }, auth)).status, 400);
});

test('an unloaded native service advertises no usable model', async t => {
  const f = await fixture(t, { product: 'JACO Native Engine', serviceHealthy: true, healthy: false }); f.env.JACO_NATIVE_ENGINE_TOKEN = f.token;
  const response = await fetch(f.base + '/api/native/v1/models', { headers: { authorization: 'Bearer ' + f.gateway } });
  assert.deepEqual((await response.json()).data, []);
});
