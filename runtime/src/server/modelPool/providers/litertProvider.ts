export interface LiteRtGenerateResult {
  text: string;
  latencyMs: number;
  // An OpenAI-compatible LiteRT-LM server does not report which accelerator ran the model.
  ranOnNpu: false;
}

// LiteRT-LM is optional. Callers try it on every generation, so an absent server must not be contacted
// (and logged) on each attempt: it is only used when JACO_LITERT_URL is set, and after a failure it is
// skipped for a cooldown period.
const FAILURE_COOLDOWN_MS = Number(process.env.JACO_LITERT_RETRY_MS || 5 * 60_000);
let unavailableUntil = 0;

export function liteRtStatus(): { configured: boolean; coolingDownUntil: string | null } {
  return {
    configured: Boolean(process.env.JACO_LITERT_URL),
    coolingDownUntil: unavailableUntil > Date.now() ? new Date(unavailableUntil).toISOString() : null,
  };
}

function markUnavailable(reason: string): null {
  const firstFailure = unavailableUntil <= Date.now();
  unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
  if (firstFailure) console.warn(`[LiteRT Provider] ${reason}; not retrying for ${Math.round(FAILURE_COOLDOWN_MS / 1000)} s`);
  return null;
}

export async function generateOnDevice(prompt: string, systemPrompt?: string): Promise<LiteRtGenerateResult | null> {
  const baseUrl = process.env.JACO_LITERT_URL;
  if (!baseUrl) return null;
  if (unavailableUntil > Date.now()) return null;

  const started = Date.now();
  const model = process.env.JACO_LITERT_MODEL || 'gemma-4-E4B-it-gpu.litertlm';
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(Number(process.env.JACO_LITERT_TIMEOUT_MS || 120_000)),
    });
    if (!response.ok) return markUnavailable(`endpoint returned ${response.status} ${response.statusText}`);

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return markUnavailable('response contained no completion text');

    unavailableUntil = 0;
    return { text, latencyMs: Date.now() - started, ranOnNpu: false };
  } catch (error: any) {
    return markUnavailable(`network or parsing error: ${error?.message || error}`);
  }
}
