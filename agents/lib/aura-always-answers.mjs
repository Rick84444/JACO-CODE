// Operator 2026-10-09: "most important in the whole IDE is that you can always get an answer and help". Aura's chat always ends
// in an answer: the provider the operator chose, then SEER's own route (all its providers), and when no
// model can answer at all, Aura's own status answer built from what it observes. That last answer says
// plainly that no model wrote it (provider 'aura', model 'status').

const clean = error => String(error?.message || error).replace(/\s+/g, ' ').slice(0, 200);
const answered = r => r && typeof r.reply === 'string' && r.reply.trim();

// ask(choice): one Aura turn with that provider choice (null = SEER's route); throws when it cannot answer.
// status(failures): Aura's status answer. onFallback/onNoModel: workstream records.
export function auraChatDeadlines(env = process.env) {
  const ms = (key, fallback) => { const v = Number(env[key]); return Number.isFinite(v) && v >= 1000 ? v : fallback; };
  return { chosenMs: ms('JACO_AURA_CHAT_CHOSEN_MS', 120_000), defaultMs: ms('JACO_AURA_CHAT_DEFAULT_MS', 90_000), fallbackMs: ms('JACO_AURA_CHAT_FALLBACK_MS', 45_000) };
}

// A model that does not answer in time must not leave the operator without a reply. The late result is dropped:
// its cost and receipts are still settled by the call itself.
export function answerWithin(work, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`AURA_MODEL_TIMEOUT after ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * @param {{
 *   choice: { providerId: string, model?: string } | null,
 *   ask: (choice: any) => Promise<any>,
 *   status: (failures: string[]) => Promise<any> | any,
 *   onFallback?: (fallback: { from: string, reason: string }, result: any) => void,
 *   onNoModel?: (failures: string[]) => void,
 * }} options
 */
export async function auraAlwaysAnswers({ choice, ask, status, onFallback = () => {}, onNoModel = () => {} }) {
  const failures = [];
  let fallback = null;
  if (choice) {
    try {
      const r = await ask(choice);
      if (answered(r)) return r;
      throw new Error('AURA_EMPTY_REPLY');
    } catch (error) {
      fallback = { from: `${choice.providerId}/${choice.model || 'default'}`, reason: clean(error) };
      failures.push(`${fallback.from}: ${fallback.reason}`);
    }
  }
  try {
    const r = await ask(null);
    if (!answered(r)) throw new Error('AURA_EMPTY_REPLY');
    if (!fallback) return r;
    onFallback(fallback, r);
    return { ...r, fallback };
  } catch (error) {
    failures.push(`SEER: ${clean(error)}`);
    const r = await status(failures);
    onNoModel(failures);
    return r;
  }
}

// What the operator can do about each failure, from the failure text itself.
export function auraStatusHints(failures, { headroomUsd = null, localModels = [], lite = false } = {}) {
  const all = failures.join(' | ');
  const hints = [];
  if (/CLOUD_DISABLED_BY_POLICY/.test(all)) hints.push('Cloud models are turned off for the chat. Switch on "Allow cloud models" under Budget & spending (the dollar icon on the left) and I will answer within your budget.');
  if (/AURA_MODEL_TIMEOUT/.test(all)) hints.push('The model did not answer in time. A local model on a computer with little free memory can be too slow: choose a cloud model in Chat settings.');
  if (/402|Insufficient Balance/i.test(all)) hints.push('The DeepSeek account is empty. Top up at platform.deepseek.com, or choose another model in Chat settings.');
  if (/429|usage limit/i.test(all)) hints.push('The free quota at a cloud provider is used up (Ollama Cloud or Groq). The provider refills it after a while.');
  if (/AURA_CHAT_PROMPT_TOO_LARGE|AURA_CHAT_MESSAGE_TOO_LARGE_FOR_CONTEXT/i.test(all)) hints.push('The context exceeds the safe limit of the chosen model. Shorten the history, or choose a model with a larger context window under Providers.');
  if (/BUDGET_LIMIT|TASK_COST_LIMIT/i.test(all)) hints.push(`JACO's cloud budget for today is used up.${headroomUsd === null ? '' : ` Headroom today: ${Number(headroomUsd).toFixed(2)} USD.`} It resets at midnight UTC, or you can raise it under Chat settings.`);
  if (lite) { if (/LITE_NO_AVAILABLE_MODELS|NO_CHAT_MODELS_IMPORTED|UNREACHABLE|fetch failed|ECONNREFUSED|timeout/i.test(all)) hints.push('No local AI model is answering. Check http://127.0.0.1:9379/v1/models. If LiteRT is installed: run litert-lm serve --host 127.0.0.1 --port 9379 in another Termux session. A model must also be imported. Alternatively connect a provider under Providers.'); }
  else if (/fetch failed|ECONNREFUSED|SEER_BRAIN_HTTP_(0|5\d\d)|aborted|timeout/i.test(all)) hints.push('SEER is not answering or timed out. Restart the services with: node agents/lib/local-stack.mjs');
  if (localModels.length) hints.push(lite ? `Local Ollama model detected (${localModels.slice(0, 3).join(', ')}). JACO tries to use it in Lite mode.` : `A local model is available on this computer (${localModels.slice(0, 3).join(', ')}). Choose Ollama under Chat settings to get answers without the cloud, slower but free.`);
  if (!hints.length) hints.push('Try again in a moment. The failure causes below show what happened.');
  return hints;
}

export function auraStatusReply(failures, observed = {}) {
  const reply = [
    "No AI model could answer right now, so this is Aura's own status answer, not a model answer. Your question is saved in the chat and you can send it again.",
    '',
    '**What you can do**',
    ...auraStatusHints(failures, observed).map(h => `- ${h}`),
    '',
    '**What failed**',
    ...failures.map(f => `- ${f}`),
  ].join('\n');
  return { success: true, degraded: true, reply, text: reply, provider: 'aura', model: 'status', local: true, modelUsed: 'aura/status (no model)', toolReceipts: [] };
}
