// Nova reserves paid provider spend in the canonical Continuum EconomicGovernor.
// The existing ollama-cost route names remain compatible with older clients.
// owned by the runtime process. A lost response never releases a reservation.
export async function novaOllamaCostRequest(path, body, { runtimeUrl, token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${runtimeUrl.replace(/\/$/, '')}/api/nova/ollama-cost/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gateway-token': token || '' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) throw new Error(result.error || `NOVA_COST_HTTP_${response.status}`);
  return result;
}

// Providers bill an image by tiles, not by the length of its base64 encoding. Counting the data URL as prompt
// text made one full-screen Laser Vision frame several hundred kilobytes of "prompt", the reservation route
// refused it as invalid (promptBytes > 200000) and the mission stopped right after its first screenshot
// (observed 2026-11-22, live desktop test). Each image now costs a fixed, deliberately generous byte budget
// that covers the largest tiled image a provider charges for, so the spend estimate stays an upper bound.
// The operator can set their provider's real per-image input-token cost with JACO_IMAGE_INPUT_TOKENS.
export const IMAGE_COST_BYTES = Number.isSafeInteger(Number(process.env.JACO_IMAGE_INPUT_TOKENS)) && Number(process.env.JACO_IMAGE_INPUT_TOKENS) > 0
  ? Number(process.env.JACO_IMAGE_INPUT_TOKENS) : 8000;

export function costPromptBytes(requestBody) {
  let images = 0;
  const text = JSON.stringify(requestBody ?? {}, (key, value) => {
    if (key === 'image_url' && value && typeof value === 'object' && typeof value.url === 'string' && value.url.startsWith('data:')) {
      images += 1;
      return { url: 'data:image' };
    }
    if ((key === 'inline_data' || key === 'inlineData') && value && typeof value === 'object' && typeof value.data === 'string') {
      images += 1;
      return { mime_type: value.mime_type || value.mimeType, data: '' };
    }
    return value;
  });
  return Buffer.byteLength(text, 'utf8') + images * IMAGE_COST_BYTES;
}

export async function reserveNovaOllamaCost({ providerId = 'ollama-cloud', model, requestBody, runtimeUrl, token, fetchImpl, maxTokens }) {
  return novaOllamaCostRequest('reserve', {
    providerId, model,
    promptBytes: costPromptBytes(requestBody),
    maxTokens: maxTokens ?? requestBody.max_tokens,
  }, { runtimeUrl, token, fetchImpl });
}

// Statuses after which the provider cannot have generated (or billed) anything.
export const DEFINITE_NO_CHARGE = new Set([400, 401, 402, 403, 404, 413, 422, 429]);

// Non-OpenAI protocols (Gemini's native generateContent) pass their own auth headers, output-token
// ceiling and a mapper from their usage block to { prompt_tokens, completion_tokens }.
export async function budgetedNovaOllamaCall({ provider, requestBody, runtimeUrl, token, fetchImpl = fetch, signal, headers = null, maxTokens, usageOf = data => data?.usage }) {
  const { reservationId } = await reserveNovaOllamaCost({ providerId: provider.name, model: provider.model, requestBody, runtimeUrl, token, fetchImpl, maxTokens });
  let settled = false;
  try {
    const response = await fetchImpl(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || (provider.key ? { Authorization: `Bearer ${provider.key}` } : {})) },
      body: JSON.stringify(requestBody), signal,
    });
    const rawBody = await response.text();
    let data; try { data = JSON.parse(rawBody); } catch { data = null; }
    // A definite client/quota/balance error produced no generation and no charge: free the reservation now.
    if (DEFINITE_NO_CHARGE.has(response.status)) {
      try { await novaOllamaCostRequest('release', { reservationId, status: response.status }, { runtimeUrl, token, fetchImpl }); settled = true; } catch {}
      return { response, rawBody, data };
    }
    const usage = usageOf(data);
    if (!usage || !Number.isInteger(usage.prompt_tokens) || !Number.isInteger(usage.completion_tokens)) {
      throw new Error('NOVA_CLOUD_COST_OUTCOME_UNKNOWN');
    }
    await novaOllamaCostRequest('settle', { reservationId, usage }, { runtimeUrl, token, fetchImpl });
    settled = true;
    return { response, rawBody, data };
  } catch (error) {
    if (!settled) {
      try { await novaOllamaCostRequest('unknown', { reservationId }, { runtimeUrl, token, fetchImpl }); } catch {}
    }
    throw error;
  }
}
