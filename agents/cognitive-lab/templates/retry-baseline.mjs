/** Deliberately limited baseline hypothesis. The independent reviewer must reject it. */
export async function retryRequest(url, {
  method = 'GET', fetchImpl = fetch, maxRetries = 2, baseDelayMs = 5,
  sleep = ms => new Promise(r => setTimeout(r, ms)), signal,
} = {}) {
  let response;
  for (let retry = 0; retry <= maxRetries; retry++) {
    response = await fetchImpl(url, { method, signal });
    if (response.ok) return response;
    if (retry < maxRetries) await sleep(baseDelayMs * (2 ** retry));
  }
  return response;
}
