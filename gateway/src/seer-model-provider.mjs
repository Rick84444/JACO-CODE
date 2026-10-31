// Canonical local model discovery for SEER.
//
// The control plane is platform-neutral:
//   - LiteRT-LM (typically Android/Termux) is preferred when a healthy local
//     OpenAI-compatible server is available.
//   - Ollama is the deterministic desktop/local fallback.
//   - Paid providers are not enabled here; seer.mjs still requires the
//     existing explicit JACO_ALLOW_PAID_MODELS=1 gate.
//   - Aura owns the model choice: resolveAuraPlanner/invokeAuraPlanner below let SEER plan with
//     the model the operator picked in Aura, a paid one under the runtime's Continuum ceiling.
//
// Environment:
//   JACO_SEER_PROVIDER_PREFERENCE=auto|llamacpp|litert|ollama|off
//   JACO_LLAMACPP_URL=http://127.0.0.1:9380/v1
//   JACO_LLAMACPP_MODEL=<registered model id>
//   JACO_LITERT_URL=http://127.0.0.1:9379/v1
//   JACO_LITERT_MODEL=<registered model id>
//   OLLAMA_BASE_URL=http://127.0.0.1:11434
//   OLLAMA_MODEL=<installed model> (JACO_OLLAMA_MODEL is accepted as alias)

import { plannerChoiceFile, plannerChoices, readPlannerChoice } from '../../agents/lib/planner-choice.mjs';
import { budgetedNovaOllamaCall } from '../../agents/lib/nova-ollama-cost.mjs';
import { credential } from '../../agents/lib/secret-store.mjs';

const trimSlash = value => String(value || '').replace(/\/+$/, '');


const clipHeadTail = (value, maxChars, tailFraction = 0.3) => {
  const text = String(value || '');
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (!limit || text.length <= limit) return text;
  if (limit < 32) return text.slice(0, limit);
  const tail = Math.max(8, Math.floor(limit * tailFraction));
  const head = Math.max(8, limit - tail - 18);
  return `${text.slice(0, head)}\n…[budgeted]…\n${text.slice(-tail)}`;
};

const clipTail = (value, maxChars) => {
  const text = String(value || '');
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (!limit || text.length <= limit) return text;
  if (limit < 24) return text.slice(-limit);
  return `…[earlier context budgeted]…\n${text.slice(-(limit - 30))}`;
};

/**
 * Fit a normal SEER request inside a local llama.cpp context window.
 * The current user message is at the tail of the user prompt, so tail clipping
 * preserves the operator's latest instruction. System clipping preserves both
 * the canonical rules at the head and tool contracts at the tail.
 */
export function budgetSeerLocalPrompt({
  system = '', user = '', memory = '', maxTokens = 1024, contextTokens = 8192,
} = {}) {
  const ctx = Math.max(1024, Math.floor(Number(contextTokens) || 8192));
  const requestedOutput = Math.max(1, Math.floor(Number(maxTokens) || 1024));
  // A local interactive chat must leave most of the context for instructions,
  // current state and the operator message. At 2048 ctx this caps output to 409.
  const outputTokens = Math.min(2048, requestedOutput, Math.max(128, Math.floor(ctx * 0.20)));
  const safetyTokens = Math.max(128, Math.floor(ctx * 0.05));
  const inputTokens = Math.max(256, ctx - outputTokens - safetyTokens);
  // 3 chars/token is deliberately conservative for mixed code/JSON/prose.
  const inputChars = Math.max(1024, Math.floor(inputTokens * 3));

  const configuredMemory = String(memory || '');
  const memoryChars = Math.min(configuredMemory.length, Math.floor(inputChars * 0.22));
  const memoryBlock = memoryChars
    ? `\n\n[JACO ACTIVE MEMORY]\n${configuredMemory.slice(0, memoryChars)}\n[/JACO ACTIVE MEMORY]`
    : '';
  const combinedSystem = String(system || '') + memoryBlock;

  let systemBudget = Math.floor(inputChars * 0.58);
  let userBudget = inputChars - systemBudget;
  if (combinedSystem.length < systemBudget) {
    userBudget += systemBudget - combinedSystem.length;
    systemBudget = combinedSystem.length;
  } else if (String(user || '').length < userBudget) {
    systemBudget += userBudget - String(user || '').length;
    userBudget = String(user || '').length;
  }

  return {
    system: clipHeadTail(combinedSystem, systemBudget, 0.34),
    user: clipTail(user, userBudget),
    maxTokens: outputTokens,
    contextTokens: ctx,
    inputCharBudget: inputChars,
    memoryChars,
  };
}

