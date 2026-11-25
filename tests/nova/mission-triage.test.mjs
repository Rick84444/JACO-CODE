// Aura chooses which of several ACTIVE missions keeps running: a retry of the same task ends, an old idle mission waits,
// and what the operator waits on or a paid order is never touched. A similar task is not started twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planMissionTriage, findSimilarMissions, goalFamily } from '../../runtime/src/server/connected/missionTriage.mjs';

const NOW = Date.parse('2026-11-23T20:00:00.000Z');
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
const mission = (id, over = {}) => ({ id, source: 'seer-mission-graph', goal: 'Do something', createdAt: ago(60), updatedAt: ago(60), receipts: [], ...over });
const plan = missions => Object.fromEntries(planMissionTriage(missions, { now: NOW }).map(d => [d.id, d.action]));

test('a retry of the same task with no verified progress is cancelled as superseded', () => {
  const decisions = plan([
    mission('q', { goal: 'Datorövning Q (Qwen3-VL med bilder)', createdAt: ago(40), updatedAt: ago(1) }),
    mission('q2', { goal: 'Datorövning Q2 (ny kontextbudget)', createdAt: ago(30), updatedAt: ago(1) }),
    mission('q4', { goal: 'Datorövning Q4 (kortare verktygslista)', createdAt: ago(5), updatedAt: ago(1) }),
  ]);
  assert.deepEqual(decisions, { q: 'cancel', q2: 'cancel' });
  assert.equal(goalFamily('Datorövning Q3 (x)'), goalFamily('Datorövning Q4 (y)'));
});

test('a retry that already made verified progress is kept, an old idle mission is paused', () => {
  const decisions = plan([
    mission('worked', { goal: 'Datorövning A (x)', createdAt: ago(40), updatedAt: ago(30), receipts: [{ ok: true, verified: true, at: ago(30) }] }),
    mission('same-family-new', { goal: 'Datorövning A (y)', createdAt: ago(5), updatedAt: ago(1) }),
    mission('old-idle', { goal: 'Registrera relä', createdAt: ago(300), updatedAt: ago(200) }),
  ]);
  assert.equal(decisions.worked, 'pause', 'idle for 30 minutes and older than the newest goal: waits, not cancelled');
  assert.equal(decisions['old-idle'], 'pause');
  assert.equal(decisions['same-family-new'], undefined);
});

test('what the operator waits on, paid orders, graph children, running steps and paused missions are never touched', () => {
  const old = { createdAt: ago(500), updatedAt: ago(400) };
  const decisions = plan([
    mission('waiting', { ...old, pendingOperatorAction: { kind: 'approval' } }),
    mission('spend', { ...old, spendApprovalPending: true }),
    mission('order', { ...old, source: 'stripe-order' }),
    mission('child', { ...old, metadata: { parent: { graphId: 'g1' } } }),
    mission('running', { ...old, executionLeaseActive: true }),
    mission('paused', { ...old, paused: { at: ago(100) } }),
    mission('ending', { ...old, cancelRequested: true }),
    mission('newest', { goal: 'Newest goal', createdAt: ago(2), updatedAt: ago(1) }),
  ]);
  assert.deepEqual(decisions, {});
});

test('a recent mission is left alone even when it is not the newest', () => {
  assert.deepEqual(plan([mission('a', { createdAt: ago(20), updatedAt: ago(2) }), mission('b', { goal: 'Other', createdAt: ago(5), updatedAt: ago(1) })]), {});
});

test('a task of the same family finished today is reported, not silently repeated', () => {
  const missions = [
    mission('running', { goal: 'Skriv en rad i Anteckningar', status: 'ACTIVE' }),
    mission('paused-same', { goal: 'Skriv en rad i Anteckningar', status: 'ACTIVE', paused: { at: ago(1) } }),
    mission('done-today', { goal: 'Datorövning A (Bonsai)', status: 'DONE', updatedAt: ago(120), receipts: [{ ok: true, verified: true, at: ago(121) }] }),
    mission('done-old', { goal: 'Datorövning A (Bonsai)', status: 'DONE', updatedAt: ago(60 * 30) }),
  ];
  const again = findSimilarMissions('Datorövning A (annan text)', missions, { now: NOW });
  assert.deepEqual(again.done.map(d => d.id), ['done-today'], 'only the last day counts');
  assert.equal(again.done[0].verified, true);
  assert.deepEqual(findSimilarMissions('', missions, { now: NOW }), { done: [] });
});

// Against the real mission control and its database: the lookups must read Nova missions only (the bus also holds others) and
// triage must act through the existing pause and cancel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';

test('mission control: findSimilar reads Nova missions only, triage dry-runs and applies through pause and cancel', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = new NovaMissionControl(bus, { allowedTasks: ['web-fetch'] });
  // A non-Nova mission on the same bus must not break the lookup.
  bus.createMission({ goal: 'Not a nova mission', source: 'SEER', metadata: {} });
  const first = control.create({ goal: 'Datorövning X1 (försök ett)', idempotencyKey: 'k1', allowedTasks: ['web-fetch'] });
  const retry = control.create({ goal: 'Datorövning X2 (försök två)', idempotencyKey: 'k2', allowedTasks: ['web-fetch'] });
  assert.deepEqual(control.findSimilar('Something else entirely'), { done: [] });

  const later = Date.now() + 3600_000;
  const dry = control.triage({ apply: false, now: later });
  assert.deepEqual(dry.map(d => [d.id, d.action]), [[first.id, 'cancel']], 'the earlier attempt of the same task is superseded');
  assert.equal(control.get(first.id).status, 'ACTIVE', 'a dry run changes nothing');

  const applied = control.triage({ apply: true, now: later });
  assert.equal(applied[0].applied, true);
  assert.equal(control.get(first.id).status, 'CANCELLED');
  assert.equal(control.get(retry.id).status, 'ACTIVE', 'the newest attempt keeps running');
  assert.deepEqual(control.triage({ apply: true, now: later }), [], 'nothing left to decide');
});
