// Canonical Aura cost engine for operator chat, SEER and Nova.
// Prices are USD per million tokens. Reference rates are estimates,
// NOT guaranteed upper bounds or externally verified provider invoices.

export function ollamaCloudPrices(env = process.env) {
  let configured = {};
  if (env.JACO_OLLAMA_CLOUD_PRICES_JSON) {
    try { configured = JSON.parse(env.JACO_OLLAMA_CLOUD_PRICES_JSON); }
    catch { throw new Error('OLLAMA_CLOUD_PRICES_INVALID_JSON'); }
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) throw new Error('OLLAMA_CLOUD_PRICES_INVALID');
  }
  const prices = {};
  const providerPrices = auraProviderPrices(env);
  for (const [key, price] of Object.entries(providerPrices)) {
    if (key.startsWith('ollama/') || key.startsWith('ollama-cloud/')) prices[key.slice(key.indexOf('/') + 1)] = price;
  }
  for (const [model, rate] of Object.entries({ ...prices, ...configured })) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model) ||
        !Number.isFinite(rate?.input) || !Number.isFinite(rate?.output) ||
        rate.input <= 0 || rate.output <= 0) throw new Error('OLLAMA_CLOUD_PRICE_INVALID');
    prices[model] = { input: rate.input, output: rate.output };
  }
  return prices;
}

export function ollamaCloudCostUsd(model, inputTokens, outputTokens, env = process.env) {
  const price = ollamaCloudPrices(env)[model];
  if (!price) throw new Error('OLLAMA_CLOUD_MODEL_NOT_PRICED');
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function auraProviderPrices(env = process.env) {
  const configured = JSON.parse(env.JACO_AURA_PROVIDER_PRICES_JSON || '{}');
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) throw new Error('AURA_PROVIDER_PRICES_INVALID');
  for (const [key, price] of Object.entries(configured)) {
    if (!key.includes('/') || !Number.isFinite(price?.input) || !Number.isFinite(price?.output) || price.input <= 0 || price.output <= 0) throw new Error('AURA_PROVIDER_PRICE_INVALID');
  }
  return configured;
}

// A model without a configured provider rate is accounted using a reference rate (USD per
// million tokens). This is NOT a verified provider invoice or a guaranteed upper bound:
// a provider can charge more or less. Persist the source for later reconciliation.
export const REFERENCE_PRICE = { input: 3, output: 15 };
export function modelPrice(providerId, model, env = process.env) {
  const configured = auraProviderPrices(env)[`${providerId}/${model}`];
  if (configured) return { ...configured, source: 'configured' };
  if (providerId === 'openrouter' && /:free$/i.test(String(model))) return { input: 0, output: 0, free: true, source: 'free' };
  let reference = REFERENCE_PRICE;
  try {
    const custom = JSON.parse(env.JACO_AURA_DEFAULT_PRICE_JSON || 'null');
    if (custom && Number.isFinite(custom.input) && Number.isFinite(custom.output) && custom.input > 0 && custom.output > 0) reference = custom;
  } catch { /* an invalid override falls back to the built-in reference */ }
  return { ...reference, source: 'reference' };
}
// An HTTP answer that says the call was refused or limited (wrong key, rate limit, bad request) was not
// billed, so its reservation is released at once instead of being held as "unknown".
export const NOT_BILLED_FAILURE = /^PROVIDER_HTTP_(400|401|402|403|404|422|429):/;

export function novaProviderCostUsd(providerId, model, inputTokens, outputTokens, env = process.env) {
  if (providerId === 'ollama-cloud') return ollamaCloudCostUsd(model, inputTokens, outputTokens, env);
  const price = modelPrice(providerId, model, env);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}


// Aura alone owns the estimate and token-based cost calculation; Continuum owns
// authorization, burst limits, reservation persistence and economic receipts.
// Quotes snapshot the exact configured/reference rates at reservation time.
export function auraCostQuote({ providerId, model, promptBytes, maxTokens, env = process.env } = {}) {
  if (typeof providerId !== 'string' || !providerId || typeof model !== 'string' || !model ||
      !Number.isSafeInteger(promptBytes) || promptBytes < 1 ||
      !Number.isSafeInteger(maxTokens) || maxTokens < 1) {
    throw new Error('AURA_COST_QUOTE_INVALID_INPUT');
  }
  const rate = providerId === 'ollama-cloud'
    ? ollamaCloudPrices(env)[model]
    : modelPrice(providerId, model, env);
  if (!rate) throw new Error('OLLAMA_CLOUD_MODEL_NOT_PRICED');
  if (![rate.input, rate.output].every(n => Number.isFinite(n) && n >= 0)) throw new Error('AURA_COST_RATE_INVALID');
  const estimatedUsd = (promptBytes * rate.input + maxTokens * rate.output) / 1_000_000;
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw new Error('AURA_COST_ESTIMATE_INVALID');
  return {
    schema: 'jaco.aura-cost-quote/v1',
    providerId, model,
    inputUsdPerMillion: rate.input,
    outputUsdPerMillion: rate.output,
    maxInputTokens: promptBytes,
    maxOutputTokens: maxTokens,
    estimatedUsd,
    priceSource: providerId === 'ollama-cloud' ? 'configured' : rate.source,
    providerInvoiceVerified: false,
  };
}

// This calculation uses the rate snapshot, never the process's current prices.
// A missing/invalid token count is not a zero-dollar response: the caller must
// preserve an UNKNOWN_OUTCOME reservation for later invoice reconciliation.
export function auraCostSettlement(quote, usage) {
  if (quote?.schema !== 'jaco.aura-cost-quote/v1' ||
      !Number.isSafeInteger(quote.maxInputTokens) || quote.maxInputTokens < 1 ||
      !Number.isSafeInteger(quote.maxOutputTokens) || quote.maxOutputTokens < 1 ||
      ![quote.inputUsdPerMillion, quote.outputUsdPerMillion, quote.estimatedUsd]
        .every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
    throw new Error('AURA_COST_QUOTE_INVALID');
  }
  const inputTokens = Number(usage?.prompt_tokens);
  const outputTokens = Number(usage?.completion_tokens);
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) ||
      inputTokens < 0 || outputTokens < 0 ||
      inputTokens > quote.maxInputTokens || outputTokens > quote.maxOutputTokens) {
    throw new Error('AURA_COST_USAGE_OUTSIDE_RESERVATION');
  }
  const costUsd = (inputTokens * quote.inputUsdPerMillion +
    outputTokens * quote.outputUsdPerMillion) / 1_000_000;
  if (!Number.isFinite(costUsd) || costUsd > quote.estimatedUsd + 1e-12) {
    throw new Error('AURA_COST_SETTLEMENT_EXCEEDS_RESERVATION');
  }
  return {
    schema: 'jaco.aura-cost-settlement/v1',
    costUsd, inputTokens, outputTokens,
    priceSource: quote.priceSource,
    providerInvoiceVerified: false,
  };
}
