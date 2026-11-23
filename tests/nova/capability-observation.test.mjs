// Contract: a capability status comes from evidence only, expires, and a failure is never hidden by an older success.
import test from 'node:test';
import assert from 'node:assert/strict';
import { observe, withEvidence, deriveStatus, plannerView, observationId, observationsFromMissions, MAX_AGE_MS, PROBE_MAX_AGE_MS } from '../../agents/lib/capability-observation.mjs';

const NOW = Date.parse('2026-11-13T10:00:00Z');
const iso = ms => new Date(NOW - ms).toISOString();

test('registration and operator enablement alone never count as verification', () => {
  assert.equal(observe({ agentId: 'aura', tool: 'repo-write', registered: true, operatorEnabled: true, now: NOW }).status, 'enabled');
  assert.equal(observe({ agentId: 'aura', tool: 'repo-write', registered: true, now: NOW }).status, 'registered');
  assert.equal(observe({ agentId: 'aura', tool: 'repo-write', now: NOW }).status, 'unknown');
  assert.equal(observe({ agentId: 'aura', tool: 'repo-write', operatorEnabled: true, capsuleAllowed: false, now: NOW }).status, 'unknown');
});

test('a verified execution is the only evidence that makes a tool verified', () => {
  const r = observe({ agentId: 'aura', tool: 'repo-write', registered: true, operatorEnabled: true,
    execution: { ok: true, verified: true, at: iso(60_000), receipt: 'aura:turn:7' }, now: NOW });
  assert.equal(r.status, 'verified');
  // ok without verification is not proof.
  assert.equal(observe({ agentId: 'aura', tool: 'repo-write', execution: { ok: true, verified: false, at: iso(1000) }, now: NOW }).status, 'unknown');
});

test('a fresher failure overrides an older success, and a probe never overrides a failure', () => {
  const ok = observe({ agentId: 'aura', tool: 'browser-click', execution: { ok: true, verified: true, at: iso(3_600_000) }, now: NOW });
  const failed = withEvidence(ok, { execution: { ok: false, at: iso(60_000), error: 'selector not found', receipt: 'aura:turn:9' }, now: NOW });
  assert.equal(failed.status, 'failed');
  const probed = withEvidence(failed, { probe: { ok: true, at: iso(1000), source: 'cdp-bridge' }, now: NOW });
  assert.equal(probed.status, 'failed');
  assert.equal(probed.lastExecution.error, 'selector not found');
});

test('evidence expires: a stale success or probe is no longer trusted', () => {
  const old = observe({ agentId: 'aura', tool: 'web-fetch', execution: { ok: true, verified: true, at: iso(MAX_AGE_MS + 1000) }, registered: true, now: NOW });
  assert.equal(old.status, 'registered');
  const probeOnly = observe({ agentId: 'aura', tool: 'web-fetch', probe: { ok: true, at: iso(PROBE_MAX_AGE_MS + 1000) }, operatorEnabled: true, now: NOW });
  assert.equal(probeOnly.status, 'enabled');
  assert.equal(observe({ agentId: 'aura', tool: 'web-fetch', probe: { ok: true, at: iso(1000) }, now: NOW }).status, 'reachable');
  assert.equal(observe({ agentId: 'aura', tool: 'web-fetch', probe: { ok: false, at: iso(1000), error: 'ECONNREFUSED' }, now: NOW }).status, 'unknown');
});

test('identifiers are stable and invalid ones are refused', () => {
  assert.equal(observationId('aura', 'repo-write'), observationId('aura', 'repo-write'));
  assert.notEqual(observationId('aura', 'repo-write'), observationId('aura', 'repo-write', 'other'));
  assert.throws(() => observationId('Aura Agent', 'repo-write'), /CAPABILITY_ID_INVALID/);
  assert.throws(() => observe({ agentId: 'aura', tool: '../etc' }), /CAPABILITY_ID_INVALID/);
});

