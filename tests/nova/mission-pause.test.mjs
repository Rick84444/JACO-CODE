// Contract: an operator pause is durable, stops new tools without aborting a running one, never starves later
// missions, keeps the operator's change (steer) and end (cancel) available, and is lifted only by the operator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl, mountNovaMissionRoutes } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { MissionClient } from '../../agents/lib/mission-client.mjs';
import { plannerTools } from '../../agents/lib/native-tools.mjs';
import { runAgentMission } from '../../agents/lib/agent-loop.mjs';

const OWNER = 'nova-test';
const task = (type, data) => ({ type, data, expectedOutcome: 'observed' });
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-pause-'));
  const bus = new DurableMissionBus(dir);
  const control = new NovaMissionControl(bus);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, bus, control };
}

test('a paused mission gives no new lease and starts no new tool; resume lifts it', t => {
  const { control, bus } = setup(t);
  const m = control.create({ goal: 'read the repo', idempotencyKey: 'p1', allowedTasks: ['web-fetch', 'health-check'] });
  assert.equal(control.get(m.id).paused, null);
  const paused = control.pause(m.id, 'operator pause');
  assert.equal(paused.status, 'ACTIVE', 'a pause keeps the mission status');
  assert.equal(paused.paused.note, 'operator pause');
  assert.throws(() => control.claim(m.id, OWNER), /MISSION_PAUSED/);
  assert.equal(control.pause(m.id).paused.revision, paused.paused.revision, 'pausing twice records one pause');
  const resumed = control.resumePaused(m.id);
  assert.equal(resumed.paused, null);
  const lease = control.claim(m.id, OWNER);
  assert.equal(control.begin(m.id, { owner: OWNER, token: lease.token, task: task('web-fetch', { url: 'https://a.test' }) }).type, 'web-fetch');
  const types = bus.listEvents(20).map(e => e.type);
  assert.ok(types.includes('NOVA_OPERATOR_PAUSE') && types.includes('NOVA_OPERATOR_PAUSE_END'));
});

test('a pause during planning stops the next tool; a running tool still records its receipt', t => {
  const { control } = setup(t);
  const m = control.create({ goal: 'read two files', idempotencyKey: 'p2', allowedTasks: ['web-fetch'] });
  // Planning lease held, then the operator pauses: begin is refused, the lease can still be given back.
  let lease = control.claim(m.id, OWNER);
  control.pause(m.id);
  assert.throws(() => control.begin(m.id, { owner: OWNER, token: lease.token, task: task('web-fetch', { url: 'https://a.test' }) }), /MISSION_PAUSED/);
  control.release(m.id, { owner: OWNER, token: lease.token });
  control.resumePaused(m.id);
  // A tool that is already running when the pause arrives finishes and its receipt is kept.
  lease = control.claim(m.id, OWNER);
  const begun = control.begin(m.id, { owner: OWNER, token: lease.token, task: task('web-fetch', { url: 'https://b.test' }) });
  control.pause(m.id);
  const after = control.finish(m.id, { owner: OWNER, token: lease.token, actionId: begun.id, receipt: { ok: true, verified: true, result: { entries: 3 } } });
  assert.equal(after.receipts.length, 1);
  assert.equal(after.receipts[0].ok, true);
  assert.ok(after.paused, 'the pause is still in force after the receipt');
  assert.throws(() => control.claim(m.id, OWNER), /MISSION_PAUSED/);
});

test('a paused mission is not the queue head: later work runs, and the pause survives a restart', t => {
  const { control, dir } = setup(t);
  const first = control.create({ goal: 'first', idempotencyKey: 'p3a', allowedTasks: ['web-fetch'] });
  const second = control.create({ goal: 'second', idempotencyKey: 'p3b', allowedTasks: ['web-fetch'] });
  assert.equal(control.current().id, first.id);
  control.pause(first.id);
  assert.equal(control.current().id, second.id, 'the next mission is offered while the first is paused');
  assert.equal(control.claim(second.id, OWNER).mission.id, second.id);
  // A new control over the same ledger sees the pause.
  const reopened = new NovaMissionControl(new DurableMissionBus(dir));
  assert.ok(reopened.get(first.id).paused);
  assert.throws(() => reopened.claim(first.id, OWNER), /MISSION_PAUSED/);
  reopened.bus.close();
});

