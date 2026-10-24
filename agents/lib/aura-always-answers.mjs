// Operator 2026-10-09: "viktigast i hela ide att man alltid kan få svar och hjälp". Aura's chat always ends
// in an answer: the provider the operator chose, then SEER's own route (all its providers), and when no
// model can answer at all, Aura's own status answer built from what it observes. That last answer says
// plainly that no model wrote it (provider 'aura', model 'status').

const clean = error => String(error?.message || error).replace(/\s+/g, ' ').slice(0, 200);
const answered = r => r && typeof r.reply === 'string' && r.reply.trim();

// ask(choice): one Aura turn with that provider choice (null = SEER's route); throws when it cannot answer.
// status(failures): Aura's status answer. onFallback/onNoModel: workstream records.
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
  if (/402|Insufficient Balance/i.test(all)) hints.push('DeepSeek-kontot är tomt. Fyll på på platform.deepseek.com, eller välj en annan modell i Chattinställningar.');
  if (/429|usage limit/i.test(all)) hints.push('Gratiskvoten hos en molnleverantör är slut (Ollama Cloud eller Groq). Den fylls på av leverantören efter en tid.');
  if (/BUDGET_LIMIT|TASK_COST_LIMIT/i.test(all)) hints.push(`JACO:s molnbudget för i dag är slut.${headroomUsd === null ? '' : ` Kvar i dag: ${Number(headroomUsd).toFixed(2)} USD.`} Den nollställs vid midnatt UTC (02:00 svensk tid), eller så kan du höja den under Chattinställningar.`);
  if (lite) { if (/LITE_NO_AVAILABLE_MODELS|NO_CHAT_MODELS_IMPORTED|UNREACHABLE|fetch failed|ECONNREFUSED|timeout/i.test(all)) hints.push('Ingen lokal AI-modell svarar. Kontrollera http://127.0.0.1:9379/v1/models. Om LiteRT är installerat: kör litert-lm serve --host 127.0.0.1 --port 9379 i en annan Termux-session. En modell måste också vara importerad. Alternativt anslut en provider under Providers.'); }
  else if (/fetch failed|ECONNREFUSED|SEER_BRAIN_HTTP_(0|5\d\d)|aborted|timeout/i.test(all)) hints.push('SEER svarar inte eller hann inte. Starta om tjänsterna med: node agents/lib/local-stack.mjs');
  if (localModels.length) hints.push(lite ? `Lokal Ollama-modell upptäcktes (${localModels.slice(0, 3).join(', ')}). JACO försöker använda den i Lite-läge.` : `Lokal modell finns på datorn (${localModels.slice(0, 3).join(', ')}). Välj Ollama under Chattinställningar för att få svar utan moln, långsammare men gratis.`);
  if (!hints.length) hints.push('Försök igen om en stund. Tekniska felorsaker finns under Svar & källor.');
  return hints;
}

export function auraStatusReply(failures, observed = {}) {
  const reply = [
    'Ingen AI-modell kunde svara just nu, så det här är Auras eget statussvar, inte ett modellsvar. Din fråga är sparad i chatten och du kan skicka den igen.',
    '',
    '**Vad du kan göra**',
    ...auraStatusHints(failures, observed).map(h => `- ${h}`),
  ].join('\n');
  return { success: true, degraded: true, reply, text: reply, provider: 'aura', model: 'status', local: true, modelUsed: 'aura/status (ingen modell)', failureReasons: failures, toolReceipts: [] };
}