test('the planner view lists only verified or reachable tools as usable and names every failure', () => {
  const records = [
    observe({ agentId: 'aura', tool: 'repo-write', execution: { ok: true, verified: true, at: iso(1000) }, now: NOW }),
    observe({ agentId: 'aura', tool: 'web-fetch', probe: { ok: true, at: iso(1000) }, now: NOW }),
    observe({ agentId: 'aura', tool: 'shell', execution: { ok: false, at: iso(1000), error: 'denied', receipt: 'aura:turn:3' }, now: NOW }),
    observe({ agentId: 'aura', tool: 'mcp-call', registered: true, operatorEnabled: true, now: NOW }),
  ];
  const view = plannerView(records, NOW);
  assert.deepEqual(view.usable.sort(), ['repo-write', 'web-fetch']);
  assert.deepEqual(view.blocked, [{ tool: 'shell', error: 'denied', receipt: 'aura:turn:3' }]);
  assert.equal(view.counts.enabled, 1);
  assert.equal(view.counts.verified, 1);
});

test('observations come from the latest receipt per tool across missions, and switches still count', () => {
  const missions = [
    { id: 'm1', updatedAt: iso(9000), receipts: [{ type: 'web-fetch', ok: true, verified: true, at: iso(8000), actionId: 'm1:turn:1' }] },
    { id: 'm2', updatedAt: iso(1000), receipts: [{ type: 'web-fetch', ok: false, at: iso(2000), actionId: 'm2:turn:1', error: 'ENOTFOUND' }, { type: 'repo-read', ok: true, verified: true, at: iso(1500), actionId: 'm2:turn:2' }] },
  ];
  const obs = observationsFromMissions({ tools: ['web-fetch', 'repo-read', 'shell'], missions, isEnabled: t => t !== 'shell', now: NOW });
  const by = Object.fromEntries(obs.map(o => [o.tool, o]));
  assert.equal(by['web-fetch'].status, 'failed', 'the newer failure wins');
  assert.equal(by['web-fetch'].lastExecution.receipt, 'm2:turn:1');
  assert.equal(by['repo-read'].status, 'verified');
  assert.equal(by.shell.status, 'registered', 'switched off and never run');
});

test('MCP tools are observed by server and tool: a READY server is a probe, a failed call still blocks', () => {
  const servers = [{ id: 'git', status: 'READY', agentAccess: 'read', tools: [{ name: 'git_log', agentAllowed: true }, { name: 'git_push', agentAllowed: false }] },
    { id: 'stripe', status: 'FAILED', error: 'ECONNREFUSED', tools: [{ name: 'list_charges' }] }];
  const missions = [{ id: 'm', updatedAt: iso(500), receipts: [{ type: 'mcp-call', input: { server: 'git', tool: 'git_log' }, ok: false, at: iso(500), actionId: 'm:turn:1', error: 'timeout' }] }];
  const by = Object.fromEntries(observationsFromMissions({ tools: [], mcpServers: servers, missions, now: NOW }).map(o => [o.tool, o]));
  assert.equal(by['mcp:git.git_log'].status, 'failed', 'a failed call outranks a READY server');
  assert.equal(by['mcp:git.git_push'].status, 'registered', 'denied to the agent: not enabled');
  assert.equal(by['mcp:stripe.list_charges'].status, 'enabled', 'a failed server probe proves nothing');
  const ok = Object.fromEntries(observationsFromMissions({ mcpServers: [servers[0]], now: NOW }).map(o => [o.tool, o]));
  assert.equal(ok['mcp:git.git_log'].status, 'reachable');
});

test('the planner hint names answering tools and failed ones with their error, and is empty without evidence', async () => {
  const { capabilityObservationHint } = await import('../../agents/lib/agent-loop.mjs');
  const hint = capabilityObservationHint({ usable: ['web-fetch', 'mcp:git.git_log'], blocked: [{ tool: 'shell', error: 'denied' }] });
  assert.match(hint, /answered recently: web-fetch, mcp:git.git_log/);
  assert.match(hint, /failed last time: shell \(denied\)/);
  assert.equal(capabilityObservationHint(null), '');
  assert.equal(capabilityObservationHint({ usable: [], blocked: [] }), '');
});
