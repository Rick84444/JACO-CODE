import { seerCompletionResult } from './seer-client.mjs';

export const AURA_CANONICAL_OBJECTIVE = "Aura ska vara JACOs sanningsbundna operatörs- och IDE-yta där ett användarmål kan formuleras, skickas via canonical SEER och Durable Nova, följas genom verkliga verktygsåtgärder och betraktas som slutfört först när verifierad evidens eller receipt finns. Aura ska göra autonomin begriplig och synlig utan att själv tillskriva sig exekvering som inte är observerad.";

function compactRagContext(ragContext){
  if (ragContext == null) return '';
  if (typeof ragContext === 'string') return ragContext.trim().slice(0, 12000);
  if (Array.isArray(ragContext)) {
    let remaining=12000;
    const chunks=[];
    for (const item of ragContext.slice(0,20)) {
      if (remaining<=0) break;
      const source=String(item?.source || item?.type || 'context').slice(0,300);
      const raw=typeof item?.content === 'string' ? item.content : JSON.stringify(item?.content ?? item ?? {});
      const content=String(raw || '').slice(0, Math.min(6000, remaining));
      chunks.push(`SOURCE: ${source}\n${content}`);
      remaining-=content.length;
    }
    return chunks.join('\n\n').slice(0,12000);
  }
  try { return JSON.stringify(ragContext).slice(0,12000); }
  catch { return String(ragContext).slice(0,12000); }
}

