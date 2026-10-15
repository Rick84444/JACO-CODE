import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentCycle, governorAdmission, chooseGovernorFocus, governorBaseline } from '../src/seer-development-cycle.mjs';
import { rankStrategies } from '../src/seer-strategy.mjs';

test('governor blocks differently worded new work while active work needs completion or repair', () => {
  for (const status of ['ACTIVE', 'NEEDS_REPLAN']) {
    assert.equal(governorAdmission([{ id: 'existing', status }]).reason, 'active_work_limit');
  }
  assert.equal(governorAdmission([{ status: 'COMPLETE' }]).allowed, true);
  assert.equal(governorAdmission([{ status: 'ACTIVE' }], { maxActive: 'invalid' }).allowed, false);
  assert.equal(governorAdmission([{ id: 'existing', status: 'ACTIVE', policy: { strategic_goal_id: 'goal' } }], { maxActive: 5, goalId: 'goal' }).reason, 'goal_already_active');
});

test('explicit failure results enter backoff rather than reporting completion', async () => {
  const queued = [];
  const cycle = createDevelopmentCycle({ memory: memoryFixture(), schedule: fn => queued.push(fn), runTurn: async () => ({ ok: false, error: 'PROVIDER_FAILED' }) });
  cycle.trigger('test');
  await queued.shift()();
  assert.equal(cycle.state().status, 'backoff');
  assert.equal(cycle.state().last_error, 'PROVIDER_FAILED');
});

test('failed initial persistence does not permanently latch scheduler', () => {
  const memory = memoryFixture();
  const set = memory.set;
  memory.set = () => { throw new Error('DISK_FAILURE'); };
  const cycle = createDevelopmentCycle({ memory, schedule: () => {}, runTurn: async () => ({ ok: true }) });
  assert.throws(() => cycle.trigger('test'), /DISK_FAILURE/);
  memory.set = set;
  assert.equal(cycle.state().scheduled, false);
  assert.equal(cycle.trigger('recovered').accepted, true);
});

test('an operator goal during a running turn is queued and runs next, an automatic trigger is not', async () => {
  const queued = [];
  const reasons = [];
  let release;
  const cycle = createDevelopmentCycle({
    memory: memoryFixture(),
    schedule: fn => queued.push(fn),
    runTurn: ({ reason }) => { reasons.push(reason); return reason === 'startup' ? new Promise(resolve => { release = resolve; }) : { ok: true }; },
  });
  cycle.trigger('startup', { eventKey: 'startup:1' });
  const running = queued.shift()();
  await Promise.resolve();
  assert.equal(cycle.trigger('watchdog-recovery', { eventKey: 'watchdog:1' }).accepted, false);
  assert.deepEqual(cycle.trigger('operator-goal', { eventKey: 'operator-goal:g1', force: true }), { accepted: true, queued: true });
  release({ ok: true });
  await running;
  assert.equal(queued.length, 1, 'the queued operator goal is scheduled after the turn');
  await queued.shift()();
  assert.deepEqual(reasons, ['startup', 'operator-goal']);
});

function memoryFixture() {
  const values = new Map();
  return {
    get: key => values.get(key) ?? null,
    set: (key, value) => values.set(key, structuredClone(value)),
  };
}

test('terminal event schedules exactly one durable next development turn', async () => {
  const memory = memoryFixture();
  const queued = [];
  const turns = [];
  let clock = 10_000;
  const cycle = createDevelopmentCycle({
    memory,
    now: () => clock,
    schedule: fn => queued.push(fn),
    runTurn: async context => turns.push(context),
    cooldownMs: 1_000,
  });

  assert.equal(cycle.trigger('mission-terminal', { eventKey: 'g1:n1:verified' }).accepted, true);
  assert.equal(cycle.trigger('mission-terminal', { eventKey: 'g1:n1:verified' }).accepted, false);
  assert.equal(cycle.state().status, 'scheduled');

  await queued.shift()();
  assert.equal(turns.length, 1);
  assert.equal(cycle.state().status, 'idle');
  assert.equal(cycle.trigger('mission-terminal', { eventKey: 'g1:n1:verified' }).reason, 'duplicate_event');
});

test('failure enters durable backoff instead of silently stopping', async () => {
  const memory = memoryFixture();
  const queued = [];
  let clock = 20_000;
  const cycle = createDevelopmentCycle({
    memory,
    now: () => clock,
    schedule: fn => queued.push(fn),
    runTurn: async () => { throw new Error('provider unavailable'); },
    backoffMs: 5_000,
  });

  cycle.trigger('startup', { eventKey: 'startup:1' });
  await queued.shift()();
  assert.equal(cycle.state().status, 'backoff');
  assert.equal(cycle.state().failures, 1);
  assert.match(cycle.state().last_error, /provider unavailable/);
  const queuedAfterBackoff = cycle.trigger('another-event', { eventKey: 'g2:n1:verified' });
  assert.equal(queuedAfterBackoff.accepted, true);
  assert.equal(queuedAfterBackoff.delay_ms, 5_000);
  assert.equal(cycle.state().status, 'scheduled_backoff');
});

