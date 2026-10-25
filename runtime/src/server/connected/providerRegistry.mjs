import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { credential } from '../../../../agents/lib/secret-store.mjs';
import { CATALOG, catalogProvider } from './providerCatalog.mjs';

const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const trimSlash = value => String(value || '').replace(/\/+$/, '');
const asV1 = value => /\/v1$/i.test(trimSlash(value)) ? trimSlash(value) : `${trimSlash(value)}/v1`;

export class ProviderRegistry {
  constructor(workspaceRoot, env = process.env) {
    this.workspaceRoot = workspaceRoot;
    this.env = env;
    this.stateDir = path.join(workspaceRoot, '.jaco', 'runtime');
    this.file = path.join(this.stateDir, 'providers.json');
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    this.providers = new Map();
    this.load();
    this.ensureDefaults();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try { for (const p of JSON.parse(fs.readFileSync(this.file, 'utf8'))) this.providers.set(p.id, p); } catch {}
  }
  save() { fs.writeFileSync(this.file, JSON.stringify([...this.providers.values()], null, 2), { mode: 0o600 }); }

  ensureDefaults({ refreshExisting = true } = {}) {
    const defs = [
      ...(this.env.JACO_LITERT_URL ? [{
        id: 'litert',
        kind: 'openai-compatible',
        baseUrl: asV1(this.env.JACO_LITERT_URL),
        apiKeyEnv: null,
        // The model is an operator-selected registry ID, never a built-in filename.
        defaultModel: String(this.env.JACO_LITERT_MODEL || '').trim(),
      }] : []),
      ...(this.env.JACO_LLAMACPP_URL ? [{
        id: 'llamacpp',
        kind: 'openai-compatible',
        baseUrl: asV1(this.env.JACO_LLAMACPP_URL || 'http://127.0.0.1:9380/v1'),
        apiKeyEnv: null,
        defaultModel: String(this.env.JACO_LLAMACPP_MODEL_ALIAS || this.env.JACO_LLAMACPP_MODEL_ID || this.env.JACO_LLAMACPP_MODEL || '').split(/[\\/]/).pop() || '',
      }] : []),
      { id: 'ollama', kind: 'openai-compatible', baseUrl: asV1(this.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1'), apiKeyEnv: 'OLLAMA_API_KEY', defaultModel: this.env.OLLAMA_MODEL || 'qwen2.5-coder:1.5b' },
      { id: 'lmstudio', kind: 'openai-compatible', baseUrl: this.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1', apiKeyEnv: 'LMSTUDIO_API_KEY', defaultModel: this.env.LMSTUDIO_MODEL || 'local-model' },
      ...(this.env.NOVA_LLM_ENDPOINT ? [{ id: 'nova', kind: 'openai-compatible', baseUrl: trimSlash(this.env.NOVA_LLM_ENDPOINT) + (this.env.NOVA_LLM_ENDPOINT.endsWith('/v1') ? '' : '/v1'), apiKeyEnv: 'NOVA_LLM_TOKEN', defaultModel: this.env.NOVA_LLM_MODEL || 'local-model' }] : []),
      ...(this.env.HUGGINGFACE_INFERENCE_BASE_URL ? [{ id: 'huggingface', kind: 'openai-compatible', baseUrl: trimSlash(this.env.HUGGINGFACE_INFERENCE_BASE_URL), apiKeyEnv: 'HUGGINGFACE_TOKEN', defaultModel: this.env.HUGGINGFACE_MODEL || '' }] : []),
      // Cloud services from the catalog (providerCatalog.mjs) whose key exists, in the environment or in JACO's
      // encrypted store: a key that is saved becomes a provider, nothing is listed per service here.
      ...CATALOG.filter(c => credential(c.apiKeyEnv, { env: this.env })).map(c => catalogProvider(c, this.env)),
    ];
    let changed = false;
    for (const p of defs) {
      const current = this.providers.get(p.id);
      if (!current) { this.providers.set(p.id, p); changed = true; continue; }
      const explicitEnv = {
        litert: this.env.JACO_LITERT_URL || this.env.JACO_LITERT_MODEL,
        llamacpp: this.env.JACO_LLAMACPP_URL || this.env.JACO_LLAMACPP_MODEL_ALIAS || this.env.JACO_LLAMACPP_MODEL_ID || this.env.JACO_LLAMACPP_MODEL,
        ollama: this.env.OLLAMA_BASE_URL || this.env.OLLAMA_MODEL,
        lmstudio: this.env.LMSTUDIO_BASE_URL || this.env.LMSTUDIO_MODEL,
        nova: this.env.NOVA_LLM_ENDPOINT || this.env.NOVA_LLM_MODEL,
        huggingface: this.env.HUGGINGFACE_INFERENCE_BASE_URL || this.env.HUGGINGFACE_MODEL,
      }[p.id];
      if (!refreshExisting || (current.createdAt && !explicitEnv)) continue;
      // Uncustomized built-in providers follow the environment on startup. Preserve custom
      // metadata, but do not keep a stale persisted model or endpoint.
      if (current.defaultModel !== p.defaultModel || current.baseUrl !== p.baseUrl || current.apiKeyEnv !== p.apiKeyEnv) {
        this.providers.set(p.id, { ...current, ...p }); changed = true;
      }
    }
    // Defaults are rebuilt from env on every start; a transient Windows lock (EBUSY) must not kill the server.
    if (changed) { try { this.save(); } catch (error) { console.warn(`[ProviderRegistry] defaults not persisted: ${error?.code || error}`); } }
  }

  list() {
    return [...this.providers.values()].map(p => ({ ...p, credentialConfigured: Boolean(this.key(p)) }));
  }

  register(input) {
    const id = String(input?.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('INVALID_PROVIDER_ID');
    const baseUrl = trimSlash(input?.baseUrl);
    const u = new URL(baseUrl);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('UNSUPPORTED_PROVIDER_PROTOCOL');
    const provider = {
      id,
      kind: 'openai-compatible',
      baseUrl,
      apiKeyEnv: String(input?.apiKeyEnv || '').trim() || null,
      defaultModel: String(input?.defaultModel || '').trim(),
      createdAt: new Date().toISOString()
    };
    this.providers.set(id, provider); this.save();
    return { ...provider, credentialConfigured: Boolean(this.key(provider)) };
  }

  // The provider's key: from the environment, else from JACO's encrypted store (agents/lib/secret-store.mjs).
  key(provider) { return provider?.apiKeyEnv ? credential(provider.apiKeyEnv, { env: this.env }) : ''; }

  headers(provider) {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    const key = this.key(provider);
    if (key) headers.authorization = `Bearer ${key}`;
    return headers;
  }

  async probe(providerId) {
    const p = this.providers.get(String(providerId)); if (!p) throw new Error('PROVIDER_NOT_FOUND');
    const started = Date.now();
    try {
      const res = await fetch(`${trimSlash(p.baseUrl)}/models`, { headers: this.headers(p), signal: AbortSignal.timeout(5000) });
      const body = await res.text();
      const observation = { providerId: p.id, status: res.status, latencyMs: Date.now() - started, responseHash: sha(body) };
      if (!res.ok) return { ...observation, ok: false, models: [] };
      // A successful HTTP response alone is not a usable model catalog. Keep arbitrary
      // objects and numbers out of the model picker, and never invent IDs by coercion.
      let data;
      try { data = JSON.parse(body)?.data; } catch {}
      if (!Array.isArray(data) || data.some(x => typeof x?.id !== 'string' || !x.id.trim())) {
        return { ...observation, ok: false, models: [], error: 'PROVIDER_MODELS_INVALID' };
      }
      return { ...observation, ok: true, models: [...new Set(data.map(x => x.id))].slice(0, 100) };
    } catch (error) {
      return { providerId: p.id, ok: false, status: null, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // Which providers answer right now (operator 2026-10-09: JACO should sense which are active). A cloud provider
  // that needs a key and has none is "no key", not probed; the rest are asked in parallel for their models.
  async scan() {
    // Keys may have been stored by another agent process since startup.
    this.ensureDefaults();
    return Promise.all(this.list().map(async p => {
      const local = /^(localhost|127\.|\[?::1)/.test(new URL(p.baseUrl).hostname);
      if (p.apiKeyEnv && !p.credentialConfigured && !local) return { id: p.id, active: false, state: 'NO_KEY', baseUrl: p.baseUrl, defaultModel: p.defaultModel, models: 0 };
      const r = await this.probe(p.id);
      const state = r.ok ? 'ACTIVE' : r.status === 401 || r.status === 403 ? 'KEY_REJECTED' : 'UNREACHABLE';
      return { id: p.id, active: r.ok, state, baseUrl: p.baseUrl, defaultModel: p.defaultModel, models: r.models?.length || 0, modelIds: r.models || [], observedAt: new Date().toISOString(), ms: r.latencyMs };
    }));
  }

  /**
   * @param {{
   *   providerId?: string,
   *   model?: string,
   *   messages?: Array<{ role: string, content: string }>,
   *   temperature?: number,
   *   responseFormat?: any
   * }} [input]
   */
  async chat({ providerId, model, messages, temperature = 0.2, responseFormat = null, maxTokens = null } = {}) {
    const p = this.providers.get(String(providerId)); if (!p) throw new Error('PROVIDER_NOT_FOUND');
    const selectedModel = String(model || p.defaultModel || '').trim();
    if (!selectedModel) throw new Error('PROVIDER_MODEL_REQUIRED');
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('MESSAGES_REQUIRED');
    // Anthropic's OpenAI-compatibility layer rejects temperature values below 1 on current Claude
    // families. Omitting temperature lets the provider use its valid default while keeping the generic
    // OpenAI-compatible path for every other provider.
    const includeTemperature = p.id !== 'anthropic' && temperature != null;
    const body = { model: selectedModel, messages, ...(includeTemperature ? { temperature } : {}), ...(responseFormat ? { response_format: responseFormat } : {}), ...(maxTokens == null ? {} : { max_tokens: maxTokens }) };
    const started = Date.now();
    const res = await fetch(`${trimSlash(p.baseUrl)}/chat/completions`, { method: 'POST', headers: this.headers(p), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`PROVIDER_HTTP_${res.status}: ${text.slice(0, 400)}`);
    const parsed = JSON.parse(text);
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('PROVIDER_EMPTY_COMPLETION');
    return { providerId: p.id, model: parsed?.model || selectedModel, content, latencyMs: Date.now() - started, requestHash: sha(body), responseHash: sha(text), usage: parsed?.usage || null };
  }
}