export function clipGoalStatement(text, maxChars) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= maxChars ? value : value.slice(0, Math.max(0, maxChars - 1)) + '…';
}

// Relevance-ordered goal context for the governor: the goals this turn works on keep most of
// their text, every other goal shrinks to a headline. Two pasted behaviour contracts as active
// goals once made a ~45k-token governor prompt that a 4B local model could not finish.
export function compactGovernorGoals(goals = [], { focusIds = [], focusChars = 1500, otherChars = 200, maxGoals = 6 } = {}) {
  const focus = new Set(focusIds.filter(Boolean));
  return [...goals]
    .sort((a, b) => Number(focus.has(b.id)) - Number(focus.has(a.id)))
    .slice(0, maxGoals)
    .map(goal => ({ ...goal, statement: clipGoalStatement(goal.statement, focus.has(goal.id) ? focusChars : otherChars) }));
}

export function extractGovernorJson(text) {
  const source = String(text ?? '');
  const start = source.indexOf('{');
  if (start < 0) throw new Error('NO_JSON_OBJECT_FOUND');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
      if (depth < 0) break;
    }
  }
  throw new Error('UNBALANCED_JSON_OBJECT');
}

export function providerOutputTruncated(result) {
  const reason = String(result?.finishReason || '').toLowerCase();
  return ['length', 'max_tokens', 'max_output_tokens'].includes(reason);
}

// One request implementation for general inference and explicitly enabled planning.
// Authorization policy must never be implemented by deleting credential metadata.
// On-device governor plans can require longer than the default interactive
// 180-second timeout (measured ~6.7 tokens/s on Windows). The extra budget is
// confined to strategic planning; no new cloud permission or spending is granted.
export function seerProviderTimeoutMs({ env = process.env, remote = false, purpose = 'inference' } = {}) {
  const configured = Number(env.JACO_SEER_INFERENCE_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0)
    return Math.min(2147483647, Math.floor(configured));
  return remote ? 60000 : purpose === 'planner' ? 600000 : 180000;
}

export async function invokeSeerProvider(provider, args, {
  env = process.env, fetchFn = globalThis.fetch, purpose = 'inference', onFailure = () => {}, paidAuthorized = false,
} = {}) {
  if (!provider) return null;
  const remote = provider.local === false || Boolean(provider.envKey);
  const fail = (code, status) => {
    onFailure({ provider: provider.name, model: provider.model, code, ...(status ? { status } : {}) });
    return null;
  };
  // paidAuthorized: the call is already bounded by a Continuum reservation (invokeAuraPlanner).
  if (remote && (env.JACO_ALLOW_PAID_MODELS === '0' || (!paidAuthorized && env.JACO_ALLOW_PAID_MODELS !== '1'))) return fail('PAID_PROVIDER_DISABLED');
  const key = provider.envKey ? env[provider.envKey] : null;
  if (provider.envKey && !key) return fail('PROVIDER_KEY_MISSING');
  const timeout = seerProviderTimeoutMs({ env, remote, purpose });
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const response = await fetchFn(provider.url, {
      method: 'POST', headers,
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.image && (!remote || env.NOVA_ALLOW_CLOUD_IMAGES === '1')
            ? [{ type: 'text', text: args.user }, { type: 'image_url', image_url: { url: args.image } }] : args.user },
        ],
        max_tokens: args.max_tokens, temperature: args.temperature,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return fail('PROVIDER_HTTP_ERROR', response.status);
    const data = await response.json();
    const choice = data?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return fail('PROVIDER_EMPTY_CONTENT');
    return {
      ok: true,
      text: text.trim(),
      finishReason: choice?.finish_reason == null ? null : String(choice.finish_reason),
      provider: provider.name,
      model: provider.model,
      local: !remote,
    };
  } catch (error) {
    // Never emit raw exception text, response bodies, prompts, or credentials.
    return fail(['TimeoutError', 'AbortError'].includes(error?.name) ? 'PROVIDER_TIMEOUT' : 'PROVIDER_REQUEST_FAILED');
  }
}

