// Aura chat is a client of the canonical Aura cost engine; it does not own token prices.
import {
  auraProviderPrices, ollamaCloudPrices, ollamaCloudCostUsd, modelPrice, novaProviderCostUsd,
  auraCostQuote, auraCostSettlement, NOT_BILLED_FAILURE,
} from '../aura/costEngine.mjs';
export {
  auraProviderPrices, ollamaCloudPrices, ollamaCloudCostUsd, modelPrice, novaProviderCostUsd,
  auraCostQuote, auraCostSettlement, NOT_BILLED_FAILURE, REFERENCE_PRICE,
} from '../aura/costEngine.mjs';

const MAX_OUTPUT_TOKENS = 700;
const MAX_PROMPT_BYTES = 24000;

export function auraOllamaModelCatalog(env = process.env) {
  const prices = ollamaCloudPrices(env);
  return String(env.JACO_AURA_OLLAMA_CLOUD_MODELS || '').split(',').map(model => model.trim())
    .filter(model => Object.hasOwn(prices, model))
    .filter((model, index, all) => all.indexOf(model) === index);
}

export function auraChatProviderCatalog(providers, env = process.env) {
  const prices = auraProviderPrices(env);
  return providers.list().map(p => {
    const host = new URL(p.baseUrl).hostname;
    const local = ['localhost','127.0.0.1','[::1]'].includes(host);
    const pricedModels = Object.keys(prices).filter(key => key.startsWith(`${p.id}/`)).map(key => key.slice(p.id.length + 1));
    const models = [...new Set([p.defaultModel, ...(p.id === 'ollama' ? auraOllamaModelCatalog(env) : []), ...pricedModels].filter(Boolean))];
    return { id: p.id, local, defaultModel: p.defaultModel || '', models,
      credentialReady: local || !p.apiKeyEnv || p.credentialConfigured,
      pricedModels: [...new Set([...pricedModels, ...(p.id === 'ollama' ? auraOllamaModelCatalog(env) : [])])],
    };
  });
}

