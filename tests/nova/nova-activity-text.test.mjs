// Operator 2026-10-02: the IDE must make clear what Nova executes: which action, on what, with which result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { describeNovaTask, describeNovaResult, summarizeNovaMission } = await import('../../runtime/src/lib/novaActivityText.ts');
const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');

test('actions are named with what they act on', () => {
  assert.equal(describeNovaTask({ type: 'github-create-repo', data: { name: 'cloudflare-ts-deploy', private: true } }), 'skapa GitHub-repo cloudflare-ts-deploy (privat)');
  assert.equal(describeNovaTask({ type: 'repo-write', data: { path: 'tests/nova/x.test.mjs' } }), 'skriv filen tests/nova/x.test.mjs');
  assert.equal(describeNovaTask({ type: 'repo-test', data: { command: 'npm test', kind: 'falsifier' } }), 'kör falsifieringstest: npm test');
  assert.equal(describeNovaTask({ type: 'browser-click', data: { name: 'Create repository' } }), 'klicka på "Create repository"');
  assert.equal(describeNovaTask({ type: 'something-new' }), 'something-new');
});

test('results show the link, or the error, and never claim more than the receipt', () => {
  const repo = { ok: true, verified: true, result: { url: 'https://github.com/Rick84444/cloudflare-ts-deploy', existed: false } };
  assert.deepEqual(describeNovaResult(repo), { text: 'https://github.com/Rick84444/cloudflare-ts-deploy', url: 'https://github.com/Rick84444/cloudflare-ts-deploy', state: 'verified' });
  assert.equal(describeNovaResult({ ok: true, verified: true, result: { url: 'https://x.test', existed: true } }).text, 'fanns redan');
  assert.equal(describeNovaResult({ ok: true, verified: false, result: {} }).state, 'unverified');
  assert.deepEqual(describeNovaResult({ ok: false, verified: false, error: 'NO_TARGET' }), { text: 'misslyckades: NO_TARGET', url: null, state: 'failed' });
  assert.equal(describeNovaResult({ ok: false, result: { url: 'javascript:alert(1)' } }).url, null);
  const contradictory = [
    {ok:false,verified:true,error:'FAILED'},
    {ok:true,verified:true,result:{exitCode:1}},
    {ok:true,verified:true,result:{error:'DENIED'}},
    {ok:true,verified:true,outcomeUnknown:true},
  ];
  for(const receipt of contradictory) assert.notEqual(describeNovaResult(receipt).state,'verified');
  assert.equal(summarizeNovaMission({receipts:contradictory}).verifiedReceipts,0);
});

test('a mission summary names its last action from the bus and its step budget', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-activity-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = new NovaMissionControl(bus);
  const m = control.create({ goal: 'Create a private GitHub repository named "demo-repo".', idempotencyKey: 'activity-1' });
  const lease = control.claim(m.id, 'nova');
  const action = control.begin(m.id, { owner: 'nova', token: lease.token, task: { type: 'github-create-repo', data: { name: 'demo-repo' } } });
  const started = bus.lastMissionEvent(m.id, 'NOVA_ACTION_STARTED');
  assert.equal(started.payload.action.id, action.id);
  const running = summarizeNovaMission(control.get(m.id), started.payload.action);
  assert.deepEqual([running.lastAction.running, running.lastAction.text], [true, 'skapa GitHub-repo demo-repo (privat)']);
  control.finish(m.id, { owner: 'nova', token: lease.token, actionId: action.id, receipt: { ok: true, verified: true, result: { url: 'https://github.com/o/demo-repo' } } });
  const done = summarizeNovaMission(control.get(m.id), bus.lastMissionEvent(m.id, 'NOVA_ACTION_STARTED').payload.action);
  assert.equal(done.lastAction.running, false);
  assert.equal(done.lastAction.text, 'skapa GitHub-repo demo-repo (privat)');
  assert.equal(done.lastAction.result.url, 'https://github.com/o/demo-repo');
  assert.deepEqual([done.step, done.maxSteps, done.verifiedReceipts], [1, null, 1]);
  assert.equal(bus.lastMissionEvent(m.id, 'NO_SUCH_EVENT'), null);
  assert.equal(done.answer, null);

  // The completion reason is kept and shown as the mission's answer.
  const again = control.claim(m.id, 'nova');
  control.release(m.id, { owner: 'nova', token: again.token, completionProposed: true, completionReason: '  Created https://github.com/o/demo-repo (receipt 1).  ' });
  const planned = bus.lastMissionEvent(m.id, 'NOVA_PLANNING_RESULT');
  assert.equal(planned.payload.reason, 'Created https://github.com/o/demo-repo (receipt 1).');
  assert.equal(summarizeNovaMission(control.get(m.id), null, planned.payload.reason).answer, 'Created https://github.com/o/demo-repo (receipt 1).');
});

test('the planner\'s completion reason travels with the completion proposal', async () => {
  const { processMissionTurn } = await import('../../agents/lib/mission-client.mjs');
  const released = [];
  const client = {
    current: async () => ({ id: 'm1', status: 'ACTIVE' }),
    claim: async () => ({ mission: { id: 'm1' }, token: 't' }),
    release: async (id, input) => { released.push(input); },
  };
  const out = await processMissionTurn({ client, owner: 'nova', plan: async () => ({ complete: true, reason: 'The last 5 commits changed skills/ and agents/lib/.' }), execute: async () => ({}) });
  assert.equal(out.awaitingVerification, true);
  assert.deepEqual(released, [{ owner: 'nova', token: 't', completionProposed: true, completionReason: 'The last 5 commits changed skills/ and agents/lib/.' }]);
});