export async function callSeerGovernorProvider(args, {
  providers, fallback, env = process.env, fetchFn = globalThis.fetch, onFailure, onUsed = () => {},
}) {
  // A cloud planner writes the full candidate plans (2026-10-09: DeepSeek stopped at 2048 tokens,
  // finish_reason=length, and every governor turn failed as GOVERNOR_OUTPUT_TRUNCATED).
  const cap = Math.max(1024, Number(env.SEER_GOVERNOR_MAX_TOKENS) || 8192);
  const normalized = { ...args, max_tokens: Math.min(cap, Math.max(1, Number(args.max_tokens) || cap)), temperature: args.temperature ?? 0.2 };
  if (env.JACO_CLOUD_PLANNER === '1' && env.JACO_ALLOW_PAID_MODELS === '1') {
    const provider = providers.find(p => p.name === env.JACO_PRIMARY_PROVIDER);
    if (provider && (!provider.envKey || env[provider.envKey])) {
      const result = await invokeAuraPlanner(provider, normalized, {
        env, fetchFn, purpose: 'planner', onFailure,
        runtimeUrl: env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000',
        token: env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || env.SEER_TOKEN || '',
      });
      if (result) { onUsed({ provider: provider.name, model: provider.model }); return result; }
    }
  }
  // Preserve the strategic purpose for the local fallback so only governor
  // planning gets the longer bounded local timeout, not ordinary Aura chat.
  return fallback({ ...normalized, purpose: 'planner' });
}
// Aura owns the model choice (agents/lib/planner-choice.mjs, written from Aura's GUI), so SEER plans with the
// model the operator picked there instead of a second registry of its own. Before this SEER only had a local
// 4B model that timed out on every governor turn while Aura's chosen model was idle (2026-10-31).
// JACO_PRIMARY_PROVIDER stays authoritative, as it is for Nova; it is handled by callSeerGovernorProvider.
// Distinguish local inference from metered remote inference based on the actual
// transport, never solely on a provider's self-declared `local` attribute.
// Ollama models inferred in the cloud and relayed through the local daemon.
const OLLAMA_CLOUD_RELAY = /(?:-cloud|:cloud)$/i;

export function seerModelEndpointAllowed(url, local) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (local) return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    return parsed.protocol === 'https:';
  } catch { return false; }
}