export async function manualAuraProviderCompletion({ providerId, model, system, user, temperature = 0.2 }, { providers, economic, env = process.env }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model || '')) throw new Error('AURA_MODEL_INVALID');
  const entry = auraChatProviderCatalog(providers, env).find(p => p.id === providerId);
  if (!entry) throw new Error('AURA_PROVIDER_NOT_REGISTERED');
  if (!entry.credentialReady) throw new Error('AURA_PROVIDER_CREDENTIAL_MISSING');
  if (providerId === 'ollama' && auraOllamaModelCatalog(env).includes(model)) {
    return manualAuraOllamaCompletion({ model, system, user, temperature }, { providers, economic, env });
  }
  if (typeof system !== 'string' || typeof user !== 'string') throw new Error('AURA_CHAT_PROMPT_INVALID');
  const bytes = Buffer.byteLength(system + user, 'utf8');
  if (bytes > MAX_PROMPT_BYTES) throw new Error('AURA_CHAT_PROMPT_TOO_LARGE');
  const configured = auraProviderPrices(env)[`${providerId}/${model}`];
  // A cloud model can be served through a loopback relay; its suffix must not bypass cost accounting.
  const isCloudSuffix = /(?:-cloud|:cloud)$/.test(model);
  const price = configured || (entry.local && !isCloudSuffix ? null : modelPrice(providerId, model, env));
  const local = (entry.local && !configured && !isCloudSuffix) || Boolean(price?.free);
  let reservation = null;
  let quote = null;
  if (!local) {
    quote = auraCostQuote({ providerId, model, promptBytes: bytes, maxTokens: MAX_OUTPUT_TOKENS, env });
    const auth = economic.authorizeCloud({ estimatedUsd: quote.estimatedUsd, purpose: 'manual-aura-chat',
      metadata: { providerId, model, priceSource: quote.priceSource, auraCostQuote: quote, providerInvoiceVerified: false } });
    if (!auth.allowed) throw new Error(`AURA_CLOUD_DENIED:${auth.reason}`);
    reservation = auth.reservationId;
  }
  try {
    const result = await providers.chat({ providerId, model, maxTokens: MAX_OUTPUT_TOKENS, temperature,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    if (local) return { text: result.content, provider: providerId, model: result.model || model, local: !price?.free, costStatus: price?.free ? 'FREE' : 'LOCAL' };
    let settlement;
    try { settlement = auraCostSettlement(quote, result.usage); }
    catch {
      economic.markCloudOutcomeUnknown(reservation, 'provider usage missing or outside reserved bounds');
      return { text: result.content, provider: providerId, model: result.model || model, local: false, costStatus: 'OUTCOME_UNKNOWN' };
    }
    economic.settleCloud(reservation, settlement.costUsd, result.usage);
    return { text: result.content, provider: providerId, model: result.model || model, local: false, costStatus: 'SETTLED', costUsd: settlement.costUsd,
      priceSource: settlement.priceSource, providerInvoiceVerified: false };
  } catch (error) {
    if (reservation) {
      if (NOT_BILLED_FAILURE.test(String(error?.message || ''))) {
        // Preserve rate-limit status for Google's durable per-model cooldown.
        const status = /^PROVIDER_HTTP_(\d{3}):/.exec(String(error?.message || ''))?.[1] || 'unknown';
        economic.releaseReservation(reservation, 'provider returned HTTP ' + status + ' without generation');
      }
      else economic.markCloudOutcomeUnknown(reservation, 'provider request failed after dispatch');
    }
    throw error;
  }
}

export async function manualAuraOllamaCompletion({ model, system, user, temperature = 0.2 }, { providers, economic, env = process.env }) {
  const price = ollamaCloudPrices(env)[model];
  if (!price) throw new Error('AURA_CLOUD_MODEL_NOT_PRICED');
  if (!auraOllamaModelCatalog(env).includes(model)) throw new Error('AURA_CLOUD_MODEL_NOT_CONFIGURED');
  if (typeof system !== 'string' || typeof user !== 'string') throw new Error('AURA_CHAT_PROMPT_INVALID');
  const promptBytes = Buffer.byteLength(system + user, 'utf8');
  if (promptBytes > MAX_PROMPT_BYTES) throw new Error('AURA_CHAT_PROMPT_TOO_LARGE');

  // Bytes bound the number of input tokens for these text prompts. Reserve the
  // worst case before sending; missing usage or a transport error stays unknown.
  const quote = auraCostQuote({ providerId: 'ollama-cloud', model, promptBytes, maxTokens: MAX_OUTPUT_TOKENS, env });
  const authorization = economic.authorizeCloud({ estimatedUsd: quote.estimatedUsd, purpose: 'manual-aura-chat',
    metadata: { providerId: 'ollama-cloud', model, priceSource: quote.priceSource, auraCostQuote: quote, providerInvoiceVerified: false } });
  if (!authorization.allowed) throw new Error(`AURA_CLOUD_DENIED:${authorization.reason}`);

  try {
    const result = await providers.chat({
      providerId: 'ollama', model, maxTokens: MAX_OUTPUT_TOKENS, temperature,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    let settlement;
    try { settlement = auraCostSettlement(quote, result.usage); }
    catch {
      economic.markCloudOutcomeUnknown(authorization.reservationId, 'provider usage missing or outside reserved bounds');
      return { text: result.content, provider: 'ollama', model, local: false, costStatus: 'OUTCOME_UNKNOWN' };
    }
    economic.settleCloud(authorization.reservationId, settlement.costUsd, result.usage);
    return { text: result.content, provider: 'ollama', model, local: false, costStatus: 'SETTLED', costUsd: settlement.costUsd,
      priceSource: settlement.priceSource, providerInvoiceVerified: false };
  } catch (error) {
    if (/^PROVIDER_HTTP_402:/.test(String(error?.message || ''))) {
      economic.releaseReservation(authorization.reservationId, 'provider subscription required; no inference');
    } else {
      economic.markCloudOutcomeUnknown(authorization.reservationId, 'provider request failed after dispatch');
    }
    throw error;
  }
}

// The default chat tries SEER's local model first. When that has no answer, the chat falls back to a
// provider the operator has connected (key saved, not local), through the budgeted path, so a message
// is answered instead of failing. Free models first, then the usual cheap ones, then any other.
const FALLBACK_ORDER = ['groq', 'deepseek', 'openrouter', 'gemini', 'qwen', 'mistral', 'together', 'xai', 'openai', 'anthropic'];
export function chatFallbackChoice(providers, env = process.env) {
  const ready = auraChatProviderCatalog(providers, env).filter(p => !p.local && p.credentialReady && p.defaultModel);
  const rank = p => (p.id === 'openrouter' && /:free$/i.test(p.defaultModel) ? -1 : (i => (i < 0 ? FALLBACK_ORDER.length : i))(FALLBACK_ORDER.indexOf(p.id)));
  const best = ready.sort((a, b) => rank(a) - rank(b))[0];
  return best ? { providerId: best.id, model: best.defaultModel } : null;
}

// What the operator sees when a chat message cannot be answered: what is wrong in plain Swedish and the
// one thing to do about it. `action` is a button in the chat: enable-cloud | open-budget | open-providers.
export function chatFailureHint(error, { hasProvider = true } = {}) {
  const text = String(error?.message || error || '');
  const code = /AURA_CLOUD_DENIED:([A-Z_]+)/.exec(text)?.[1] || '';
  if (code === 'CLOUD_DISABLED_BY_POLICY') return { code, message: 'Molnmodeller är avstängda, så jag kan inte svara via en molnmodell. Slå på dem så svarar jag inom din budget.', action: 'enable-cloud', actionLabel: 'Slå på moln' };
  if (code === 'DAILY_BUDGET_LIMIT' || code === 'MONTHLY_BUDGET_LIMIT') return { code, message: `Budgeten räcker inte till just nu (${code === 'DAILY_BUDGET_LIMIT' ? 'dagens gräns' : 'månadens gräns'}). Höj gränsen eller frigör reserverat belopp under Providers.`, action: 'open-budget', actionLabel: 'Öppna budget' };
  if (code === 'TASK_COST_LIMIT') return { code, message: 'Svaret skulle kosta mer än gränsen per uppgift. Höj den under Providers.', action: 'open-budget', actionLabel: 'Öppna budget' };
  if (/AURA_PROVIDER_CREDENTIAL_MISSING|PROVIDER_KEY_MISSING/.test(text)) return { code: 'KEY_MISSING', message: 'Den valda leverantören saknar nyckel. Lägg in den under Providers.', action: 'open-providers', actionLabel: 'Öppna Providers' };
  if (/PROVIDER_HTTP_401|PROVIDER_HTTP_403/.test(text)) return { code: 'KEY_REJECTED', message: 'Leverantören nekade nyckeln. Kontrollera att den är giltig under Providers.', action: 'open-providers', actionLabel: 'Öppna Providers' };
  if (/PROVIDER_HTTP_429/.test(text)) return { code: 'RATE_LIMITED', message: 'Leverantören begränsar anropen just nu. Försök igen om en stund eller välj en annan modell.', action: 'open-providers', actionLabel: 'Välj modell' };
  if (/timeout|TimeoutError|aborted/i.test(text)) return { code: 'TIMEOUT', message: 'Modellen svarade inte i tid. En lokal modell på svag hårdvara kan vara för långsam: anslut en molnmodell under Providers.', action: 'open-providers', actionLabel: 'Anslut modell' };
  if (!hasProvider || /all_providers_failed|AURA_SEER_CHAT_UNAVAILABLE|NO_PLANNER/.test(text)) return { code: 'NO_MODEL', message: 'Ingen modell är ansluten som kan svara. Anslut en under Providers (klistra in en adress som deepseek.com).', action: 'open-providers', actionLabel: 'Anslut modell' };
  return { code: 'FAILED', message: `Svaret misslyckades: ${text.slice(0, 160)}`, action: 'open-providers', actionLabel: 'Öppna Providers' };
}
