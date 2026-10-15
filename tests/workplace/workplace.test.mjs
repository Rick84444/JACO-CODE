import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WorkplaceStore } from '../../gateway/src/workplace/workplace-store.mjs';
import { bootstrapJacoAgent, JacoWorkplaceClient } from '../../gateway/src/workplace/workplace-client.mjs';

function card(name, overrides = {}) {
  return {
    schema: 'jaco.agent-card/v1',
    identity: {
      stable_id: name.toLowerCase().replace(/\s+/g, '-'),
      requested_name: name,
      provider: 'test',
      model: 'test-model',
      agent_type: 'coding'
    },
    session: {
      environment: 'node-test',
      persistent: false,
      sandboxed: true
    },
    role: {
      primary: 'test-agent',
      description: 'Workplace test participant'
    },
    capabilities: {
      reasoning: true,
      code_edit: true,
      testing: true,
      tools: ['node:test']
    },
    constraints: [],
    preferred_tasks: ['testing'],
    communication: {
      can_receive_messages: true,
      can_receive_missions: true,
      can_be_mentioned: true
    },
    runtime: {
      started_at: new Date().toISOString(),
      version: process.version
    },
    ...overrides
  };
}

function withStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-workplace-'));
  const store = new WorkplaceStore(dir);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

// register -> sync -> ack -> STATUS READY, returning the credentials a real agent would hold.
function boot(store, name) {
  const reg = store.registerAgent(card(name));
  const auth = { sessionId: reg.sessionId, sessionToken: reg.sessionToken };
  const sync = store.sync(auth);
  store.ack({ ...auth, cursor: sync.scannedCursor });
  store.postEvent({ ...auth, kind: 'STATUS', payload: { status: 'READY' } });
  return { ...reg, auth };
}

test('same stable Agent Card reuses agent identity but creates a fresh session', t => {
  const store = withStore(t);
  const first = store.registerAgent(card('Codex'));
  const second = store.registerAgent(card('Codex'));

  assert.equal(first.status, 'REGISTERED');
  assert.equal(second.agentId, first.agentId);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.notEqual(second.sessionToken, first.sessionToken);
  assert.equal(first.permissions['mission.create'], true);
});

test('agent discovery exposes authority booleans without credential material', t => {
  const store = withStore(t);
  const a = boot(store, 'Authority Agent');
  store.setPermissions(a.agentId, { 'mission.create': true });

  const agent = store.listAgents().find(item => item.agentId === a.agentId);
  assert.equal(agent.permissions['mission.create'], true);
  assert.equal(agent.permissions['deployment.execute'], true);
  const serialized = JSON.stringify(agent);
  assert.doesNotMatch(serialized, /sessionToken|session_token|token_hash|wps_/);
});

test('a session id alone does not authenticate; the registration token does', t => {
  const store = withStore(t);
  const a = boot(store, 'Agent A');
  const b = store.registerAgent(card('Agent B'));

  // Session ids are listed publicly, so knowing one must not allow acting as that agent.
  const visible = store.listAgents().flatMap(agent => agent.sessions).map(s => s.sessionId);
  assert.ok(visible.includes(a.sessionId));
  assert.throws(() => store.postEvent({ sessionId: a.sessionId, kind: 'FINDING', body: 'spoof' }), /SESSION_TOKEN_INVALID/);
  assert.throws(() => store.postEvent({ sessionId: a.sessionId, sessionToken: b.sessionToken, kind: 'FINDING', body: 'spoof' }), /SESSION_TOKEN_INVALID/);
  assert.throws(() => store.heartbeat({ sessionId: a.sessionId, sessionToken: 'wps_forged' }), /SESSION_TOKEN_INVALID/);
});