let connectedCache = { at: 0, runtimeUrl: '', providers: [] };
export async function resolveAuraPlanner({
  env = process.env, fetchFn = globalThis.fetch, runtimeUrl, token = '', cacheMs = 60000, now = Date.now,
  readChoice = () => readPlannerChoice(plannerChoiceFile(env)),
} = {}) {
  const saved = readChoice();
  if (!saved || saved.by !== 'operator' || env.JACO_PRIMARY_PROVIDER) return null;
  // The providers connected in Aura, with their real URLs (the same list Nova plans from), read at most once a minute.
  if (now() - connectedCache.at >= cacheMs || connectedCache.runtimeUrl !== runtimeUrl) {
    try {
      const response = await fetchFn(`${trimSlash(runtimeUrl)}/api/connected/nova/planner-providers`, {
        headers: { 'x-gateway-token': token }, signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      connectedCache = { at: now(), runtimeUrl, providers: Array.isArray(body?.providers) ? body.providers : [] };
    } catch { /* the fixed choices below still resolve a listed provider */ }
  }
  const connected = connectedCache.providers.find(p => p?.name === saved.provider) || null;
  const fixed = plannerChoices(env)[saved.provider];
  const url = connected?.url || fixed?.url;
  const model = saved.model || connected?.model;
  if (!url || !model) return null;
  const local = connected ? Boolean(connected.local) : fixed?.paid === false && !fixed?.keyEnv;
  if (!seerModelEndpointAllowed(url, local)) return null;
  return { name: saved.provider, url, model, local, envKey: local ? null : (connected?.envKey || fixed?.keyEnv || null), source: 'aura-choice' };
}

// A paid Aura choice is reserved in the runtime's Continuum economic governor before the call and settled
// with the real usage after it: the same hard daily ceiling Nova's paid calls use. A refused reservation
// (ceiling reached) or any failure returns null, and SEER continues with its local chain.
export async function invokeAuraPlanner(provider, args, {
  env = process.env, fetchFn = globalThis.fetch, runtimeUrl, token = '', onFailure = () => {},
  credentialFn = credential, budgetedCall = budgetedNovaOllamaCall, purpose = 'inference',
} = {}) {
  if (!provider) return null;
  const fail = code => { onFailure({ provider: provider.name, model: provider.model, code, source: 'aura-choice' }); return null; };
  // An Ollama "-cloud"/":cloud" model is served through the local daemon at localhost but inferred (and billed)
  // in the cloud. It has no reservable price here, so it is refused rather than treated as local and free
  // (same suffix rule as agents/hands-off-agent.mjs and auraOllamaChat.mjs).
  if (OLLAMA_CLOUD_RELAY.test(String(provider.model || ''))) return fail('OLLAMA_CLOUD_RELAY_NOT_RESERVABLE');
  if (!seerModelEndpointAllowed(provider.url, Boolean(provider.local))) return fail('PROVIDER_ENDPOINT_UNTRUSTED');
  if (provider.local) return invokeSeerProvider({ ...provider, envKey: null, local: true }, args, { env, fetchFn, purpose, onFailure });
  // SEER never promotes a GUI choice into implicit spend authorization.
  // The operator must explicitly enable paid inference; Continuum still
  // enforces the pre-existing per-call, daily and monthly reservation caps.
  if (env.JACO_ALLOW_PAID_MODELS !== '1') return fail('PAID_PROVIDER_DISABLED');
  // Authentication is separate from locality: a connected HTTPS server registered without a credential
  // requirement is called without a key, under the same paid gate and Continuum reservation.
  const key = provider.envKey ? credentialFn(provider.envKey, { env }) : '';
  if (provider.envKey && !key) return fail('PROVIDER_KEY_MISSING');
  let refused = null;
  const reservedFetch = async (url, init) => {
    try {
      const result = await budgetedCall({ provider: { name: provider.name, model: provider.model, url, key },
        requestBody: JSON.parse(init.body), runtimeUrl, token, fetchImpl: fetchFn, signal: init.signal });
      return new Response(result.rawBody, { status: result.response.status, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      // Only the runtime's own error codes are reported; never raw provider text.
      const code = String(error?.message || '');
      refused = /^[A-Z][A-Z0-9_:]{2,80}$/.test(code) ? code : null;
      throw error;
    }
  };
  const result = await invokeSeerProvider({ ...provider, envKey: key ? provider.envKey : null, local: false }, args, {
    env: key ? { ...env, [provider.envKey]: key } : env, fetchFn: reservedFetch, purpose, onFailure, paidAuthorized: true,
  });
  if (!result && refused) fail(refused);
  return result;
}

const timeoutMs = env => Math.max(250, Number(env.JACO_SEER_MODEL_DISCOVERY_TIMEOUT_MS || 2500));

function asV1(value, fallback) {
  const base = trimSlash(value || fallback);
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function ollamaRoot(value) {
  return trimSlash(value || 'http://127.0.0.1:11434').replace(/\/v1$/i, '');
}

function responseJson(response) {
  if (!response?.ok) throw new Error(`HTTP_${response?.status || 'ERROR'}`);
  return response.json();
}

function discoveryFailure(id, error) {
  const causes = Array.isArray(error?.cause?.errors) ? error.cause.errors : [error?.cause];
  const codes = [...new Set(causes.map(cause => cause?.code).filter(code => typeof code === 'string'))];
  return `${id}-unavailable:${error?.message || 'unknown error'}${codes.length ? ` (${codes.join(',')})` : ''}`;
}

async function discoverLiteRt({ env, fetchFn }) {
  if (env.JACO_LITERT_AUTODETECT === '0') return { provider: null, reason: 'litert-autodetect-disabled' };
  const baseUrl = asV1(env.JACO_LITERT_URL, 'http://127.0.0.1:9379/v1');
  try {
    const response = await fetchFn(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(timeoutMs(env)),
    });
    const payload = await responseJson(response);
    const models = (Array.isArray(payload?.data) ? payload.data : [])
      .map(model => String(model?.id || '').trim())
      .filter(Boolean);
    if (!models.length) return { provider: null, reason: 'litert-no-models' };

    const requested = String(env.JACO_LITERT_MODEL || '').trim();
    if (requested && !models.includes(requested)) {
      return { provider: null, reason: `litert-model-not-registered:${requested}`, candidates: models };
    }
    const model = requested || models.find(name => /gemma/i.test(name)) || models[0];
    return {
      provider: {
        id: 'litert',
        family: 'openai-compatible',
        local: true,
        baseUrl,
        chatUrl: `${baseUrl}/chat/completions`,
        model,
        source: requested ? 'litert-env+registry' : 'litert-autodiscovery',
      },
      reason: null,
      candidates: models,
    };
  } catch (error) {
    return { provider: null, reason: discoveryFailure('litert', error) };
  }
}

async function discoverLlamaCpp({ env, fetchFn }) {
  if (env.JACO_LLAMACPP_AUTODETECT === '0') return { provider: null, reason: 'llamacpp-autodetect-disabled' };
  const baseUrl = asV1(env.JACO_LLAMACPP_URL, 'http://127.0.0.1:9380/v1');
  try {
    const response = await fetchFn(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(timeoutMs(env)),
    });
    const payload = await responseJson(response);
    const models = (Array.isArray(payload?.data) ? payload.data : [])
      .map(model => String(model?.id || '').trim())
      .filter(Boolean);
    if (!models.length) return { provider: null, reason: 'llamacpp-no-models' };

    const requested = String(env.JACO_LLAMACPP_MODEL || '').trim();
    if (requested && !models.includes(requested)) {
      return { provider: null, reason: `llamacpp-model-not-registered:${requested}`, candidates: models };
    }
    const model = requested || models[0];
    return {
      provider: {
        id: 'llamacpp',
        family: 'openai-compatible',
        local: true,
        baseUrl,
        chatUrl: `${baseUrl}/chat/completions`,
        model,
        source: requested ? 'llamacpp-env+registry' : 'llamacpp-autodiscovery',
      },
      reason: null,
      candidates: models,
    };
  } catch (error) {
    return { provider: null, reason: discoveryFailure('llamacpp', error) };
  }
}

async function discoverOllama({ env, fetchFn }) {
  if (env.JACO_OLLAMA_AUTODETECT === '0') return { provider: null, reason: 'ollama-autodetect-disabled' };
  const root = ollamaRoot(env.OLLAMA_BASE_URL || env.JACO_OLLAMA_URL);
  try {
    const response = await fetchFn(`${root}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs(env)),
    });
    const payload = await responseJson(response);
    const maxBytes = Number(env.JACO_OLLAMA_MAX_BYTES || Number.MAX_SAFE_INTEGER);
    const installed = (Array.isArray(payload?.models) ? payload.models : [])
      .filter(model => model?.name && Number(model.size || 0) <= maxBytes)
      .sort((a, b) => Number(b.size || 0) - Number(a.size || 0) || String(a.name).localeCompare(String(b.name)));
    const candidates = installed.map(model => String(model.name));
    const requested = String(env.OLLAMA_MODEL || env.JACO_OLLAMA_MODEL || '').trim();
    let validatedByShow = false;
    if (requested && !candidates.includes(requested)) {
      // Explicit cloud selections may be served by the daemon without a local
      // weights entry. Probe metadata only; never generate, pull, or change model.
      const cloudSelection = OLLAMA_CLOUD_RELAY.test(requested);
      if (!cloudSelection) return { provider: null, reason: `ollama-model-not-installed:${requested}`, candidates };
      const show = await fetchFn(`${root}/api/show`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: requested }), signal: AbortSignal.timeout(timeoutMs(env)),
      });
      if (!show.ok) return { provider: null, reason: `ollama-model-unavailable:${requested}:HTTP_${show.status}`, candidates };
      const metadata = await show.json();
      if (!Array.isArray(metadata?.capabilities) || !metadata.capabilities.includes('completion')) {
        return { provider: null, reason: `ollama-model-capability-missing:${requested}`, candidates };
      }
      validatedByShow = true;
    }
    if (!requested && !candidates.length) return { provider: null, reason: 'ollama-no-models' };
    const model = requested || candidates[0];
    const selectedEntry = installed.find(entry => entry.name === model);
    const cloud = OLLAMA_CLOUD_RELAY.test(model) || Boolean(selectedEntry?.remote_model || selectedEntry?.remote_host);
    return {
      provider: {
        id: 'ollama',
        family: 'openai-compatible',
        local: !cloud,
        baseUrl: `${root}/v1`,
        chatUrl: `${root}/v1/chat/completions`,
        model,
        source: validatedByShow ? 'ollama-env+show' : requested ? 'ollama-env+registry' : 'ollama-autodiscovery',
      },
      reason: null,
      candidates,
    };
  } catch (error) {
    return { provider: null, reason: discoveryFailure('ollama', error) };
  }
}

export async function discoverSeerLocalProvider({
  env = process.env,
  fetchFn = globalThis.fetch,
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetchFn is required');

  const preference = String(env.JACO_SEER_PROVIDER_PREFERENCE || env.JACO_MODEL_PROVIDER || 'auto').trim().toLowerCase();
  if (!['auto', 'llamacpp', 'litert', 'ollama', 'off'].includes(preference)) {
    throw new Error('JACO_SEER_PROVIDER_PREFERENCE must be auto, llamacpp, litert, ollama or off');
  }
  if (preference === 'off') {
    return { provider: null, preference, attempts: [], reason: 'local-provider-disabled' };
  }

  const order = preference === 'auto' ? ['litert', 'llamacpp', 'ollama'] : [preference];
  const attempts = [];
  for (const id of order) {
    const result = id === 'litert'
      ? await discoverLiteRt({ env, fetchFn })
      : id === 'llamacpp'
        ? await discoverLlamaCpp({ env, fetchFn })
        : await discoverOllama({ env, fetchFn });
    attempts.push({ id, reason: result.reason, candidates: result.candidates || [] });
    if (result.provider) return { provider: result.provider, preference, attempts, reason: null };
  }

  return {
    provider: null,
    preference,
    attempts,
    reason: attempts.map(attempt => attempt.reason).filter(Boolean).join(';') || 'no-local-provider',
  };
}

export function applySeerLocalProvider(provider, env = process.env) {
  delete env.JACO_SEER_LOCAL_PROVIDER;
  delete env.JACO_SEER_LOCAL_CHAT_URL;
  delete env.JACO_SEER_LOCAL_MODEL;
  delete env.JACO_SEER_LOCAL_SOURCE;
  delete env.JACO_SEER_PROVIDER_LOCAL;

  if (!provider) return env;
  env.JACO_SEER_LOCAL_PROVIDER = provider.id;
  env.JACO_SEER_LOCAL_CHAT_URL = provider.chatUrl;
  env.JACO_SEER_LOCAL_MODEL = provider.model;
  env.JACO_SEER_LOCAL_SOURCE = provider.source || 'discovered';
  env.JACO_SEER_PROVIDER_LOCAL = provider.local === false ? '0' : '1';

  // Preserve compatibility for other code that still reads Ollama variables.
  // LiteRT and llama.cpp keep their truthful provider identities.
  if (provider.id === 'ollama') {
    env.OLLAMA_BASE_URL = provider.baseUrl.replace(/\/v1$/i, '');
    env.OLLAMA_MODEL = provider.model;
  }
  return env;
}
