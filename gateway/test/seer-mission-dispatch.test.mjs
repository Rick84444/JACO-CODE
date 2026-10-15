import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMissionGraph } from '../src/seer-mission-graph.mjs';
import { createMissionDispatcher } from '../src/seer-mission-dispatch.mjs';
import { createAutonomyLoop } from '../src/seer-autonomy-loop.mjs';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-dispatch-'));
  let db, bus, graph, control;
  const open = () => {
    db = new DatabaseSync(path.join(dir, 'seer.sqlite'));
    graph = createMissionGraph({ db, uid: randomUUID, now: Date.now });
    bus = new DurableMissionBus(path.join(dir, 'nova'));
    control = new NovaMissionControl(bus, { allowedTasks: ['health-check'] });
  };
  open();
  t.after(() => { db.close(); bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { get graph() { return graph; }, get control() { return control; },
    reopen() { db.close(); bus.close(); open(); },
    create() { return graph.create({ title: 'Dispatch proof', objective: 'No external action',
      policy: { allowedTasks: ['health-check'] }, nodes: [{ key: 'a', objective: 'Observe health' }] }); },
    dispatcher(overrides = {}) { return createMissionDispatcher({ missionGraph: graph,
      createNova: async spec => control.create(spec), cancelNova: async id => control.requestCancel(id), ...overrides }); },
  };
}

test('operator stop while Nova creation is in flight cancels the real durable Nova mission', async t => {
  const s = fixture(t); const created = s.create(); let id;
  const dispatcher = s.dispatcher({ createNova: async spec => {
    const mission = s.control.create(spec); id = mission.id;
    s.graph.cancel(created.id, { actor: 'operator', reason: 'stop during HTTP' });
    return mission;
  } });
  const result = await dispatcher.dispatch(created.id, 'a');
  assert.equal(result.cancelled, true);
  assert.equal(s.control.get(id).status, 'CANCELLED');
  assert.equal(s.graph.get(created.id).nodes[0].nova_mission_id, null);
  assert.deepEqual(s.graph.pendingDispatches(), []);
});

test('lost creation response is reconciled with the same idempotency key after both databases reopen', async t => {
  const s = fixture(t); const created = s.create(); let id, key;
  const dispatcher = s.dispatcher({ createNova: async spec => {
    id = s.control.create(spec).id; key = spec.idempotencyKey;
    throw new Error('RESPONSE_LOST');
  } });
  await assert.rejects(dispatcher.dispatch(created.id, 'a'), /RESPONSE_LOST/);
  const originalSpec = s.graph.pendingDispatches()[0].spec;
  s.graph.cancel(created.id, { actor: 'operator' });
  s.reopen();
  assert.equal(s.graph.pendingDispatches()[0].spec.idempotencyKey, key);
  assert.deepEqual(await s.dispatcher().reconcile(), []);
  assert.equal(s.control.get(id).status, 'CANCELLED');
  assert.equal(s.control.create(originalSpec).id, id);
  assert.deepEqual(s.graph.pendingDispatches(), []);
});

test('failed compensating cancellation remains durable and retries after restart without another creation', async t => {
  const s = fixture(t); const created = s.create(); let id;
  const dispatcher = s.dispatcher({ createNova: async spec => {
    const mission = s.control.create(spec); id = mission.id;
    s.graph.cancel(created.id, { actor: 'operator' }); return mission;
  }, cancelNova: async () => { throw new Error('CANCEL_OFFLINE'); } });
  await assert.rejects(dispatcher.dispatch(created.id, 'a'), /CANCEL_OFFLINE/);
  s.reopen();
  assert.equal(s.graph.pendingDispatches()[0].nova_mission_id, id);
  assert.deepEqual(await s.dispatcher({ createNova: async () => assert.fail('duplicate creation') }).reconcile(), []);
  assert.equal(s.control.get(id).status, 'CANCELLED');
  assert.deepEqual(s.graph.pendingDispatches(), []);
});

test('normal dispatch binds once and settles its durable intent', async t => {
  const s = fixture(t); const created = s.create();
  const result = await s.dispatcher().dispatch(created.id, 'a');
  assert.equal(result.graph.nodes[0].nova_mission_id, result.nova.id);
  assert.equal(result.graph.nodes[0].attempt, 1);
  assert.deepEqual(s.graph.pendingDispatches(), []);
});

test('unknown outcome survives restart and autonomy never plans or dispatches it', async t => {
  const s = fixture(t); const created = s.create();
  s.graph.bindNova(created.id, 'a', 'nova-unknown');
  const checkpoint = s.graph.checkpoint(created.id, { label: 'before unknown' });
  s.graph.reconcileNova(created.id, 'a', { id: 'nova-unknown', status: 'BLOCKED', phase: 'INTERRUPTED',
    receipts: [{ actionId: 'uncertain', ok: true, verified: false, outcomeUnknown: true }] });
  s.reopen();
  const loop = createAutonomyLoop({ missionGraph: s.graph,
    dispatch: async () => assert.fail('dispatch'), callLLM: async () => assert.fail('model') });
  for (let i = 0; i < 4; i++) await loop.turn();
  assert.equal(s.graph.get(created.id).status, 'EXHAUSTED');
  assert.ok(s.graph.get(created.id).policy.outcome_unknown);
  assert.throws(() => s.graph.recover(created.id, checkpoint.id), /GRAPH_OUTCOME_UNKNOWN/);
  assert.throws(() => s.graph.verify(created.id, 'a', { verified: true, evidence_refs: ['unrelated'] }), /GRAPH_OUTCOME_UNKNOWN/);
  assert.equal(s.graph.reconcileNova(created.id, 'a', { id: 'nova-unknown', status: 'DONE',
    receipts: [{ ok: true, verified: true }] }).outcome, 'quarantined');
  assert.equal(s.graph.cancel(created.id, { actor: 'operator' }).status, 'CANCELLED');
});

test('legacy uncertainty failures are quarantined before calling the repair model', async t => {
  const s = fixture(t); const created = s.create();
  s.graph.fail(created.id, 'a', { reason: 'NOVA_UNCERTAIN_OUTCOME_BUDGET_EXHAUSTED', evidence_refs: ['legacy'] });
  const loop = createAutonomyLoop({ missionGraph: s.graph,
    dispatch: async () => assert.fail('dispatch'), callLLM: async () => assert.fail('model') });
  await loop.turn();
  assert.equal(s.graph.get(created.id).policy.outcome_unknown.reason, 'NOVA_UNCERTAIN_OUTCOME_BUDGET_EXHAUSTED');
  assert.equal(s.graph.get(created.id).replans.length, 0);
});
