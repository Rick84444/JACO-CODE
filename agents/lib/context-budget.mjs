// How much conversation a model with a limited context window can be given.
//
// The loop condensed history at a fixed 60 000 characters of messages. That figure ignores the tool schemas (sent with
// every request) and the output reserve, and it fitted only large cloud windows: a local model with 24-32k tokens
// received a 24 360-token request and answered HTTP 400 "exceeds the available context size" (2026-11-23).
// The budget only ever lowers the old default, so a model with a large window behaves exactly as before.

// Conservative for JSON-heavy prompts (measured 2.7 characters per token on a real mission prompt).
export const CHARS_PER_TOKEN = 2.4;

export function contextCharsBudget({
  contextTokens, reservedChars = 0, outputTokens = 2048, charsPerToken = CHARS_PER_TOKEN, floor = 12_000, fallback = 60_000,
} = {}) {
  if (!Number.isSafeInteger(contextTokens) || contextTokens < 2048) return fallback;
  // 10 % margin for tokenizer variance and the chat template, then the room the answer needs.
  const promptTokens = Math.floor(contextTokens * 0.9) - outputTokens;
  const chars = Math.floor(promptTokens * charsPerToken) - Math.max(0, reservedChars);
  return Math.max(floor, Math.min(fallback, chars));
}

const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
const cache = new Map();

/** The context window of a llama.cpp server on this computer, from its own /props. Null when it cannot be read. */
export async function localContextTokens(baseUrl, { fetchImpl = fetch, ttlMs = 60_000, now = Date.now() } = {}) {
  let origin;
  try { const url = new URL(String(baseUrl)); if (!loopback(url.hostname) || url.username || url.password) return null; origin = url.origin; }
  catch { return null; }
  const hit = cache.get(origin);
  if (hit && now - hit.at < ttlMs) return hit.tokens;
  let tokens = null;
  try {
    const response = await fetchImpl(origin + '/props', { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const body = await response.json();
      const n = Number(body?.default_generation_settings?.n_ctx ?? body?.n_ctx);
      if (Number.isSafeInteger(n) && n > 0) tokens = n;
    }
  } catch { /* unreadable: the old default stays */ }
  cache.set(origin, { at: now, tokens });
  return tokens;
}