test('the operator can still change direction or end a paused mission; terminal missions cannot be paused', t => {
  const { control } = setup(t);
  const m = control.create({ goal: 'write a note', idempotencyKey: 'p4', allowedTasks: ['web-fetch'] });
  control.pause(m.id);
  const steered = control.steer(m.id, { instruction: 'Write it in Swedish instead.', requestId: '3f1c2b4a-1111-4222-8333-444455556666' });
  assert.equal(steered.replayed, false);
  assert.equal(control.get(m.id).steering.instruction, 'Write it in Swedish instead.');
  const ended = control.requestCancel(m.id, 'operator ends it');
  assert.equal(ended.status, 'CANCELLED');
  assert.equal(control.get(m.id).paused, null, 'a terminal mission reports no pause');
  assert.throws(() => control.pause(m.id), /MISSION_TERMINAL/);
});

test('the operator decision to continue a blocked mission also lifts its pause; an automated resume does not', t => {
  const { control } = setup(t);
  const m = control.create({ goal: 'blocked work', idempotencyKey: 'p5', allowedTasks: ['web-fetch'] });
  const lease = control.claim(m.id, OWNER);
  control.release(m.id, { owner: OWNER, token: lease.token, error: 'PLANNER_BLOCKED:needs the operator' });
  assert.equal(control.get(m.id).status, 'BLOCKED');
  control.pause(m.id);
  control.resolve(m.id, { decision: 'resume', note: 'auto-resumed (level 5): transient', authority: 'operator' });
  assert.equal(control.get(m.id).status, 'ACTIVE');
  assert.ok(control.get(m.id).paused, 'an automated resume leaves the operator pause in force');
  assert.throws(() => control.claim(m.id, OWNER), /MISSION_PAUSED/);
  // Back to blocked, then the operator's own decision.
  control.resumePaused(m.id);
  const again = control.claim(m.id, OWNER);
  control.release(m.id, { owner: OWNER, token: again.token, error: 'PLANNER_BLOCKED:needs the operator again' });
  control.pause(m.id);
  control.resolve(m.id, { decision: 'resume', note: 'Operator decision from the Gameboard: resume', authority: 'operator' });
  assert.equal(control.get(m.id).paused, null, 'the operator continuing means go on');
  assert.equal(control.claim(m.id, OWNER).mission.id, m.id);
});

test('the agent loop yields a paused mission without planning and continues after resume', async t => {
  const { control, bus } = setup(t);
  const routes = new Map();
  mountNovaMissionRoutes({ get: (p, ...f) => routes.set('GET ' + p, f), post: (p, ...f) => routes.set('POST ' + p, f) }, () => {}, control);
  const client = new MissionClient('http://offline', 'test-token', async (url, opts) => {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/missions\/([^/]+)(\/.*)?$/);
    const handlers = routes.get(opts.method + ' ' + (match ? pathname.replace(match[1], ':id') : pathname));
    let status = 200, data;
    handlers.at(-1)({ body: opts.body ? JSON.parse(opts.body) : undefined, params: { id: match?.[1] }, query: Object.fromEntries(new URL(url).searchParams) },
      { status(n) { status = n; return this; }, json(v) { data = v; } });
    return { ok: status === 200, status, json: async () => data };
  });
  const m = control.create({ goal: 'fetch two pages', idempotencyKey: 'p6', allowedTasks: ['web-fetch'] });
  const calls = [];
  let modelTurns = 0;
  const chat = async () => {
    modelTurns++;
    // After the first tool, the operator pauses: the loop must not ask the model again until resumed.
    if (modelTurns === 1) return { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web-fetch', arguments: JSON.stringify({ url: 'https://a.test' }) } }] };
    return { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'complete', arguments: JSON.stringify({ reason: 'done [#1]' }) } }] };
  };
  const run = () => runAgentMission({ client, owner: OWNER, chat, system: 'test', toolsFor: mission => plannerTools(mission.allowedTasks, [], {}, false),
    execute: async taskRun => { calls.push(taskRun.data.url); control.pause(m.id); return { ok: true, verified: true, content: 'A' }; } });
  const first = await run();
  assert.equal(first.deferred, true);
  assert.equal(first.reason, 'MISSION_PAUSED');
  assert.deepEqual(calls, ['https://a.test'], 'the running fetch finished; nothing else ran');
  assert.equal(modelTurns, 1, 'no model turn while paused');
  assert.equal(control.get(m.id).receipts.length, 1);
  // While paused the loop does not even pick the mission up.
  const idle = await run();
  assert.equal(idle.executed, false);
  assert.equal(modelTurns, 1);
  control.resumePaused(m.id);
  const second = await run();
  assert.equal(second.completed, true);
  assert.equal(control.get(m.id).status, 'AWAITING_VERIFICATION');
  assert.ok(bus.listEvents(50).some(e => e.type === 'NOVA_OPERATOR_PAUSE_END'));
});