test('work requires READY; a newly registered session can go straight to READY without a prior sync/ack round trip', t => {
  // Removed 2026-09-29 at the operator's explicit request: requiring sync+ack before an agent could
  // even declare itself READY was a standing operational barrier (agents got stuck in
  // DEGRADED_UNSYNCED whenever a live sync round trip failed, even though sync/ack still work and
  // still deliver missed events -- READY just no longer depends on having completed one first).
  const store = withStore(t);
  const existing = boot(store, 'Seer');
  store.postEvent({ ...existing.auth, kind: 'DECISION', body: 'decision the newcomer must see' });

  const reg = store.registerAgent(card('Newcomer'));
  const auth = { sessionId: reg.sessionId, sessionToken: reg.sessionToken };
  assert.ok(reg.syncUntilCursor > 0);

  // Still gated: an agent that hasn't said it's ready yet cannot do work.
  assert.throws(() => store.postEvent({ ...auth, kind: 'FINDING', body: 'too early' }), /SESSION_NOT_READY/);
  assert.throws(() => store.claim({ ...auth, resource: 'x' }), /SESSION_NOT_READY/);

  // No longer gated: declaring READY no longer requires a completed sync/ack first.
  assert.equal(store.heartbeat({ ...auth, status: 'READY' }).status, 'READY');
  assert.equal(store.postEvent({ ...auth, kind: 'STATUS', payload: { status: 'READY' } }).kind, 'STATUS');
  assert.equal(store.getSession(reg.sessionId).status, 'READY');
  assert.equal(store.postEvent({ ...auth, kind: 'FINDING', body: 'now allowed' }).kind, 'FINDING');

  // Unsynchronized agents may still say so, and sync/ack still work and still deliver missed events.
  assert.equal(store.postEvent({ ...auth, kind: 'STATUS', payload: { status: 'DEGRADED_UNSYNCED' } }).kind, 'STATUS');
  const sync = store.sync(auth);
  assert.ok(sync.decisions.some(d => d.body === 'decision the newcomer must see'));
  assert.equal(store.ack({ ...auth, cursor: sync.scannedCursor }).sessionStatus, 'SYNCED');
});

test('broadcast and targeted events synchronize with durable cursor acknowledgement', t => {
  const store = withStore(t);
  const a = boot(store, 'Agent A');
  const b = boot(store, 'Agent B');

  const broadcast = store.postEvent({ ...a.auth, kind: 'FINDING', body: 'shared finding' });
  store.postEvent({ ...a.auth, kind: 'MESSAGE', targets: [a.agentId], body: 'private to A' });

  const syncB = store.sync(b.auth);
  const findings = syncB.events.filter(e => e.kind === 'FINDING');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].eventId, broadcast.eventId);
  assert.equal(syncB.events.some(e => e.body === 'private to A'), false);

  const ack = store.ack({ ...b.auth, cursor: syncB.scannedCursor });
  assert.equal(ack.cursor, syncB.scannedCursor);
  assert.equal(store.sync(b.auth).events.length, 0);
});

test('active resource claim prevents concurrent mutation', t => {
  const store = withStore(t);
  const a = boot(store, 'Agent A');
  const b = boot(store, 'Agent B');

  const claim = store.claim({ ...a.auth, resource: 'gateway\\src\\shared.mjs', intent: 'edit', leaseSeconds: 300 });
  assert.equal(claim.status, 'ACTIVE');
  assert.equal(claim.resource, 'gateway/src/shared.mjs');
  assert.throws(
    () => store.claim({ ...b.auth, resource: 'gateway/src/shared.mjs' }),
    error => error.message === 'RESOURCE_ALREADY_CLAIMED' && error.claim.agentId === a.agentId
  );
  assert.throws(() => store.releaseClaim({ ...b.auth, claimId: claim.claimId }), /CLAIM_OWNER_MISMATCH/);

  store.releaseClaim({ ...a.auth, claimId: claim.claimId });
  const next = store.claim({ ...b.auth, resource: 'gateway/src/shared.mjs' });
  assert.equal(next.agentId, b.agentId);
});

test('permissions come from server policy, DONE needs evidence and retries are idempotent', t => {
  const store = withStore(t);
  const a = boot(store, 'Agent A');
  const b = boot(store, 'Agent B');

  assert.equal(store.postEvent({ ...a.auth, kind: 'MISSION', body: 'bounded autonomous work', missionId: 'm1' }).kind, 'MISSION');
  assert.equal(store.permissions(a.agentId)['deployment.execute'], true);
  assert.throws(() => store.setPermissions(a.agentId, { 'root.everything': true }), /PERMISSION_UNSUPPORTED/);

  assert.throws(() => store.postEvent({ ...a.auth, kind: 'RESULT', payload: { status: 'DONE' } }), /MISSION_ID_REQUIRED/);
  assert.throws(() => store.postEvent({ ...a.auth, kind: 'RESULT', missionId: 'm1', payload: { status: 'DONE' } }), /EVIDENCE_REQUIRED_FOR_DONE/);
  assert.throws(() => store.postEvent({ ...a.auth, kind: 'RESULT', missionId: 'm1', payload: { status: 'SHIPPED' } }), /RESULT_STATUS_UNSUPPORTED/);

  const result = { ...a.auth, kind: 'RESULT', missionId: 'm1', eventId: 'result-m1', payload: { status: 'DONE', evidence: { tests: { passed: 5, failed: 0 } } } };
  const first = store.postEvent(result);
  const retry = store.postEvent(result);
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.seq, first.seq);
  assert.throws(() => store.postEvent({ ...b.auth, kind: 'RESULT', missionId: 'm1', eventId: 'result-m1', payload: { status: 'FAILED' } }), /EVENT_ID_CONFLICT/);
});