test('watchdog recovers a stale or never-completed cycle', async () => {
  const memory = memoryFixture();
  const queued = [];
  const cycle = createDevelopmentCycle({
    memory,
    now: () => 900_000,
    schedule: fn => queued.push(fn),
    runTurn: async () => ({ ok: true }),
  });

  assert.equal(cycle.watchdog({ staleAfterMs: 300_000 }).accepted, true);
  await queued.shift()();
  assert.equal(cycle.state().status, 'idle');
  assert.equal(cycle.state().last_trigger, 'watchdog-recovery');
});

test('watchdog preserves provider backoff after restart', async () => {
  const memory = memoryFixture();
  memory.set('seer.development_cycle', {
    status: 'backoff', last_started_at: 1000, last_completed_at: null,
    next_eligible_at: 400000, failures: 4,
  });
  const queued = [];
  let attempts = 0;
  const cycle = createDevelopmentCycle({
    memory, now: () => 350000,
    schedule: (fn, delay) => queued.push({ fn, delay }),
    runTurn: async () => { attempts++; },
  });
  assert.equal(cycle.watchdog({ staleAfterMs: 1000 }).delay_ms, 50000);
  assert.equal(attempts, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].delay, 50000);
  assert.equal(cycle.watchdog({ staleAfterMs: 1000 }).reason, 'in_flight');
});

test('when the primary goal already has work, the free slot goes to the next goal without work', () => {
  const primary = { id: 'rev', statement: 'first revenue' };
  const goals = [{ id: 'dist', statement: 'distribution' }, { id: 'old', statement: 'older goal' }, { id: 'rev', statement: 'first revenue' }];
  const busyPrimary = [{ id: 'g1', status: 'ACTIVE', policy: { strategic_goal_id: 'rev' } }];
  // Nothing active: the primary goal is the focus.
  assert.deepEqual(chooseGovernorFocus([], { primary, goals, maxActive: 2 }), { allowed: true, focus: primary, primary: true });
  // Primary busy, one slot left: the next goal in SEER's order, not a skipped turn.
  const next = chooseGovernorFocus(busyPrimary, { primary, goals, maxActive: 2 });
  assert.equal(next.allowed, true);
  assert.equal(next.primary, false);
  assert.equal(next.focus.id, 'dist');
  assert.equal(next.primary_graph_id, 'g1');
  // A goal that already has work is not picked again.
  const both = [...busyPrimary, { id: 'g2', status: 'ACTIVE', policy: { strategic_goal_id: 'dist' } }];
  assert.equal(chooseGovernorFocus(both, { primary, goals, maxActive: 3 }).focus.id, 'old');
  // All slots taken by work that is moving: wait.
  assert.equal(chooseGovernorFocus(both, { primary, goals, maxActive: 2 }).reason, 'active_work_limit');
});

test('graphs waiting on an operator decision free their slot but still block duplicate work', () => {
  const primary = { id: 'rev', statement: 'first revenue' };
  const goals = [{ id: 'dist', statement: 'distribution' }, { id: 'rev', statement: 'first revenue' }];
  const graphs = [
    { id: 'g1', status: 'ACTIVE', policy: { strategic_goal_id: 'rev' } },
    { id: 'g2', status: 'ACTIVE', policy: { strategic_goal_id: 'other' } },
  ];
  assert.equal(chooseGovernorFocus(graphs, { primary, goals, maxActive: 2 }).reason, 'active_work_limit');
  const r = chooseGovernorFocus(graphs, { primary, goals, maxActive: 2, waiting: new Set(['g1']) });
  assert.equal(r.allowed, true);
  assert.equal(r.focus.id, 'dist', 'the waiting primary goal is not planned twice');
  // Every goal taken: nothing new even with a free slot.
  assert.equal(chooseGovernorFocus(graphs, { primary, goals: [primary], maxActive: 3, waiting: new Set(['g1']) }).reason, 'goal_already_active');
});

test('with a goal in focus, a real reversible plan beats doing nothing; without one, idling stays the safe choice', () => {
  // The REV-001 Lite candidate as SEER scored it on 2026-10-09 (it lost 0.569 to 0.643 before this fix).
  const lite = { id: 'lite', success_probability: 0.55, repeatability: 0.7, risk: 0.25, reversibility: 0.9, evidence_quality: 0.3, information_gain: 0.8, strategic_fit: 0.7, human_intervention: 0 };
  assert.equal(rankStrategies([governorBaseline({ hasFocusGoal: true }), lite])[0].id, 'lite');
  // A long shot still loses to idling, so the baseline keeps guarding against weak plans.
  assert.equal(rankStrategies([governorBaseline({ hasFocusGoal: true }), { ...lite, success_probability: 0.1, risk: 0.9, strategic_fit: 0.2, information_gain: 0.2 }])[0].id, 'baseline-no-new-mission');
  assert.equal(rankStrategies([governorBaseline(), lite])[0].id, 'baseline-no-new-mission');
});
