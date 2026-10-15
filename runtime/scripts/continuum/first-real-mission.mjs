#!/usr/bin/env node
/**
 * Kör en verklig mission genom hela Continuum-kedjan mot en LIVE server:
 * mission -> commitment -> hub task -> edge agent claim/complete -> review
 * -> evidence -> mission FULFILLED.
 *
 * Detta är en intern kapabilitetsvalidering, INTE en extern A2A-affär:
 * det finns ingen extern motpart i den här miljön, så inget
 * intäkts-/settlement-steg körs eller fabriceras. Nästa verkliga
 * milstolpe är att koppla in en faktisk extern A2A-peer.
 *
 * Förutsätter: Continuum-servern körs redan (t.ex. på :3020) och att en
 * edge-agent (scripts/jaco-runtime-daemon.ts) är ansluten och pollar
 * EDGE_TELEMETRY_SYNC-tasks.
 */

const HUB_URL = process.env.JACO_CONTINUUM_URL || 'http://127.0.0.1:3020';
const TOKEN = process.env.JACO_CONTINUUM_TOKEN || '';
const CLAIM_TIMEOUT_MS = Number(process.env.CLAIM_TIMEOUT_MS || 30_000);
const POLL_MS = 2000;

async function call(pathname, method, body) {
  const headers = { 'content-type': 'application/json' };
  if (TOKEN) headers['authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(`${HUB_URL}${pathname}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(`${method} ${pathname} -> ${res.status}: ${json?.error?.message || JSON.stringify(json)}`);
  }
  return json;
}

function log(tag, msg) { console.log(`[${tag}] ${msg}`); }

async function waitForTaskCompletion(taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { task } = await call(`/api/continuum/hub/tasks/${taskId}`, 'GET');
    if (['COMPLETED', 'FAILED'].includes(task.status)) return task;
    log('WAIT', `task ${taskId} status=${task.status}...`);
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`task ${taskId} did not complete within ${timeoutMs}ms`);
}

async function findEligibleAgent() {
  const { agents } = await call('/api/continuum/hub/agents', 'GET');
  const candidate = agents.find(a => a.liveness === 'LIVE' && (a.capabilities || []).includes('edge-telemetry'));
  if (!candidate) throw new Error('no LIVE agent with capability "edge-telemetry" found - is the edge daemon running?');
  return candidate;
}

async function main() {
  log('CHECK', `Continuum target: ${HUB_URL}`);
  await call('/api/continuum/status', 'GET');
  const edgeAgent = await findEligibleAgent();
  log('CHECK', `Eligible edge agent: ${edgeAgent.id}`);

  const mission = (await call('/api/continuum/missions', 'POST', {
    objective: 'Verifiera end-to-end att Continuum Edge Bridge (PODAR) registrerar en nod, håller LIVE, hämtar en verklig hub-task och slutför den med verifierad evidence.',
    state: 'ACTIVE',
    priority: 60,
    tags: ['internal-validation', 'edge-bridge', 'first-real-task'],
    invariants: ['no fabricated evidence', 'no fabricated success on hub failure'],
  })).mission;
  log('MISSION', `created ${mission.id} (state=${mission.state})`);

  const commitment = (await call('/api/continuum/commitments', 'POST', {
    missionId: mission.id,
    title: 'Edge agent hämtar och slutför en EDGE_TELEMETRY_SYNC hub-task',
    description: 'Verifierar att claim/complete-flödet i runtimeHub fungerar med den reparerade PODAR-bryggan.',
    execution: { kind: 'EDGE_TELEMETRY_SYNC', consequence: 'REVERSIBLE' },
  })).commitment;
  log('COMMITMENT', `created ${commitment.id}`);
  await call(`/api/continuum/commitments/${commitment.id}/transition`, 'POST', { state: 'ACCEPTED' });
  await call(`/api/continuum/commitments/${commitment.id}/transition`, 'POST', { state: 'ACTIVE' });

  const task = (await call('/api/continuum/hub/tasks', 'POST', {
    missionId: mission.id,
    commitmentId: commitment.id,
    title: 'Edge telemetry sync (first real mission)',
    kind: 'EDGE_TELEMETRY_SYNC',
    requirements: ['edge-telemetry'],
    preferredRoles: ['edge-observer'],
    consequence: 'REVERSIBLE',
  })).task;
  log('TASK', `queued ${task.id}, waiting for an edge agent to claim it...`);

  const completed = await waitForTaskCompletion(task.id, CLAIM_TIMEOUT_MS);
  if (completed.status !== 'COMPLETED') {
    throw new Error(`task ended as ${completed.status}: ${completed.lastError || 'unknown error'}`);
  }
  log('TASK', `completed by ${completed.assignedAgentId}, evidenceRefs=${JSON.stringify(completed.evidenceRefs)}`);

  // Legitim peer-review: kör den deterministiska idle-audit-mekanismen som
  // SEER faktiskt äger, mot verklig hub-state. Det uppfinner inga fynd -
  // om inget avvikande hittas är noll findings ett sant resultat.
  const audit = await call('/api/continuum/reviews/audit-idle', 'POST', {
    reviewerAgentId: 'jaco-seer', staleAfterMs: 120_000,
  });
  log('REVIEW', `jaco-seer idle-audit over hub state: ${audit.findings.length} finding(s)`);

  const commitmentEvidenceRefs = [...completed.evidenceRefs];
  await call(`/api/continuum/commitments/${commitment.id}/transition`, 'POST', {
    state: 'VERIFYING', evidenceRefs: commitmentEvidenceRefs,
  });
  await call(`/api/continuum/commitments/${commitment.id}/transition`, 'POST', {
    state: 'FULFILLED', evidenceRefs: commitmentEvidenceRefs,
  });
  log('COMMITMENT', `${commitment.id} -> FULFILLED`);

  await call(`/api/continuum/missions/${mission.id}/transition`, 'POST', {
    state: 'VERIFYING', evidenceRefs: commitmentEvidenceRefs,
  });
  await call(`/api/continuum/missions/${mission.id}/transition`, 'POST', {
    state: 'FULFILLED', evidenceRefs: commitmentEvidenceRefs,
  });
  log('MISSION', `${mission.id} -> FULFILLED`);

  const integrity = (await call('/api/continuum/integrity', 'GET')).integrity;
  log('INTEGRITY', `event ledger valid=${integrity.valid}, count=${integrity.count}`);

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    missionId: mission.id,
    commitmentId: commitment.id,
    taskId: task.id,
    completedBy: completed.assignedAgentId,
    evidenceRefs: completed.evidenceRefs,
    reviewFindings: audit.findings.length,
    eventLedgerValid: integrity.valid,
    scope: 'INTERNAL_VALIDATION_ONLY - no external A2A counterparty, no revenue recorded',
  }, null, 2));
}

main().catch(err => { console.error('[FAIL]', err.message); process.exit(1); });