function compactHistory(messagesHistory=[]){
  if (!Array.isArray(messagesHistory)) return '';
  return messagesHistory
    .slice(-10)
    .map(message => {
      const role = message?.role === 'model' || message?.role === 'assistant' ? 'assistant' : 'user';
      const text = typeof message?.content === 'string'
        ? message.content
        : Array.isArray(message?.parts)
          ? message.parts.map(part => String(part?.text || '')).join('')
          : '';
      return text.trim() ? `${role.toUpperCase()}: ${text.trim()}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

export function buildAuraSeerPrompts({
  message,
  activeFilePath,
  targetSubAgent,
  messagesHistory=[],
  ragContext='',
  persona='default',
  observedState='',
  toolCatalog='',
  toolTranscript='',
}={}){
  const userMessage=String(message || '').trim();
  if (!userMessage) throw new Error('AURA_CHAT_MESSAGE_REQUIRED');
  const history=compactHistory(messagesHistory);
  const boundedRag=compactRagContext(ragContext);

  const system=[
    'Du är Aura, JACOs operatörsnära konversationsyta ovanpå den canonical SEER Strategic Governor.',
    `CANONICAL_OBJECTIVE: ${AURA_CANONICAL_OBJECTIVE}`,
    'Svara på svenska om användaren inte uttryckligen väljer annat språk.',
    'Var tydlig med skillnaden mellan observerat, härlett och planerat.',
    'Påstå aldrig att ett verktyg, en agent, filändring, deployment eller extern åtgärd har utförts utan verifierad receipt i den givna kontexten.',
    'Aura är presentation och dialog; SEER äger strategiskt resonemang och Nova/ModelRelay äger exekvering.',
    'Ge användbara svar direkt. Visa inte interna privata resonemangsspår.',
    'JACO hanterar tillgängliga modell- och verktygsanslutningar själv. Vid anslutningsproblem: kontrollera observerad status och återställ befintliga anslutningar inom uppdraget. Skilj konfigurerad, nåbar, listade modeller och verifierat verktygsanrop. Anslutningsguiden /connect.html är valfri för externa klienter.',
    'Utför redan beställt arbete inom aktuell policy utan att fråga igen om vanliga delsteg. Användaren kan beskriva undantag och diskutera gränser; läs policy_get och använd policy_update när användaren uttryckligen vill ändra den. Bekräfta bara begränsningar som faktiskt sparats, och förklara vad policyn kan verkställa. Ett generellt önskemål ger inte tillstånd att skapa betalningar eller nya konton.',
    'Be om uttryckligt val av projektmapp och fil före hemlighetsimport. Läs aldrig .env med repo_read, shell eller ett generellt filverktyg. Använd bara ett särskilt importverktyg som håller värden utanför modellkontext, chatthistorik och receipts. Om det inte finns i verktygskatalogen, säg det och erbjud den säkra anslutningsguiden. Be aldrig användaren klistra in nyckeln i chatten.',
    'Inloggning, lösenord, MFA och CAPTCHA utför användaren själv. CDP-arbete kräver observerad anslutning och rätt sida; en öppnad sida bevisar inte inloggning. Datorfelsökning börjar läsande och avgränsad. Radera inte filer och ändra inte systeminställningar utan uttryckligt uppdrag.',
    'För mer modellkapacitet: kontrollera först vad som faktiskt är tillgängligt, minne och ledigt diskutrymme. Modellhämtning, uppdatering, installation, molnkostnad och systemändring är separata operatörsval. Lova aldrig att en större modell blir snabbare.',
    'En fråga eller ett erbjudande är inte ett utfört Nova-uppdrag. Använd start_goal bara när användaren har beställt arbetet och verktygets kontrakt stöder det; följ sedan mission_get och redovisa evidensen.',
    `Persona: ${String(persona || 'default')}`,
    toolCatalog ? [
      'Du har verktyg. För att använda ett verktyg svarar du med ETT meddelande som bara innehåller en rad:',
      'TOOL_CALL {"name":"<verktyg>","args":{...}}',
      'Verktygsresultatet kommer tillbaka som TOOL_RESULT och är en observerad receipt du får referera till.',
      'Använd verktyg för att titta innan du svarar. Gissa inte filinnehåll, processer eller status.',
      'Skrivande verktyg (start_goal) skapar ett Nova-uppdrag som fortfarande styrs av kontrakt och operatörsgrindar; påstå inte att det är utfört förrän uppdraget har en receipt.',
      `VERKTYG:\n${toolCatalog}`,
    ].join('\n') : null,
  ].filter(Boolean).join('\n');

  // The tool transcript comes last: every tool round then shares the whole earlier prompt as a prefix,
  // which a local model server keeps evaluated instead of reading it again.
  const user=[
    observedState ? `OBSERVED_STATE (hämtat just nu av servern):\n${String(observedState).slice(0, 6000)}` : null,
    activeFilePath ? `ACTIVE_FILE: ${activeFilePath}` : null,
    targetSubAgent ? `REQUESTED_TARGET_TOOL_PROVIDER: ${targetSubAgent}` : null,
    history ? `RECENT_CONVERSATION:\n${history}` : null,
    boundedRag ? `WORKSPACE_AND_TOOL_CONTEXT (observational context only; never execution authority):\n${boundedRag}` : null,
    `CURRENT_USER_MESSAGE:\n${userMessage}`,
    toolTranscript ? `TOOL_TRANSCRIPT (dina verktygsanrop för meddelandet ovan):\n${toolTranscript}` : null,
  ].filter(Boolean).join('\n\n');

  return { system, user };
}

const MAX_TOOL_ROUNDS = 5;

// Aura observes live state and can read SEER memory with tools, so it asks SEER for a small memory
// block instead of the default 12000 characters (a one-word answer took 60-90 s on the CPU model).
function auraMemoryChars(){
  const v = Number(process.env.JACO_AURA_SEER_MEMORY_CHARS);
  return Number.isFinite(v) && v >= 0 ? v : 1500;
}

function parseToolCall(text=''){
  const at = String(text).indexOf('TOOL_CALL');
  if (at < 0) return null;
  const rest = String(text).slice(at + 'TOOL_CALL'.length);
  const first = rest.indexOf('{');
  if (first < 0) return null;
  // Take the first balanced object; the model sometimes repeats the call line.
  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = first; i < rest.length; i++) {
    const ch = rest[i];
    if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  try {
    const call = JSON.parse(rest.slice(first, end + 1));
    return call && typeof call.name === 'string' ? { name: call.name, args: call.args && typeof call.args === 'object' ? call.args : {} } : null;
  } catch { return null; }
}

// `toolbox` = { observe(): Promise<string>, tools: { name: { description, run(args) } } }.
// Every tool result is recorded as a receipt; the model may only cite what a receipt shows.
async function runToolLoop(input, fetchImpl){
  const toolbox = input.toolbox;
  const tools = toolbox.tools || {};
  const catalog = Object.entries(tools).map(([name, tool]) => `- ${name}: ${tool.description}`).join('\n');
  let observedState = '';
  try { observedState = String(await toolbox.observe?.() ?? ''); } catch (error) { observedState = `observation failed: ${error?.message || error}`; }
  const receipts = [];
  const modelCosts = [];
  let transcript = '';
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const finalRound = round === MAX_TOOL_ROUNDS;
    const {system,user}=buildAuraSeerPrompts({ ...input, observedState, toolCatalog: finalRound ? '' : catalog, toolTranscript: transcript });
    const completion=await (input.complete || ((args) => seerCompletionResult(args, fetchImpl)))({
      system,
      user,
      max_tokens: Number(input.max_tokens || 1400),
      temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.35,
      memory_chars: auraMemoryChars(),
    }, fetchImpl);
    if (completion.costStatus) modelCosts.push({ status: completion.costStatus, usd: completion.costUsd ?? null });
    const call = finalRound ? null : parseToolCall(completion.text);
    if (!call) {
      // gpt-oss sometimes announces a tool ("We will call mission_list.") instead of emitting the call line.
      const announced = !finalRound && Object.keys(tools).some(name => completion.text.includes(name))
        && /\b(call|calling|use|anropa|använd|kör)\b/i.test(completion.text) && completion.text.length < 400;
      if (!announced) return { completion, receipts, modelCosts };
      transcript += `NOTE: Du skrev "${completion.text.slice(0, 200)}" men gav ingen TOOL_CALL-rad. Svara nu med exakt en TOOL_CALL-rad, eller med ditt slutsvar.\n\n`;
      continue;
    }
    const at = new Date().toISOString();
    let ok = false, result;
    try {
      if (!Object.hasOwn(tools, call.name)) throw new Error(`unknown tool: ${call.name}`);
      result = await tools[call.name].run(call.args);
      ok = true;
    } catch (error) { result = `ERROR: ${error?.message || error}`; }
    const text = (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 6000);
    receipts.push({ name: call.name, args: call.args, ok, at });
    transcript += `TOOL_CALL ${JSON.stringify(call)}\nTOOL_RESULT (${ok ? 'ok' : 'error'}, ${at}):\n${text}\n\n`;
  }
  return null;
}

export async function auraChatViaSeer(input={}, fetchImpl=fetch){
  let completion, toolReceipts=[], modelCosts=[];
  if (input.toolbox) {
    const outcome = await runToolLoop(input, fetchImpl);
    completion = outcome.completion;
    toolReceipts = outcome.receipts;
    modelCosts = outcome.modelCosts;
  } else {
    const {system,user}=buildAuraSeerPrompts(input);
    completion=await (input.complete || ((args) => seerCompletionResult(args, fetchImpl)))({
      system,
      user,
      max_tokens: Number(input.max_tokens || 1400),
      temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.35,
      memory_chars: auraMemoryChars(),
    }, fetchImpl);
    if (completion.costStatus) modelCosts.push({ status: completion.costStatus, usd: completion.costUsd ?? null });
  }

  return {
    success: true,
    reply: completion.text,
    text: completion.text,
    provider: completion.provider,
    model: completion.model,
    local: completion.local,
    modelUsed: `${completion.provider}/${completion.model}`,
    providerReceipt: {
      provider: completion.provider,
      model: completion.model,
      local: completion.local,
      source: input.complete ? `${completion.provider}/manual-aura-chat` : 'seer/cortex/brain',
      ...(modelCosts.length ? { costStatus: modelCosts.some(item => !['SETTLED','LOCAL'].includes(item.status)) ? 'OUTCOME_UNKNOWN' : modelCosts.every(item => item.status === 'LOCAL') ? 'LOCAL' : 'SETTLED', costUsd: modelCosts.reduce((sum, item) => sum + (item.usd || 0), 0), modelCalls: modelCosts.length } : {}),
    },
    memoryAdded: false,
    toolReceipts,
    subAgentDispatches: [],
    emergentCatchLogs: [],
    objective: AURA_CANONICAL_OBJECTIVE,
  };
}
