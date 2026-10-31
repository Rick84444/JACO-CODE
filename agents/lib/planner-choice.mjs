// The operator's choice of Nova's planner model. The runtime writes it from the GUI
// (IDE sidebar Providers > Nova planner, POST /api/nova/planner); Nova reads it on every planning turn, so a
// switch applies from the next turn without a restart. Only the providers and models listed here
// can be chosen. A paid choice still needs JACO_ALLOW_PAID_MODELS=1 and stays under Nova's daily
// dollar ceiling (JACO_NOVA_PAID_USD_PER_DAY).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { budgetedNovaOllamaCall } from './nova-ollama-cost.mjs';
import { credential } from './secret-store.mjs';

// `extra` is the providers the operator connected in the IDE (the runtime's registry, with the models they
// really list): they are offered next to the fixed ones, merged by name, and any model a connected provider
// serves can be chosen. Without it only the fixed list below exists, which is what hid every provider
// connected from a URL or a key (operator 2026-10-13: "can't switch to the LLM I want on mobile").
export function plannerChoices(env = process.env, extra = {}) {
  const fixed = fixedPlannerChoices(env);
  for (const [name, c] of Object.entries(extra || {})) {
    if (!c || !Array.isArray(c.models)) continue;
    const known = fixed[name];
    if (known) fixed[name] = { ...known, models: [...new Set([...known.models, ...c.models])], dynamic: true };
    else fixed[name] = { label: c.label || name, paid: Boolean(c.paid), keyEnv: c.keyEnv || null, url: c.url, models: [...new Set(c.models)], dynamic: true };
  }
  return fixed;
}

const keyOf = (choice, env) => (choice.keyEnv ? credential(choice.keyEnv, { env }) : 'ok');

function fixedPlannerChoices(env = process.env) {
  const ollamaBase = env.OLLAMA_BASE_URL || 'http://localhost:11434';
  return {
    // Ollama Cloud uses metered tokens. Nova reserves cost through Continuum.
    'ollama-cloud': {
      label: 'Ollama Cloud', paid: true, keyEnv: 'OLLAMA_API_KEY', url: `${env.OLLAMA_CLOUD_URL || 'https://ollama.com'}/v1/chat/completions`,
      models: [...new Set([env.OLLAMA_CLOUD_MODEL, ...String(env.JACO_OLLAMA_CLOUD_MODELS || '').split(',')].map(v => String(v || '').trim()).filter(Boolean))],
    },
    // Hugging Face Inference Providers: free monthly credits, then billed per token.
    huggingface: {
      label: 'Hugging Face', paid: true, keyEnv: env.HF_TOKEN ? 'HF_TOKEN' : 'HUGGINGFACE_TOKEN', url: 'https://router.huggingface.co/v1/chat/completions',
      models: ['prism-ml/Ternary-Bonsai-27B-gguf', 'prism-ml/Ternary-Bonsai-27B-AWQ-4bit'],
    },
    deepseek: {
      label: 'DeepSeek', paid: true, keyEnv: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/v1/chat/completions',
      // deepseek-flash stalled without answering on 2026-10-01 while deepseek-v4-pro answered in ~1 s.
      models: ['deepseek-v4-pro', 'deepseek-flash'],
    },
    groq: {
      label: 'Groq (gratis)', paid: false, keyEnv: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/chat/completions',
      models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    },
    openrouter: {
      label: 'OpenRouter (gratis)', paid: false, keyEnv: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions',
      models: ['qwen/qwen3.8-27b:free', 'google/gemma-4-31b-it:free'],
    },
    ollama: {
      label: 'Ollama (lokal)', paid: false, keyEnv: null, url: `${ollamaBase}/v1/chat/completions`,
      models: [...new Set([env.OLLAMA_MODEL, env.JACO_OLLAMA_LOCAL_MODEL || 'gemma3:4b'].filter(Boolean))],
    },
  };
}

// Shared by the runtime (its working directory is JACO_RUNTIME_DIR) and Nova (which runs from the
// main checkout and finds the runtime through JACO_RUNTIME_DIR in .env).
export function plannerChoiceFile(env = process.env) {
  if (env.JACO_PLANNER_CHOICE_FILE) return env.JACO_PLANNER_CHOICE_FILE;
  return join(env.JACO_RUNTIME_DIR || env.JACO_WORKSPACE_ROOT || process.cwd(), '.jaco', 'state', 'provider-preference.json');
}

// Provider listings mix chat models with speech, embedding, image and video models. Those cannot
// plan: a saved gemini-2.5-pro-preview-tts answered every Nova turn with HTTP 400 (2026-10-31).
const NON_TEXT_MODEL = [
  ['tts', /(^|[-_/.:])tts([-_/.:]|$)|text-to-speech/i],
  ['embedding', /embed/i],
  ['audio', /(^|[-_/.:])(native-audio|audio|whisper|transcribe|live)([-_/.:]|$)/i],
  ['image', /(^|[-_/.:])(imagen|image|dall-e|flux|stable-diffusion)([-_/.:]|$)/i],
  ['video', /(^|[-_/.:])veo([-_/.:]|$)/i],
  ['attributed-qa', /(^|[-_/.:])aqa([-_/.:]|$)/i],
  ['moderation', /moderation|guard([-_/.:]|$)/i],
];
export function nonTextModelKind(model) {
  return NON_TEXT_MODEL.find(([, pattern]) => pattern.test(String(model || '')))?.[0] || null;
}

