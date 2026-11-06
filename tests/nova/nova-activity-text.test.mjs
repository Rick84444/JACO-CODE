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
  assert.equal(describeNovaTask({ type: 'github-create-repo', data: { name: 'cloudflare-ts-deploy', private: true } }), 'create GitHub repo cloudflare-ts-deploy (private)');
  assert.equal(describeNovaTask({ type: 'repo-write', data: { path: 'tests/nova/x.test.mjs' } }), 'write file tests/nova/x.test.mjs');
  assert.equal(describeNovaTask({ type: 'repo-test', data: { command: 'npm test', kind: 'falsifier' } }), 'run falsifier test: npm test');
  assert.equal(describeNovaTask({ type: 'browser-click', data: { name: 'Create repository' } }), 'click "Create repository"');
  assert.equal(describeNovaTask({ type: 'something-new' }), 'something-new');
});

test('results show the link, or the error, and never claim more than the receipt', () => {
  const repo = { ok: true, verified: true, result: { url: 'https://github.com/Rick84444/cloudflare-ts-deploy', existed: false } };
  assert.deepEqual(describeNovaResult(repo), { text: 'https://github.com/Rick84444/cloudflare-ts-deploy', url: 'https://github.com/Rick84444/cloudflare-ts-deploy', state: 'verified' });
  assert.equal(describeNovaResult({ ok: true, verified: true, result: { url: 'https://x.test', existed: true } }).text, 'already existed');
  assert.equal(describeNovaResult({ ok: true, verified: false, result: {} }).state, 'unverified');
  assert.deepEqual(describeNovaResult({ ok: false, verified: false, error: 'NO_TARGET' }), { text: 'failed: NO_TARGET', url: null, state: 'failed' });
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
  assert.deepEqual([running.lastAction.running, running.lastAction.text], [true, 'create GitHub repo demo-repo (private)']);
  control.finish(m.id, { owner: 'nova', token: lease.token, actionId: action.id, receipt: { ok: true, verified: true, result: { url: 'https://github.com/o/demo-repo' } } });
  const done = summarizeNovaMission(control.get(m.id), bus.lastMissionEvent(m.id, 'NOVA_ACTION_STARTED').payload.action);
  assert.equal(done.lastAction.running, false);
  assert.equal(done.lastAction.text, 'create GitHub repo demo-repo (private)');
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

test('Aura mission summary includes only safe graph ID so Avsluta mål is actionable', () => {
  const mission = {
    id:'mission-1', goal:'Inspect runtime', status:'ACTIVE',
    metadata:{ parent:{graphId:'mvvq24c5-5nsaa',privateToken:'DO_NOT_EXPOSE'},secrets:'DO_NOT_EXPOSE'},
  };
  const summary=summarizeNovaMission(mission);
  assert.deepEqual(summary.metadata,{parent:{graphId:'mvvq24c5-5nsaa'}});
  assert.doesNotMatch(JSON.stringify(summary),/DO_NOT_EXPOSE/);
  const invalid=summarizeNovaMission({...mission,metadata:{parent:{graphId:'../unsafe?secret=1'}}});
  assert.equal(invalid.metadata,undefined);
});

test('a finished step says what it did in plain words, and the final answer is titled as the answer', async () => {
  const { toCognitiveEvent } = await import('../../runtime/src/lib/cognitiveEvents.mjs');
  const at = new Date().toISOString();
  const event = (type, payload, id) => toCognitiveEvent({ type, payload, at, id, mission_id: 'm1' });
  const clicked = event('NOVA_ACTION_RESULT', { ok: true, verified: true, type: 'browser-click', result: { ok: true, verified: true, observation: { url: 'https://www.iana.org/help/example-domains', title: 'Example Domains' } } }, 'a');
  assert.equal(clicked.text, 'Clicked and landed on \u201cExample Domains\u201d (www.iana.org/help/example-domains).');
  const opened = event('NOVA_ACTION_RESULT', { ok: true, verified: true, type: 'browser-survey-site', result: { ok: true, url: 'https://example.com/', title: 'Example Domain' } }, 'b');
  assert.equal(opened.text, 'Opened \u201cExample Domain\u201d (example.com) and read it.');
  const missed = event('NOVA_ACTION_RESULT', { ok: false, type: 'browser-click', error: 'NO_TARGET', result: { ok: false, error: 'NO_TARGET' } }, 'c');
  assert.equal(missed.text, 'The click did not work: the page has no such link or button.');
  const unverified = event('NOVA_ACTION_RESULT', { ok: true, verified: false, type: 'browser-type', result: { ok: true } }, 'd');
  assert.equal(unverified.text, 'Typed into the field (not verified yet).');
  const answer = event('NOVA_PLANNING_RESULT', { error: null, completionProposed: true, reason: 'The title is Example Domains [1].' }, 'e');
  assert.equal(answer.title, 'Answer');
  assert.equal(event('NOVA_PLANNING_RESULT', { error: null, completionProposed: false }, 'f'), null, 'an empty planning pause is not shown');
  assert.equal(event('NOVA_PLANNING_RESULT', { error: 'PLANNER_BLOCKED:x', completionProposed: false }, 'g').title, 'Stopped');
});

test('a failed command or test says what the program reported, not just that it failed', async () => {
  const { toCognitiveEvent } = await import('../../runtime/src/lib/cognitiveEvents.mjs');
  const e = toCognitiveEvent({ type: 'NOVA_ACTION_RESULT', at: new Date().toISOString(), id: 'x1', mission_id: 'm1',
    payload: { ok: false, type: 'repo-test', error: 'Command failed: npm test', result: { ok: false, stderr: 'npm warn\nError: Cannot find module \'dotenv\'\n    at foo' } } });
  assert.equal(e.text, 'The tests failed: Error: Cannot find module \'dotenv\'.');
});

test('with Swedish chosen, the live feed is wholly Swedish; with English, wholly English', async () => {
  const { toCognitiveEvent } = await import('../../runtime/src/lib/cognitiveEvents.mjs');
  const at = new Date().toISOString();
  const ev = (type, payload, id, language) => toCognitiveEvent({ type, payload, at, id, mission_id: 'm1' }, { language });
  const click = { ok: true, verified: true, type: 'browser-click', actionId: 'm1:turn:3', result: { ok: true, verified: true, observation: { url: 'https://www.iana.org/domains', title: 'Domains' } } };
  assert.equal(ev('NOVA_ACTION_RESULT', click, 'a', 'sv').text, 'Steg 3: Klickade och kom till \u201cDomains\u201d (www.iana.org/domains).');
  assert.equal(ev('NOVA_ACTION_RESULT', click, 'b', 'en').text, 'Step 3: Clicked and landed on \u201cDomains\u201d (www.iana.org/domains).');
  const missed = { ok: false, type: 'browser-click', error: 'NO_TARGET', result: { ok: false, error: 'NO_TARGET' } };
  assert.equal(ev('NOVA_ACTION_RESULT', missed, 'c', 'sv').text, 'Klicket fungerade inte: sidan har ingen sådan länk eller knapp.');
  const answer = ev('NOVA_PLANNING_RESULT', { completionProposed: true, reason: 'Klart.' }, 'd', 'sv');
  assert.equal(answer.title, 'Svar');
  assert.equal(ev('NOVA_ACTION_STARTED', { action: { type: 'repo-read', data: {} } }, 'e', 'sv').text, 'Läser en fil.');
  assert.equal(ev('NOVA_ACTION_STARTED', { action: { type: 'repo-read', data: {} } }, 'f', 'en').text, 'Reading a file.');
  assert.equal(ev('MISSION_CREATED', {}, 'g', 'sv').title, 'Uppdrag mottaget');
});
