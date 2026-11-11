// The chat with Aura is a conversation, not a log. Raw runtime data (error codes, mission ids, dispatcher notes,
// model routing) never reaches it: a known code becomes one plain sentence that says what happened and what the
// operator can do, internal bookkeeping goes to Background activity, and the exact text stays under Evidence
// (operator 2026-11-08: "the Aura chat should only be in a human way; the raw data should not be there").
import type { CognitiveEvent } from '../hooks/useCognitiveLive';

type Words = [sv: string, en: string];

// What a code means for the operator, in Aura's voice. The first match wins, so the specific come first.
const CODES: Array<[RegExp, Words]> = [
  [/MONTHLY_BUDGET_LIMIT/, ['Jag har nått månadens budgetgräns och kan inte använda molnmodellen just nu. Klicka på dollartecknet uppe till höger och höj gränsen, eller be mig i chatten, så fortsätter jag.', 'I have reached this month\'s budget limit and cannot use the cloud model right now. Click the dollar sign at the top right and raise the limit, or ask me in the chat, and I will continue.']],
  [/DAILY_BUDGET_LIMIT/, ['Jag har nått dagens budgetgräns. Höj den under dollartecknet uppe till höger, eller be mig i chatten, så fortsätter jag.', 'I have reached today\'s budget limit. Raise it under the dollar sign at the top right, or ask me in the chat, and I will continue.']],
  [/PAID_PROVIDER_DISABLED|CLOUD_DISABLED|AURA_CLOUD_DENIED/, ['Molnmodeller är avstängda, så jag kan bara använda en modell på den här datorn. Slå på dem under dollartecknet om du vill att jag fortsätter med molnet.', 'Cloud models are switched off, so I can only use a model on this computer. Turn them on under the dollar sign if you want me to continue with the cloud.']],
  [/KEY_MISSING|CREDENTIAL_MISSING|SECRET_NOT_CONFIGURED|HTTP_401|HTTP_403/, ['Jag kommer inte in hos modellen: nyckeln saknas eller fungerar inte. Koppla den under Anslutningar, så fortsätter jag.', 'I cannot get into the model: the key is missing or does not work. Connect it under Connections and I will continue.']],
  [/HTTP_429|RATE_LIMIT|QUOTA/, ['Modellen säger att vi har frågat för mycket just nu. Jag väntar en stund och försöker igen.', 'The model says we have asked too much right now. I will wait a moment and try again.']],
  [/ECONNREFUSED|ECONNRESET/, ['Jag kom inte fram till en tjänst på datorn. Jag kontrollerar att den är igång och försöker igen.', 'I could not reach a service on the computer. I will check that it is running and try again.']],
  [/ETIMEDOUT|TIMEOUT|TIMED_OUT/, ['Ett steg tog för lång tid och avbröts. Jag provar ett annat sätt i stället för att upprepa det.', 'A step took too long and was stopped. I will try another way instead of repeating it.']],
  [/spawnSync|EPERM|EACCES|EBUSY/, ['Ett kommando kunde inte köras på datorn. Jag kontrollerar varför och provar ett annat sätt.', 'A command could not run on the computer. I will check why and try another way.']],
  [/MODEL_UNAVAILABLE|NO_PROVIDER|PROVIDER_EMPTY|ALL_PROVIDERS/, ['Ingen modell kunde svara just nu. Kontrollera anslutningen under Anslutningar, så försöker jag igen.', 'No model could answer right now. Check the connection under Connections and I will try again.']],
  [/ENOENT|NOT_FOUND/, ['Något jag letade efter fanns inte där jag trodde. Jag tittar efter på ett annat ställe.', 'Something I looked for was not where I expected. I will look somewhere else.']],
];
const GENERIC: Words = ['Det här steget gick inte att slutföra. Detaljerna finns under Bevis; något verifierat resultat finns ännu inte.', 'This step could not be completed. The details are under Evidence; there is no verified result yet.'];

