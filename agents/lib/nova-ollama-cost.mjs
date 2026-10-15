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

export async function reserveNovaOllamaCost({ providerId = 'ollama-cloud', model, requestBody, runtimeUrl, token, fetchImpl }) {
  return novaOllamaCostRequest('reserve', {
    providerId, model,
    promptBytes: Buffer.byteLength(JSON.stringify(requestBody), 'utf8'),
    maxTokens: requestBody.max_tokens,
  }, { runtimeUrl, token, fetchImpl });
}

// Statuses after which the provider cannot have generated (or billed) anything.
export const DEFINITE_NO_CHARGE = new Set([400, 401, 402, 403, 404, 413, 422, 429]);

export async function budgetedNovaOllamaCall({ provider, requestBody, runtimeUrl, token, fetchImpl = fetch, signal }) {
  const { reservationId } = await reserveNovaOllamaCost({ providerId: provider.name, model: provider.model, requestBody, runtimeUrl, token, fetchImpl });
  let settled = false;
  try {
    const response = await fetchImpl(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify(requestBody), signal,
    });
    const rawBody = await response.text();
    let data; try { data = JSON.parse(rawBody); } catch { data = null; }
    // A definite client/quota/balance error produced no generation and no charge: free the reservation now.
    if (DEFINITE_NO_CHARGE.has(response.status)) {
      try { await novaOllamaCostRequest('release', { reservationId, status: response.status }, { runtimeUrl, token, fetchImpl }); settled = true; } catch {}
      return { response, rawBody, data };
    }
    const usage = data?.usage;
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
