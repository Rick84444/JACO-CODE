// A shared presentation contract. Observations never become proof of completion.
// Only whitelisted fields enter the conversation; raw tool payloads stay in runtime.
export function safeCognitiveText(value, max = 600, secrets = []) {
  if (typeof value !== 'string') return '';
  let safe = value;
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 6) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/\b(?:wps_|ghp_|github_pat_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]')
    .slice(0, max);
}

export function cognitiveLink(value) {
  if (typeof value !== 'string' || /\[REDACTED\]/.test(safeCognitiveText(value, 4000))) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

const noise = /heartbeat|governor\.skipped|development_cycle|cycle\.started|worker\.(registered|heartbeat)|tick/i;
const labels = {
  'repo-read': 'Läser en fil', 'repo-write': 'Skapar en fil', 'repo-edit': 'Ändrar koden', 'repo-list': 'Undersöker projektets filer', 'repo-test': 'Kör tester', 'web-fetch': 'Läser ett webbsvar',
  'read-file': 'Läser en fil', 'write-file': 'Skapar eller ändrar en fil',
  'apply-patch': 'Ändrar koden', 'list-files': 'Undersöker projektets filer',
  'repo-scan': 'Kartlägger projektet', 'git-status': 'Kontrollerar ändringar',
  'git-diff': 'Granskar kodskillnader', 'git-commit': 'Sparar ändringar i Git',
  'git-push': 'Skickar ändringar till Git', 'run-tests': 'Kör tester',
  'verify-api': 'Kontrollerar API-svar', shell: 'Kör ett kommando i arbetsytan',
  'http-get': 'Läser ett webbsvar', 'web-search': 'Söker efter information',
  'browser-open': 'Öppnar en sida', 'browser-survey-site': 'Undersöker en sida',
  'browser-click': 'Använder gränssnittet', 'browser-type': 'Fyller i ett fält',
  'invoke-worker': 'Delegerar en deluppgift', 'health-check': 'Kontrollerar anslutningen',
  screenshot: 'Läser en skärmbild', 'desktop-observe': 'Undersöker skrivbordet',
};
const categories = {
  MISSION_CREATED: ['goal', 'Uppdrag mottaget'],
  NOVA_ACTION_STARTED: ['action', 'Arbete pågår'],
  NOVA_ACTION_RESULT: ['result', 'Resultat'],
  NOVA_PLANNING_RESULT: ['plan', 'Nästa steg'],
  NOVA_REPLAN_REQUEST: ['decision', 'Planen behöver ändras'],
  NOVA_CANCEL_REQUEST: ['decision', 'Avslut begärt'],
  NOVA_SPEND_BLOCKED: ['blocked', 'Betalning väntar på dig'],
  NOVA_CLAIM_CHECK: ['verification', 'Kontroll av påståenden'],
  'autonomy.replanned': ['decision', 'Planen har ändrats'],
  'runtime.degraded': ['blocked', 'Arbetet har ett hinder'],
  'runtime.recovered': ['recovered', 'Anslutningen har återställts'],
  'mission_graph.node.reconcile_terminal': ['verification', 'Kontroll av delmål'],
  'mission_graph.binding_quarantined': ['blocked', 'Uppdragets tillstånd är okänt'],
  'governor.graph_created': ['goal', 'Ett nytt uppdrag har registrerats'],
};

export function toCognitiveEvent(raw, { durable = false, missionGoal = null, secrets = [] } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const clean=(value,max=600)=>safeCognitiveText(value,max,secrets);
  const type = String(raw.type || '');
  if (!type || noise.test(type)) return null;
  const payload = raw.payload || raw.receipt || {};
  const action = payload.action || payload.receipt || payload;
  const result = action.result || payload.result || {};
  const at = raw.at || raw.ts;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;
  const defined = categories[type];
  const category = defined?.[0] || (/failed|blocked|error/i.test(type) ? 'blocked' : /verified|verification/i.test(type) ? 'verification' : /result|executed/i.test(type) ? 'result' : /plan/i.test(type) ? 'plan' : 'observation');
  const title = defined?.[1] || ({blocked:'Arbetet har ett hinder',verification:'Kontroll',result:'Resultat',plan:'Planering',observation:'Ny observation'})[category];
  const isResult = category === 'result' || category === 'verification';
  const unknown = action.outcomeUnknown === true || payload.outcomeUnknown === true || result.outcomeUnknown === true;
  const failed = action.ok === false || payload.ok === false || result.ok === false || Boolean(action.error || payload.error || result.error) || (Number.isFinite(result.exitCode) && result.exitCode !== 0) || /failed|error/i.test(type);
  const verified = isResult && !unknown && !failed && (action.ok === true || payload.ok === true) && (action.verified === true || payload.verified === true);
  const outcome = unknown ? 'unknown' : failed ? 'failed' : verified ? 'verified' : isResult ? 'unverified' : 'observed';
  const evidence = {
    outcome, path: clean(result.path || result.file || action.data?.path || payload.path, 400) || null,
    url: cognitiveLink(result.url), commit: clean(result.commit || result.commitHash || result.sha, 100) || null,
    exitCode: Number.isFinite(result.exitCode) ? result.exitCode : null,
    error: clean(action.error || payload.error || result.error, 1000) || null,
  };
  let text = clean(raw.message);
  if (type === 'NOVA_ACTION_STARTED') text = (labels[action.type] || 'Utför ett verktygssteg') + (evidence.path ? ': ' + evidence.path : '.');
  if (type === 'NOVA_ACTION_RESULT') {
    const verb = labels[action.type || payload.type] || 'Verktygssteget';
    text = outcome === 'verified' ? verb + ': resultatet är verifierat.'
      : outcome === 'failed' ? verb + ': steget misslyckades.' + (evidence.error ? ' ' + evidence.error : '')
      : outcome === 'unknown' ? verb + ': utfallet är okänt. Kontroll behövs innan steget upprepas.'
      : verb + ': utfört, men verifiering saknas.';
  }
  if (type === 'MISSION_CREATED') text = clean(payload.goal || missionGoal) || 'Uppdraget är registrerat och väntar på planering.';
  if (type === 'NOVA_PLANNING_RESULT') text = clean(payload.error || payload.reason) || (payload.completionProposed ? 'Ett slutresultat har föreslagits. Det behöver kontrolleras mot beläggen.' : 'Nästa steg har registrerats i uppdraget.');
  if (type === 'NOVA_REPLAN_REQUEST') text = clean(payload.reason) || 'Runtime har begärt en ny plan för uppdraget.';
  if (type === 'NOVA_CANCEL_REQUEST') text = 'Runtime har mottagit begäran. Ett pågående verktygssteg kan behöva avslutas innan uppdraget stoppas.';
  if (!text) text = clean(payload.reason || payload.summary);
  if (!text) return null;
  const seq = Number.isSafeInteger(raw.seq) && raw.seq > 0 ? raw.seq : null;
  const rawId = typeof raw.id === 'string' ? raw.id : null;
  if (!seq && !rawId) return null;
  const event = {
    id: durable && seq ? 'mission:' + seq : 'live:' + rawId,
    at, type, category, title, text, durable,
    seq: durable ? seq : null,
    missionId: clean(raw.missionId || payload.missionId, 200) || null,
    missionGoal: clean(missionGoal || raw.missionGoal, 300) || null,
    actionId: clean(action.id || action.actionId || payload.actionId, 200) || null,
    evidence,
  };
  // Configuration secrets may not follow a token prefix. Apply them to every displayed field.
  for (const key of ['text','missionGoal','missionId','actionId']) if (event[key]) event[key] = clean(event[key], 1000);
  event.text = event.text.replace(/\b(SEER|Nova|Aura)\b/g, 'JACO');
  for (const key of ['path','commit','error']) if (event.evidence[key]) event.evidence[key] = clean(event.evidence[key],1000);
  if (event.evidence.url && secrets.some(secret=>typeof secret==='string' && secret.length>=6 && event.evidence.url.includes(secret))) event.evidence.url=null;
  return event;
}

export function mergeCognitiveEvents(previous, incoming, limit = 400) {
  const events = new Map(previous.map(event => [event.id, event]));
  for (const event of incoming) if (event?.id && typeof event.at === 'string') events.set(event.id, event);
  // Snapshot receipts may repeat bus events. Scope action IDs by mission and event type.
  const actions = new Map();
  for (const event of events.values()) {
      const key = event.actionId ? [event.missionId, event.type, event.actionId].join(':') : event.id;
      const existing = actions.get(key);
      if (!existing || (!existing.durable && event.durable)) actions.set(key,event);
  }
  return [...actions.values()].sort((a,b) => Date.parse(a.at) - Date.parse(b.at) || (a.seq && b.seq ? a.seq-b.seq : String(a.id).localeCompare(String(b.id)))).slice(-limit);
}

// The activation report owns readiness; a live event stream only proves connectivity.
export function activationReadiness({ report, loading = false, error = '' } = {}) {
  if (error) return { label:'Status kunde inte hämtas', tone:'waiting', action:'retry', detail:'Kontrollera anslutningen och försök igen.' };
  if (loading || !report) return { label:'Kontrollerar vad som är redo', tone:'waiting', action:'wait', detail:'Kontrollerar modell, verktyg och agentkörning.' };
  if (!report.runtime?.up) return { label:'JACO behöver startas', tone:'waiting', action:'retry', detail:'Starta JACO på datorn och kontrollera anslutningen igen.' };
  if (!report.providers?.some(provider => provider.active)) return { label:'Anslut en modell för att börja', tone:'waiting', action:'connect', detail:'Välj en lokal modell eller anslut en modelltjänst.' };
  if (report.planner?.reachable !== true) return { label:'Välj en modell som svarar', tone:'waiting', action:'connect', detail:'Den valda planeringsmodellen har inte kunnat verifieras.' };
  if (!report.tools?.toolCount) return { label:'Verktygen behöver startas', tone:'waiting', action:'activate', detail:'Starta de anslutna verktygen så att JACO kan arbeta i projektet.' };
  if (!report.ok) return { label:'Agentkörningen behöver kontrolleras', tone:'waiting', action:'details', detail:'Modellen svarar, men alla förutsättningar för körning är inte uppfyllda.' };
  return { label:'Redo för ditt uppdrag', tone:'idle', action:'goal', detail:'Beskriv vad du vill få gjort. Du följer arbetet här.' };
}

export function liveWorkspaceStatus({ connection, busy, missions = [], runtimeRunning, error, activation, approvalCount = 0 }) {
  if (error || connection === 'reconnecting' || connection === 'unavailable') return { label:'Anslutningen behöver återställas', tone:'waiting' };
  if (connection === 'connecting' && runtimeRunning == null) return { label:'Ansluter till arbetsytan', tone:'waiting' };
  if (approvalCount > 0) return { label:'Ett beslut behöver dig', tone:'waiting' };
  if (busy) return { label:busy === 'goal' ? 'Registrerar uppdrag' : busy === 'tool' ? 'Anropar verktyg' : 'Väntar på modellens svar', tone:'active' };
  const mission = missions.find(m => m.status === 'ACTIVE');
  if (mission) return { label:({PLANNING:'Planerar nästa steg',EXECUTING:'Arbetar',VERIFYING:'Kontrollerar resultat',READY:'Väntar på nästa steg'})[mission.phase] || 'Uppdrag pågår', tone:'active' };
  if (missions.some(m => m.status === 'BLOCKED')) return { label:'Ett uppdrag har ett hinder', tone:'waiting' };
  if (missions.some(m => m.status === 'AWAITING_VERIFICATION')) return { label:'Resultat väntar på kontroll', tone:'waiting' };
  if (runtimeRunning === false) return { label:'Runtime är pausad', tone:'waiting' };
  return activationReadiness(activation);
}