// A machine code: SHOUTING_SNAKE with an underscore, often joined by colons (PLANNER_BLOCKED:...:MONTHLY_BUDGET_LIMIT).
// System error names (ETIMEDOUT, ENOENT) and spawnSync count too: they mean nothing to the operator.
const CODE = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|\bE(?:TIMEDOUT|NOENT|PERM|ACCES|BUSY|CONNREFUSED|CONNRESET|ADDRINUSE)\b|\bspawnSync\b/;
// Lines that are the runtime talking to itself, not to the operator.
const INTERNAL = [
  /^mission:[\w-]+\s*->/i, /\bauto-resumed\b/i, /dispatcher started/i, /^JACO model:/i, /^Durable Mission Bus/i,
  /^(lease|heartbeat|worker|ticket)\b/i, /\bseq(uence)?\s*\d+/i,
  /^Tool servers started/i, /^No model answered/i, /^Aura GUI completed through/i, /^Lite provider failover/i,
];

export function humanCodeText(text: string, language: string): string | null {
  if (!CODE.test(text)) return null;
  const words = CODES.find(([pattern]) => pattern.test(text))?.[1] || GENERIC;
  return language === 'sv' ? words[0] : words[1];
}

// The operator's own words of a mission, without the internal repair context the runtime appends to it.
export function operatorWords(text: string): string {
  return text.split(/\n\s*\n\s*(?:AUTONOMOUS REPAIR CONTEXT|INTERNAL CONTEXT|SYSTEM CONTEXT)\b/i)[0].trim();
}

export function isInternalEvent(event: CognitiveEvent): boolean {
  if (event.category !== 'observation') return false;
  const text = String(event.text || '').trim();
  return INTERNAL.some(pattern => pattern.test(text)) || (CODE.test(text) && text.length < 200 && !/\s[a-zåäö]{3,}\s[a-zåäö]{3,}\s/i.test(text.replace(CODE, '')));
}

// The event as the chat shows it: plain words in the chosen language. The original stays in evidence.error so the
// Evidence view can still show exactly what the runtime reported.
export function humanizeEvent(event: CognitiveEvent, language: string): CognitiveEvent {
  const text = String(event.text || '');
  const goal = event.category === 'goal' ? operatorWords(text) : text;
  // A failed command's own output (test lines, timings, stack traces) is evidence, not conversation.
  const dumped = /^(.*?(?:The command failed|Kommandot misslyckades))\s*:\s*\S/s.exec(goal);
  if (dumped && !humanCodeText(goal, language)) {
    return { ...event, text: `${dumped[1]}. ${language === 'sv' ? 'Utdata finns under Bevis, och jag tittar på vad som gick fel.' : 'The output is under Evidence, and I am looking at what went wrong.'}`,
      evidence: { ...event.evidence, error: event.evidence?.error || text } };
  }
  // Narration may legitimately name a configuration field or a file. That does
  // not turn the whole human explanation into an error code. Keep intention and
  // observed learning; error outcomes still use the plain-language diagnostics.
  const narrated = ['action','plan'].includes(event.category) &&
    !['failed','unknown'].includes(event.evidence?.outcome) &&
    /\b(?:Jag|jag|I|We|Nu|För att|Next|First)\b/.test(goal);
  const human = narrated ? null : humanCodeText(goal, language);
  if (!human && goal === text) return event;
  return {
    ...event,
    text: human || goal,
    evidence: { ...event.evidence, error: event.evidence?.error || (human ? text : event.evidence?.error ?? null) },
  };
}

// Split the live events into what the conversation shows and what goes to Background activity.
export function humanChatEvents(events: CognitiveEvent[], language: string): { conversation: CognitiveEvent[]; background: CognitiveEvent[] } {
  const conversation: CognitiveEvent[] = [];
  const background: CognitiveEvent[] = [];
  for (const event of events) {
    const runtimeOnly = (!event.missionId && event.category === 'observation' && event.evidence?.outcome === 'observed') || isInternalEvent(event);
    if (runtimeOnly) background.push(event);
    else conversation.push(humanizeEvent(event, language));
  }
  return { conversation, background };
}
