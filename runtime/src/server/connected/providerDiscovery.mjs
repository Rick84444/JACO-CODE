// Connect a model provider from nothing but a URL (operator 2026-10-08: a form with id, base URL, key
// variable and model is outdated; JACO should work it out itself). Known services are recognised by
// host, anything else is probed for an OpenAI-compatible or Ollama API. Every request is recorded as
// evidence, the key is only ever read from the environment, and no key value leaves this module.

import { CATALOG as KNOWN, keyCandidates, catalogById } from './providerCatalog.mjs';

const NON_CHAT = /embed|whisper|tts|dall-e|image|moderation|rerank|audio|transcribe|vision-preview|guard/i;
const trimSlash = value => String(value || '').replace(/\/+$/, '');

export function normalizeProviderUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) throw new Error('PROVIDER_URL_REQUIRED');
  if (/\\s/.test(text)) throw new Error('INVALID_PROVIDER_URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `${/^(localhost|127\.|10\.|192\.168\.|\[?::1)/.test(text) ? 'http' : 'https'}://${text}`;
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('UNSUPPORTED_PROVIDER_PROTOCOL');
  if (url.username || url.password) throw new Error('PROVIDER_URL_MUST_NOT_CONTAIN_CREDENTIALS');
  url.hash = '';
  return url;
}

export function knownProvider(url) {
  const host = url.hostname.toLowerCase();
  const hit = KNOWN.find(k => k.match.test(host));
  return hit ? { id: hit.id, baseUrl: hit.baseUrl, apiKeyEnv: hit.apiKeyEnv, defaultModel: hit.defaultModel || '' } : null;
}

// An id for an unknown provider, from its host: "my-llm.example.com:8080" -> "my-llm".
export function providerIdFromUrl(url) {
  const host = url.hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) return `local-${url.port || 'default'}`;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `host-${host.replace(/\./g, '-')}`;
  const label = host.replace(/^(api|www)\./, '').split('.')[0];
  return label.replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'provider';
}

// The default chat model: what the operator wrote in the URL path or `model=` wins; otherwise the
// first model that is not an embedding/audio/image model.
export function pickDefaultModel(models, preferred = '') {
  if (preferred && models.includes(preferred)) return preferred;
  return models.find(m => !NON_CHAT.test(m)) || models[0] || '';
}

const candidatesFor = url => {
  const base = trimSlash(`${url.origin}${url.pathname}`);
  const list = [base, `${url.origin}/v1`, `${url.origin}/api/v1`, `${url.origin}/openai/v1`];
  return [...new Set(list.map(trimSlash))];
};

