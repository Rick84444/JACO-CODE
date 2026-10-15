import { pingOllama, generateOllamaCompletion } from './providers/ollamaProvider.js';
import { pingGemini, generateGeminiCompletion, areAllGeminiModelsInCooldown } from './providers/geminiProvider.js';
import { generateOnDevice } from './providers/litertProvider.js';

// Use a model that is actually installed. The pool used to request a hardcoded "llama3.2", which fails on
// machines that have other models, so every generation fell through to LiteRT and failed.
const OLLAMA_MODEL_CACHE_MS = 5 * 60_000;
let ollamaModelCache: { endpoint: string; model: string | null; at: number } | null = null;

export async function resolveOllamaModel(endpoint: string): Promise<string | null> {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  if (ollamaModelCache && ollamaModelCache.endpoint === endpoint && Date.now() - ollamaModelCache.at < OLLAMA_MODEL_CACHE_MS) {
    return ollamaModelCache.model;
  }
  let model: string | null = null;
  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json();
      const installed = (Array.isArray(data?.models) ? data.models : [])
        .filter((m: any) => m?.name)
        .sort((a: any, b: any) => Number(b.size || 0) - Number(a.size || 0) || String(a.name).localeCompare(String(b.name)));
      model = installed[0]?.name || null;
    }
  } catch {}
  ollamaModelCache = { endpoint, model, at: Date.now() };
  return model;
}

export interface ModelProvider {
  name: string;
  type: 'ollama' | 'gemini' | 'litert_npu' | 'lmstudio';
  endpoint: string;
  isHealthy: boolean;
  latencyMs: number;
  lastChecked: string;
  details?: string;
}

export interface ModelRoutingDecision {
  provider: ModelProvider;
  reason: string;
  taskCategory: string;
}

const providers: ModelProvider[] = [
  {
    name: 'Termux Local Ollama',
    type: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    isHealthy: true,
    latencyMs: 18,
    lastChecked: new Date().toISOString()
  },
  {
    name: 'Android LiteRT NPU',
    type: 'litert_npu',
    endpoint: 'http://127.0.0.1:3000/api/android/aicore',
    // Only routable when a LiteRT-LM server is configured; otherwise privacy routing must fall to Ollama.
    isHealthy: Boolean(process.env.JACO_LITERT_URL),
    latencyMs: 8,
    lastChecked: new Date().toISOString()
  },
  {
    name: 'Gemini Cloud Pro/Flash',
    type: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com',
    isHealthy: true,
    latencyMs: 140,
    lastChecked: new Date().toISOString()
  }
];

export async function checkProviderHealth(providerName: string): Promise<ModelProvider | undefined> {
  const p = providers.find((item) => item.name === providerName);
  if (!p) return undefined;

  p.lastChecked = new Date().toISOString();

  if (p.type === 'ollama') {
    const res = await pingOllama(p.endpoint);
    p.isHealthy = res.isHealthy;
    p.latencyMs = res.latencyMs;
    p.details = res.error || (res.models.length > 0 ? `Modeller: ${res.models.join(', ')}` : 'Nåbar utan modeller');
  } else if (p.type === 'gemini') {
    const res = await pingGemini();
    p.isHealthy = res.isHealthy;
    p.latencyMs = res.latencyMs;
    p.details = res.error || (res.hasApiKey ? 'Aktiv med giltig GEMINI_API_KEY' : 'Saknar API-nyckel');
  }

  return p;
}

export async function checkAllProvidersHealth(): Promise<ModelProvider[]> {
  for (const p of providers) {
    await checkProviderHealth(p.name);
  }
  return [...providers];
}

export function listProviders(): ModelProvider[] {
  return [...providers];
}

// JACO_MODEL_PROVIDER=ollama keeps all pool generation on the local Ollama server (no cloud calls, no API cost).
export function localModelsOnly(): boolean {
  return String(process.env.JACO_MODEL_PROVIDER || '').toLowerCase() === 'ollama';
}

