#!/usr/bin/env node
/**
 * Autonomt arbetsutbyte mellan två JACO-noder (option 1: inget riktigt
 * pengaflöde). Loopen kör kontinuerligt, egen-initierad, utan att en
 * människa trycker "skicka" varje gång:
 *
 *   var X sekunder:
 *     -> discover peer (riktig HTTP, cache:as inte bort - upptäcks varje
 *        cykel så ändringar i motpartens agent-card syns)
 *     -> skicka en roterande verklig A2A-uppgift (task / forecast) med en
 *        ärlig demandSignal (offeredRevenueUsd: 0, verified: false - det
 *        här är INTE riktiga pengar och ska aldrig påstås vara det)
 *     -> verifiera oberoende hos MOTTAGARENS EGEN continuum-kärna att
 *        tasken verkligen landade och (om möjligt) slutfördes
 *     -> logga sant utfall (COMPLETED/FAILED/TIMEOUT), aldrig fabricerat
 *
 * Env:
 *   SELF_NAME             - loggnamn för den här noden, t.ex. "peerA"
 *   SELF_CONTINUUM_URL    - egen Continuum-kärnas URL (t.ex. :3020)
 *   PEER_A2A_URL          - motpartens A2A-adapter (t.ex. :2999)
 *   PEER_CONTINUUM_URL    - motpartens Continuum-kärna, för oberoende
 *                           verifiering av att tasken faktiskt exekverades
 *   TRADE_INTERVAL_MS     - paus mellan cykler (default 20000)
 */

// Positionellt argv[2] tillåts som namn-override (syns i processlistan,
// vilket gör att jaco-ctl kan skilja på flera trader-instanser via
// kommandoradsmatchning).
const SELF_NAME = process.argv[2] || process.env.SELF_NAME || 'node';
const SELF_CONTINUUM_URL = (process.env.SELF_CONTINUUM_URL || 'http://127.0.0.1:3020').replace(/\/+$/, '');
const PEER_A2A_URL = (process.env.PEER_A2A_URL || 'http://127.0.0.1:2999').replace(/\/+$/, '');
const PEER_CONTINUUM_URL = (process.env.PEER_CONTINUUM_URL || 'http://127.0.0.1:3021').replace(/\/+$/, '');
const INTERVAL_MS = Number(process.env.TRADE_INTERVAL_MS || 90000);
const OUTCOME_TIMEOUT_MS = Number(process.env.TRADE_OUTCOME_TIMEOUT_MS || 120000);

let cycle = 0;

function log(tag, msg) {
  const t = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`[${t}] [${SELF_NAME}] [${tag}] ${msg}`);
}

async function call(base, pathname, method, body) {
  const res = await fetch(`${base}${pathname}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${pathname} -> ${res.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 300)}`);
  return json;
}

/** Roterande, meningsfulla, ärliga arbetsförfrågningar - ingen påstår pengar rör sig. */
function nextWorkRequest(n) {
  const kind = n % 3;
  if (kind === 0) {
    return {
      skillId: 'jaco_continuum_task',
      text: 'Ge en kort statusanalys: hur många agenter i din RuntimeHub är LIVE just nu, och finns det några tasks som verkar fastnade?',
      need: 'runtime-status-analysis',
    };
  }
  if (kind === 1) {
    return {
      skillId: 'jaco_continuum_task',
      text: 'Föreslå en konkret, testbar förbättring för review-kedjan givet att små lokala modeller ibland returnerar trunkerad/felaktig JSON i sina findings.',
      need: 'review-quality-suggestion',
    };
  }
  return {
    skillId: 'jaco_forecast_request',
    text: 'Probabilistisk prognos begärd.',
    need: 'short-horizon-forecast',
    forecastSpec: {
      question: 'Kommer den här A2A-uppgiften att slutföras (COMPLETED) inom 90 sekunder efter mottagande?',
      outcomes: ['YES', 'NO'],
      resolutionAt: new Date(Date.now() + 90_000).toISOString(),
    },
  };
}

async function waitForOutcome(hubTaskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { task } = await call(PEER_CONTINUUM_URL, `/api/continuum/hub/tasks/${encodeURIComponent(hubTaskId)}`, 'GET');
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) return task;
    } catch { /* motpartens task kanske inte hunnit synas än */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null; // sann TIMEOUT, inte fabricerad completion
}

async function tradeCycle() {
  cycle++;
  log('DISCOVER', `Upptäcker motpart ${PEER_A2A_URL}...`);
  const discovered = await call(SELF_CONTINUUM_URL, '/api/continuum/a2a/discover', 'POST', { baseUrl: PEER_A2A_URL, bearerEnv: 'A2A_BEARER_TOKEN' });
  const card = discovered.result.card;
  const peerId = discovered.result.peer?.id || null;
  log('DISCOVER', `OK: ${card.name} (peer=${peerId}, successes=${discovered.result.peer?.successes ?? 0}, failures=${discovered.result.peer?.failures ?? 0})`);

  const work = nextWorkRequest(cycle);
  const messageId = `trade-${SELF_NAME}-${cycle}-${Date.now()}`;
  log('SEND', `[${work.skillId}] ${work.text.slice(0, 90)}...`);

  const sent = await call(SELF_CONTINUUM_URL, '/api/continuum/a2a/send', 'POST', {
    card,
    peerId,
    bearerEnv: 'A2A_BEARER_TOKEN',
    message: { messageId, parts: [{ text: work.text }] },
    metadata: {
      agentId: `${SELF_NAME}-trader`,
      agentName: `${SELF_NAME} autonomous trader`,
      skillId: work.skillId,
      forecastSpec: work.forecastSpec,
      demandSignal: {
        need: work.need,
        tags: ['internal-trade-loop', SELF_NAME],
        offeredRevenueUsd: 0,
        verified: false,
      },
    },
  });

  const hubTaskId = sent.result?.result?.metadata?.jacoHubTaskId;
  if (!hubTaskId) { log('WARN', 'Inget hubTaskId i svaret - kan inte verifiera utfall.'); return; }
  log('SEND', `Mottaget av motpart, hubTaskId=${hubTaskId}. Väntar på verifierat utfall...`);

  const outcome = await waitForOutcome(hubTaskId, OUTCOME_TIMEOUT_MS);
  if (!outcome) { log('OUTCOME', `TIMEOUT - inget verifierat utfall inom ${OUTCOME_TIMEOUT_MS / 1000}s för ${hubTaskId} (kön kan vara mättad).`); return; }
  log('OUTCOME', `${outcome.status} av ${outcome.assignedAgentId || 'okänd agent'}, evidence=${JSON.stringify(outcome.evidenceRefs || [])}`);
}

async function loop() {
  log('INIT', `Trade-loop startad. Self=${SELF_CONTINUUM_URL} Peer(A2A)=${PEER_A2A_URL} Peer(core)=${PEER_CONTINUUM_URL} interval=${INTERVAL_MS}ms`);
  while (true) {
    try { await tradeCycle(); }
    catch (err) { log('ERROR', err.message); }
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

process.on('SIGINT', () => { log('SHUTDOWN', 'Avbryter.'); process.exit(0); });
process.on('SIGTERM', () => { log('SHUTDOWN', 'SIGTERM.'); process.exit(0); });

loop();