async function get(fetchImpl, href, headers, timeoutMs) {
  const started = Date.now();
  try {
    const res = await fetchImpl(href, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { href, status: res.status, ms: Date.now() - started, json };
  } catch (error) {
    return { href, status: null, ms: Date.now() - started, error: error?.name === 'TimeoutError' ? 'TIMEOUT' : String(error?.message || error) };
  }
}

const modelIds = json => {
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : null;
  return list ? list.map(m => (typeof m === 'string' ? m : m?.id || m?.name || m?.model)).filter(Boolean).map(String).slice(0, 200) : null;
};

/**
 * Find out what is behind a URL and how to talk to it.
 * Result `state`: READY (models listed), NEEDS_KEY (API answers 401/403 and no key in the
 * environment), KEY_REJECTED (a key was sent and refused), or UNREACHABLE.
 */
export async function discoverProvider(rawUrl, { env = process.env, fetchImpl = fetch, timeoutMs = 6000, keyFor = name => env[name] || '' } = {}) {
  const url = normalizeProviderUrl(rawUrl);
  const preferredModel = url.searchParams.get('model') || '';
  const known = knownProvider(url);
  const candidateId = providerIdFromUrl(url);
  // An operator-defined endpoint must never replace a catalog provider with the same ID.
  const id = known?.id || (catalogById(candidateId) ? `custom-${candidateId}` : candidateId);
  const apiKeyEnv = known?.apiKeyEnv || `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  const key = keyFor(apiKeyEnv) || '';
  const headers = { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
  const evidence = [];
  const result = (state, extra) => ({ id, known: Boolean(known), apiKeyEnv, credentialConfigured: Boolean(key), state, evidence, ...extra });

  const bases = known ? [known.baseUrl] : candidatesFor(url);
  // Never send a pasted secret over cleartext off the current device.
  if (key && bases.some(base => {
    const endpoint = new URL(base);
    return endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(endpoint.hostname);
  })) throw new Error('PROVIDER_KEY_REQUIRES_HTTPS');
  let authWall = null;
  for (const base of bases) {
    const r = await get(fetchImpl, `${base}/models`, headers, timeoutMs);
    evidence.push({ url: r.href, status: r.status, ms: r.ms, ...(r.error ? { error: r.error } : {}) });
    const models = r.status === 200 ? modelIds(r.json) : null;
    if (models?.length) return result('READY', { baseUrl: base, models, defaultModel: pickDefaultModel(models, preferredModel) });
    if ((r.status === 401 || r.status === 403) && !authWall) authWall = base;
  }
  // Ollama's native listing, when the OpenAI-compatible path is closed or the URL was the bare host.
  if (!known) {
    const r = await get(fetchImpl, `${url.origin}/api/tags`, headers, timeoutMs);
    evidence.push({ url: r.href, status: r.status, ms: r.ms, ...(r.error ? { error: r.error } : {}) });
    const models = r.status === 200 ? modelIds(r.json) : null;
    if (models?.length) return result('READY', { baseUrl: `${url.origin}/v1`, models, defaultModel: pickDefaultModel(models, preferredModel), kind: 'ollama' });
  }
  // Without a model list (no key yet, or rejected) a known service still gets its usual model, so the
  // provider works the moment a valid key is saved.
  if (authWall) return result(key ? 'KEY_REJECTED' : 'NEEDS_KEY', { baseUrl: authWall, models: [], defaultModel: preferredModel || known?.defaultModel || '' });
  return result('UNREACHABLE', { baseUrl: bases[0], models: [], defaultModel: preferredModel });
}

/**
 * Work out which service a pasted API key belongs to and check that it works (operator 2026-10-09:
 * "write the API key and it should sense which providers are active"). The key shape narrows the
 * service; a shape several services share (or an unknown one) is answered with the candidates and the
 * caller asks which one, so the key is only ever sent to the one service it is checked against.
 * state: READY | KEY_REJECTED | UNREACHABLE | AMBIGUOUS | UNKNOWN_KEY. The key is never returned.
 */
export async function identifyKey(key, { provider = '', fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const value = String(key || '').trim();
  if (!value) throw new Error('API_KEY_REQUIRED');
  const chosen = provider ? catalogById(String(provider).toLowerCase()) : null;
  if (provider && !chosen) return { state: 'UNKNOWN_KEY', candidates: [], evidence: [] };
  const candidates = chosen ? [chosen] : keyCandidates(value);
  if (!candidates.length) return { state: 'UNKNOWN_KEY', candidates: [], evidence: [] };
  if (candidates.length > 1) return { state: 'AMBIGUOUS', candidates: candidates.map(c => c.id), evidence: [] };
  const [entry] = candidates;
  const r = await get(fetchImpl, `${entry.baseUrl}/models`, { accept: 'application/json', authorization: `Bearer ${value}` }, timeoutMs);
  const evidence = [{ url: r.href, status: r.status, ms: r.ms, ...(r.error ? { error: r.error } : {}) }];
  const base = { id: entry.id, apiKeyEnv: entry.apiKeyEnv, baseUrl: entry.baseUrl, evidence };
  const models = r.status === 200 ? modelIds(r.json) : null;
  if (models) return { ...base, state: 'READY', models, defaultModel: pickDefaultModel(models, entry.defaultModel || '') };
  if (r.status === 401 || r.status === 403) return { ...base, state: 'KEY_REJECTED', models: [], defaultModel: entry.defaultModel || '' };
  return { ...base, state: 'UNREACHABLE', models: [], defaultModel: entry.defaultModel || '' };
}
