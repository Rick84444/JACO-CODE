import crypto from 'node:crypto';
import type express from 'express';
import { SecretStore } from '../../../../agents/lib/secret-store.mjs';
import { requestNativeEngine } from './nativeEngineClient.js';

type NativeHealth = { product?: string; serviceHealthy?: boolean; healthy?: boolean; modelId?: string; backend?: string };

// The Android app can send a token only to the fixed local engine. A short-lived,
// one-use challenge prevents an old app request from silently changing pairing.
export function mountNativeEngineSetup(app: express.Express, localGuard: express.RequestHandler, {
  env = process.env, registry = null, runtimeUrl = 'http://127.0.0.1:3000',
  now = Date.now, call = requestNativeEngine, store = new SecretStore(),
}: any = {}) {
  if (env.JACO_NATIVE_ENGINE_TOKEN && registry) {
    const previous = registry.providers?.get('android-native');
    registry.register({ ...previous, id: 'android-native', baseUrl: runtimeUrl + '/api/native/v1', apiKeyEnv: 'JACO_GATEWAY_TOKEN', defaultModel: previous?.defaultModel || '' });
  }
  const challenges = new Map<string, { nonce: string; expiresAt: number }>();
  const prune = () => { for (const [id, challenge] of challenges) if (challenge.expiresAt <= now()) challenges.delete(id); };
  app.post('/api/startup/native/pair/challenge', localGuard, (_req, res) => {
    prune();
    if (challenges.size >= 8) return res.status(429).json({ success: false, error: 'PAIRING_BUSY' });
    const id = crypto.randomUUID(), nonce = crypto.randomBytes(24).toString('base64url'), expiresAt = now() + 60_000;
    challenges.set(id, { nonce, expiresAt });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, challenge: { id, nonce, expiresAt: new Date(expiresAt).toISOString() } });
  });
  app.post('/api/startup/native/pair/complete', localGuard, async (req, res) => {
    prune();
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    const challenge = challenges.get(id);
    if (!challenge || req.body?.nonce !== challenge.nonce) return res.status(409).json({ success: false, error: 'PAIRING_CHALLENGE_INVALID' });
    challenges.delete(id); // Consumed even when the native handshake fails.
    const token = req.body?.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}={0,2}$/.test(token)) return res.status(400).json({ success: false, error: 'PAIRING_TOKEN_INVALID' });
    try {
      const health: NativeHealth = await call('health', {}, 3000, { token, port: Number(env.JACO_NATIVE_ENGINE_PORT || 37621) });
      if (health?.product !== 'JACO Native Engine' || health.serviceHealthy !== true) throw Error('NATIVE_HEALTH_INVALID');
      store.set('JACO_NATIVE_ENGINE_TOKEN', token, { source: 'android-local-pairing', purpose: 'Authenticated local model and Android tools' });
      env.JACO_NATIVE_ENGINE_TOKEN = token;
      registry?.register({ id: 'android-native', baseUrl: runtimeUrl + '/api/native/v1', apiKeyEnv: 'JACO_GATEWAY_TOKEN',
        defaultModel: health.healthy === true && typeof health.modelId === 'string' ? health.modelId : '' });
      return res.json({ success: true, state: 'PAIRED', evidence: 'AUTHENTICATED_NATIVE_HEALTH', modelLoaded: health.healthy === true, inference: 'UNTESTED' });
    } catch { return res.status(503).json({ success: false, error: 'NATIVE_PAIRING_NOT_VERIFIED' }); }
  });

  const nativeAuth: express.RequestHandler = (req, res, next) => {
    const expected = String(env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '');
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const expectedBytes = Buffer.from(expected), suppliedBytes = Buffer.from(supplied);
    if (expected.length < 24 || suppliedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(suppliedBytes, expectedBytes))
      return res.status(401).json({ error: { message: 'Local model authentication required', type: 'authentication_error' } });
    return localGuard(req, res, next);
  };
  const connection = () => ({ token: env.JACO_NATIVE_ENGINE_TOKEN, port: Number(env.JACO_NATIVE_ENGINE_PORT || 37621) });
  app.get('/api/native/v1/models', nativeAuth, async (_req, res) => {
    try {
      const health: NativeHealth = await call('health', {}, 3000, connection());
      if (health?.product !== 'JACO Native Engine' || health.serviceHealthy !== true) throw Error();
      const data = health.healthy === true && typeof health.modelId === 'string' && health.modelId
        ? [{ id: health.modelId, object: 'model', owned_by: 'local-android', backend: health.backend || 'unknown' }] : [];
      return res.json({ object: 'list', data });
    } catch { return res.status(503).json({ error: { message: 'The local Android model service is unavailable' } }); }
  });
  app.post('/api/native/v1/chat/completions', nativeAuth, async (req, res) => {
    if (!Array.isArray(req.body?.messages) || !req.body.messages.length || typeof req.body?.model !== 'string')
      return res.status(400).json({ error: { message: 'A loaded model and messages are required' } });
    if (req.body.stream === true) return res.status(400).json({ error: { message: 'The Android model adapter does not support streaming' } });
    try {
      const result: any = await call('completion.create', { request: req.body }, 180_000, connection());
      if (result?.modelId !== req.body.model || typeof result?.text !== 'string') throw Error();
      const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls.map((tool: any) => ({
        id: 'call_' + crypto.randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments || {}) },
      })) : [];
      return res.json({ id: 'chatcmpl-' + crypto.randomUUID(), object: 'chat.completion', created: Math.floor(now() / 1000), model: result.modelId,
        choices: [{ index: 0, finish_reason: toolCalls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: result.text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } }] });
    } catch { return res.status(503).json({ error: { message: 'The local model did not return a verifiable completion. Check its status before retrying.' } }); }
  });
}
