#!/usr/bin/env node
/**
 * Autonomous work exchange between two JACO nodes (option 1: no real
 * money flow). The loop runs continuously, self-initiated, without a
 * human pressing "send" each time:
 *
 *   every X seconds:
 *     -> discover peer (real HTTP, not cached away - discovered every
 *        cycle so changes in the peer's agent card show up)
 *     -> send a rotating real A2A task (task / forecast) with an
 *        honest demandSignal (offeredRevenueUsd: 0, verified: false - this
 *        is NOT real money and must never be claimed to be)
 *     -> verify independently at the RECEIVER'S OWN continuum core that
 *        the task really landed and (if possible) completed
 *     -> log the true outcome (COMPLETED/FAILED/TIMEOUT), never fabricated
 *
 * Env:
 *   SELF_NAME             - log name for this node, e.g. "peerA"
 *   SELF_CONTINUUM_URL    - own Continuum core URL (e.g. :3020)
 *   PEER_A2A_URL          - the peer's A2A adapter (e.g. :2999)
 *   PEER_CONTINUUM_URL    - the peer's Continuum core, for independent
 *                           verification that the task actually executed
 *   TRADE_INTERVAL_MS     - pause between cycles (default 20000)
 */

// Positional argv[2] is allowed as a name override (visible in the process list,
// which lets jaco-ctl tell several trader instances apart via
// command-line matching).
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

/** Rotating, meaningful, honest work requests - nobody claims money moves. */
function nextWorkRequest(n) {
  const kind = n % 3;
  if (kind === 0) {
    return {
      skillId: 'jaco_continuum_task',
      text: 'Give a short status analysis: how many agents in your RuntimeHub are LIVE right now, and are there any tasks that seem stuck?',
      need: 'runtime-status-analysis',
    };
  }
  if (kind === 1) {
    return {
      skillId: 'jaco_continuum_task',
      text: 'Propose a concrete, testable improvement for the review chain given that small local models sometimes return truncated/invalid JSON in their findings.',
      need: 'review-quality-suggestion',
    };
  }
  return {
    skillId: 'jaco_forecast_request',
    text: 'Probabilistic forecast requested.',
    need: 'short-horizon-forecast',
    forecastSpec: {
      question: 'Will this A2A task be completed (COMPLETED) within 90 seconds of receipt?',
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
    } catch { /* the peer's task may not be visible yet */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null; // a true TIMEOUT, not a fabricated completion
}

async function tradeCycle() {
  cycle++;
  log('DISCOVER', `Discovering peer ${PEER_A2A_URL}...`);
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
  if (!hubTaskId) { log('WARN', 'No hubTaskId in the response - cannot verify the outcome.'); return; }
  log('SEND', `Received by peer, hubTaskId=${hubTaskId}. Waiting for a verified outcome...`);

  const outcome = await waitForOutcome(hubTaskId, OUTCOME_TIMEOUT_MS);
  if (!outcome) { log('OUTCOME', `TIMEOUT - no verified outcome within ${OUTCOME_TIMEOUT_MS / 1000}s for ${hubTaskId} (the queue may be saturated).`); return; }
  log('OUTCOME', `${outcome.status} by ${outcome.assignedAgentId || 'unknown agent'}, evidence=${JSON.stringify(outcome.evidenceRefs || [])}`);
}

async function loop() {
  log('INIT', `Trade loop started. Self=${SELF_CONTINUUM_URL} Peer(A2A)=${PEER_A2A_URL} Peer(core)=${PEER_CONTINUUM_URL} interval=${INTERVAL_MS}ms`);
  while (true) {
    try { await tradeCycle(); }
    catch (err) { log('ERROR', err.message); }
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

process.on('SIGINT', () => { log('SHUTDOWN', 'Aborting.'); process.exit(0); });
process.on('SIGTERM', () => { log('SHUTDOWN', 'SIGTERM.'); process.exit(0); });

loop();
