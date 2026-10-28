/** Verified-candidate implementation. Template is local JACO code, not model-generated. */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 8;
function intBound(value, fallback, max, name) {
  const v = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new Error(`INVALID_${name}`);
  return v;
}
export async function retryRequest(url, {
  method = 'GET', fetchImpl = fetch, maxRetries = 2, baseDelayMs = 5,
  maxDelayMs = 1000, sleep = ms => new Promise(r => setTimeout(r, ms)), signal,
} = {}) {
  const normalizedMethod = String(method).toUpperCase();
  const attempts = intBound(maxRetries, 2, MAX_RETRIES, 'RETRIES');
  const base = intBound(baseDelayMs, 5, 60_000, 'BASE_DELAY');
  const cap = intBound(maxDelayMs, 1000, 60_000, 'MAX_DELAY');
  const canRetry = IDEMPOTENT.has(normalizedMethod);
  let response;
  for (let retry = 0; retry <= attempts; retry++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    try {
      response = await fetchImpl(url, { method: normalizedMethod, signal });
    } catch (error) {
      if (!canRetry || retry >= attempts || signal?.aborted) throw error;
      const delay = Math.min(cap, base * 2 ** retry);
      await sleep(delay, { signal });
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      continue;
    }
    if (response.ok || !canRetry || !TRANSIENT.has(response.status) || retry >= attempts) return response;
    let delay = Math.min(cap, base * 2 ** retry);
    if (response.status === 429 || response.status === 503) {
      const retryAfter = response.headers?.get('retry-after');
      if (retryAfter && /^\d+$/.test(retryAfter.trim())) delay = Math.min(cap, Number(retryAfter.trim()) * 1000);
    }
    await sleep(delay, { signal });
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
  return response;
}