export function routeRequest(taskCategory: string, requiresPrivacy: boolean = false): ModelRoutingDecision {
  if (localModelsOnly()) {
    const ollama = providers.find((p) => p.type === 'ollama');
    if (ollama) return { provider: ollama, reason: 'JACO_MODEL_PROVIDER=ollama: local inference only', taskCategory };
  }
  const isGeminiInCooldown = areAllGeminiModelsInCooldown();

  if (requiresPrivacy || isGeminiInCooldown) {
    const npu = providers.find((p) => p.type === 'litert_npu' && p.isHealthy);
    if (npu) {
      return {
        provider: npu,
        reason: isGeminiInCooldown
          ? 'Lokal on-device inferens aktiv under Gemini kvot-cooldown (429 mitigation)'
          : 'Lokal on-device inferens prioriterad för fullständig datasekretess',
        taskCategory
      };
    }

    const ollama = providers.find((p) => p.type === 'ollama' && p.isHealthy);
    if (ollama) {
      return {
        provider: ollama,
        reason: isGeminiInCooldown
          ? 'Lokal Ollama prioriterad under Gemini kvot-cooldown (429 mitigation)'
          : 'Lokal Ollama prioriterad för lokal offline-exekvering',
        taskCategory
      };
    }
  }

  // För komplex kodgranskning eller molnkapacitet om Gemini inte är i cooldown
  if (!isGeminiInCooldown) {
    const gemini = providers.find((p) => p.type === 'gemini' && p.isHealthy);
    if (gemini) {
      return {
        provider: gemini,
        reason: 'Molnbaserad Gemini för avancerat multimodalt resonemang',
        taskCategory
      };
    }
  }

  return {
    provider: providers[0],
    reason: 'Standard fallback-leverantör',
    taskCategory
  };
}

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  taskCategory?: string;
  requiresPrivacy?: boolean;
}

export interface GenerateResult {
  text: string;
  providerUsed: string;
  latencyMs: number;
  lowConfidence?: boolean;
}

/** Fail-closed: provider absence is UNAVAILABLE, never a fabricated completion. */
export async function generate(options: GenerateOptions | string): Promise<GenerateResult> {
  const opts: GenerateOptions = typeof options === 'string' ? { prompt: options } : options;
  const { prompt, systemPrompt, taskCategory = 'general', requiresPrivacy = false } = opts;
  const fullPrompt = systemPrompt ? `System: ${systemPrompt}\n\nUser:\n${prompt}` : prompt;

  const route = routeRequest(taskCategory, requiresPrivacy);
  const p = route.provider;

  // 1. Try Primary Routed Provider
  if (p.type === 'gemini' && !localModelsOnly()) {
    try {
      const res = await generateGeminiCompletion(prompt, 'gemini-2.5-flash', systemPrompt);
      return { text: res.text, providerUsed: p.name, latencyMs: res.latencyMs, lowConfidence: false };
    } catch (err: any) {
      // Degrade Gemini provider status temporarily
      const geminiEntry = providers.find(item => item.type === 'gemini');
      if (geminiEntry) geminiEntry.isHealthy = false;
    }
  }

  // 2. Try Ollama Local
  try {
    const ollamaEntry = providers.find(item => item.type === 'ollama');
    const model = ollamaEntry ? await resolveOllamaModel(ollamaEntry.endpoint) : null;
    if (ollamaEntry && model) {
      const res = await generateOllamaCompletion(ollamaEntry.endpoint, model, fullPrompt);
      return { text: res.text, providerUsed: ollamaEntry.name, latencyMs: res.latencyMs, lowConfidence: false };
    }
  } catch (_) {}

  // 3. Try LiteRT NPU On-Device
  try {
    const res = await generateOnDevice(prompt, systemPrompt);
    if (res) {
      return { text: res.text, providerUsed: 'Android LiteRT NPU', latencyMs: res.latencyMs, lowConfidence: true };
    }
  } catch (_) {}

  // 4. No provider returned evidence: fail closed instead of synthesizing success-shaped text.
  throw new Error(`PROVIDER_UNAVAILABLE:${taskCategory}`);
}

export async function executePoolCompletion(
  prompt: string,
  taskCategory: string = 'general',
  requiresPrivacy: boolean = false
): Promise<{ text: string; providerName: string; latencyMs: number }> {
  const res = await generate({ prompt, taskCategory, requiresPrivacy });
  return {
    text: res.text,
    providerName: res.providerUsed,
    latencyMs: res.latencyMs
  };
}



export function updateProviderEndpoint(providerType: 'ollama' | 'gemini' | 'litert_npu' | 'lmstudio', newEndpoint: string) {
  const p = providers.find((item) => item.type === providerType);
  if (p) {
    p.endpoint = newEndpoint;
    p.isHealthy = true; // reset health when endpoint changes
    console.log(`[ModelPool] Uppdaterade ${providerType} endpoint till ${newEndpoint}`);
  }
}