test('decisions are included in sync context and session end releases claims and revokes the session', t => {
  const store = withStore(t);
  const a = boot(store, 'Seer');
  const b = boot(store, 'Nova');

  store.postEvent({ ...a.auth, kind: 'DECISION', thread: 'desktop-control', body: 'Remote Desktop is the primary desktop surface' });

  const claim = store.claim({ ...b.auth, resource: 'desktop/session' });
  const sync = store.sync(b.auth);
  assert.equal(sync.decisions.length, 1);
  assert.equal(sync.decisions[0].kind, 'DECISION');
  assert.equal(sync.activeClaims.some(item => item.claimId === claim.claimId), true);

  store.endSession({ ...b.auth, handoff: { thread: 'desktop-control', body: 'Desktop work handed off' } });

  assert.equal(store.listClaims({ activeOnly: true }).some(item => item.claimId === claim.claimId), false);
  assert.equal(store.getSession(b.sessionId).status, 'ENDED');
  assert.throws(() => store.sync(b.auth), /SESSION_ENDED/);
});

test('sessions that stop heartbeating are reported OFFLINE, not in their last state', t => {
  const store = withStore(t);
  const a = boot(store, 'Crashed Agent');
  assert.equal(store.listAgents().find(x => x.agentId === a.agentId).sessions[0].status, 'READY');
  store.db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(new Date(Date.now() - 10 * 60_000).toISOString(), a.sessionId);
  const session = store.listAgents().find(x => x.agentId === a.agentId).sessions[0];
  assert.equal(session.status, 'OFFLINE');
  assert.equal(session.recordedStatus, 'READY');
});

test('sessions created before token enforcement cannot be used and must re-register', t => {
  const store = withStore(t);
  const legacy = store.registerAgent(card('Legacy'));
  store.db.prepare('UPDATE sessions SET token_hash=NULL WHERE id=?').run(legacy.sessionId);
  assert.throws(() => store.sync({ sessionId: legacy.sessionId, sessionToken: legacy.sessionToken }), /SESSION_TOKEN_INVALID/);
});

test('HTTP server and client complete the bootstrap and reject session spoofing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-workplace-http-'));
  const child = spawn(process.execPath, ['--experimental-sqlite', 'gateway/src/workplace/workplace-server.mjs'], {
    env: { PATH: process.env.PATH, JACO_WORKPLACE_PORT: '0', JACO_WORKSPACE_ROOT: dir, JACO_WORKPLACE_TOKEN: 'operator-token-1234567890abcdef', JACO_WORKPLACE_OPERATOR_TOKEN: 'permission-admin-token-0987654321' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    child.kill();
    await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let output = '';
  child.stderr.on('data', c => { output += c; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WORKPLACE_START_TIMEOUT ' + output)), 5000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('WORKPLACE_EXIT ' + output)); });
    child.stdout.on('data', c => {
      output += c;
      const m = output.match(/READY http:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = 'operator-token-1234567890abcdef';

  const { client, registration } = await bootstrapJacoAgent(card('HTTP Agent'), { baseUrl, token });
  const me = (await client.agents()).agents.find(a => a.agentId === registration.agentId);
  assert.equal(me.sessions[0].status, 'READY');
  assert.equal(me.permissions['mission.create'], true);
  assert.equal(me.permissions['deployment.execute'], true);
  assert.doesNotMatch(JSON.stringify(me), /sessionToken|session_token|token_hash|wps_/);

  const spoof = new JacoWorkplaceClient({ baseUrl, token });
  spoof.sessionId = registration.sessionId;
  spoof.sessionToken = 'wps_not-the-real-token';
  await assert.rejects(() => spoof.post('FINDING', 'spoofed'), error => error.status === 401 && error.message === 'SESSION_TOKEN_INVALID');

  assert.equal((await client.post('MISSION', 'bounded local mission', { missionId: 'm-http' })).kind, 'MISSION');

  // The transport token every agent holds cannot grant permissions; only the separate operator token can.
  const grant = (headers) => fetch(`${baseUrl}/v1/agents/permissions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ agentId: registration.agentId, permissions: { 'deployment.execute': true } })
  });
  assert.equal((await grant({})).status, 403);
  assert.equal((await grant({ 'x-jaco-operator-token': 'permission-admin-token-0987654321' })).status, 200);
  const unauth = await fetch(`${baseUrl}/v1/agents`);
  assert.equal(unauth.status, 401);
});