// A saved choice of a model that cannot plan is ignored (the file is kept for the operator to see),
// so Nova falls back to its automatic chain instead of failing every turn.
export function readPlannerChoice(file) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return saved && typeof saved.provider === 'string' && !nonTextModelKind(saved.model) ? saved : null;
  } catch { return null; }
}

export function validatePlannerChoice({ provider, model } = {}, env = process.env, extra = {}) {
  const choice = plannerChoices(env, extra)[String(provider || '')];
  if (!choice) throw new Error(`PLANNER_PROVIDER_UNKNOWN:${provider}`);
  const chosenModel = String(model || choice.models[0] || '');
  // A connected provider may serve more than its listing shows; only the fixed ones are held to their list.
  if (!chosenModel || (!choice.models.includes(chosenModel) && !(choice.dynamic && /^[\w.:/@+-]{1,160}$/.test(chosenModel)))) throw new Error(`PLANNER_MODEL_UNKNOWN:${provider}/${model}`);
  const kind = nonTextModelKind(chosenModel);
  if (kind) throw new Error(`PLANNER_MODEL_NOT_TEXT:${kind}`);
  if (choice.keyEnv && !keyOf(choice, env)) throw new Error(`PLANNER_KEY_MISSING:${choice.keyEnv}`);
  if (choice.paid && env.JACO_ALLOW_PAID_MODELS === '0') throw new Error('PLANNER_PAID_MODELS_DISABLED:JACO_ALLOW_PAID_MODELS');
  return { provider: String(provider), model: chosenModel, paid: choice.paid };
}

export function writePlannerChoice(file, { provider, model }, by = 'operator', now = new Date()) {
  mkdirSync(dirname(file), { recursive: true });
  const saved = { provider, model, by, at: now.toISOString() };
  writeFileSync(file, JSON.stringify(saved, null, 2));
  return saved;
}

export function clearPlannerChoice(file) { rmSync(file, { force: true }); }

// One small real call, so the operator sees that the model answers (and how fast) before switching.
// A paid model costs a fraction of a cent per test.
export async function testPlannerModel({ provider, model }, { env = process.env, fetchImpl = fetch, timeoutMs = 60_000, extra = {} } = {}) {
  const choice = plannerChoices(env, extra)[provider];
  if (!choice || !(choice.models.includes(model) || (choice.dynamic && model))) throw new Error(`PLANNER_MODEL_UNKNOWN:${provider}/${model}`);
  const kind = nonTextModelKind(model);
  if (kind) return { ok: false, provider, model, latencyMs: 0, error: `PLANNER_MODEL_NOT_TEXT:${kind}` };
  const key = choice.keyEnv ? credential(choice.keyEnv, { env }) : '';
  if (choice.keyEnv && !key) throw new Error(`PLANNER_KEY_MISSING:${choice.keyEnv}`);
  // Aura owns the provider switch. Every potentially billable probe must use the same
  // Continuum reservation as SEER and Nova; the previous path only budgeted ollama-cloud.
  const endpoint = new URL(choice.url);
  const loopback = endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  const cloudRelay = /(?:-cloud|:cloud)$/i.test(String(model));
  // Only OpenRouter's explicit :free tier is classified as non-billable.
  // An arbitrary connected HTTPS provider cannot bypass Continuum by naming a model ":free".
  const metered = !loopback && !(provider === 'openrouter' && /:free$/i.test(String(model)));
  const started = Date.now();
  try {
    if (loopback && cloudRelay) throw new Error('OLLAMA_CLOUD_RELAY_NOT_RESERVABLE');
    if (!loopback && endpoint.protocol !== 'https:') throw new Error('PLANNER_ENDPOINT_UNTRUSTED');
    if (metered && env.JACO_ALLOW_PAID_MODELS !== '1') throw new Error('PAID_PROVIDER_DISABLED');
    const requestBody = { model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 200 };
    const cloudResult = metered
      ? await budgetedNovaOllamaCall({ provider: { name: provider, model, url: choice.url, key }, requestBody,
        runtimeUrl: env.JACO_RUNTIME_URL || `http://127.0.0.1:${Number(env.PORT) || 3000}`, token: env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '',
        fetchImpl, signal: AbortSignal.timeout(timeoutMs) }) : null;
    const res = cloudResult?.response || await fetchImpl(choice.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = cloudResult?.data ?? await res.json().catch(() => null);
    const reply = data?.choices?.[0]?.message?.content ?? null;
    const latencyMs = Date.now() - started;
    if (!res.ok || !reply) return { ok: false, provider, model, latencyMs, status: res.status, error: String(data?.error?.message || 'no answer').slice(0, 300) };
    return { ok: true, provider, model, latencyMs, reply: String(reply).trim().slice(0, 200), usage: data?.usage || null };
  } catch (error) {
    return { ok: false, provider, model, latencyMs: Date.now() - started, error: String(error?.message || error).slice(0, 300) };
  }
}
