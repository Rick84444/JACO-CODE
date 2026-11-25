// The planner is offered desktop-action but the Nova executor had no case for it: every attempt ended UNKNOWN_TASK_TYPE with an
// unknown outcome and the mission stopped for good (2026-11-23, drills Q5 and Q6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopMower, DESKTOP_ACTION_TYPES, executeTask } from '../../agents/hands-off-agent.mjs';

const sent = [];
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  sent.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ success: true, receipt: { verified: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
test.afterEach(() => { globalThis.fetch = realFetch; });

test('a valid desktop action reaches the hands-off action endpoint like desktop-invoke does', async () => {
  const result = await desktopMower.action({ type: 'set_value', hwnd: 4260720, selector: { controlType: 'Document' }, text: 'x' });
  assert.equal(result.success, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/desktop\/hands-off\/action$/);
  assert.deepEqual(sent[0].body, { type: 'set_value', hwnd: 4260720, selector: { controlType: 'Document' }, text: 'x' });
});

test('an unknown type, an observation, a missing window or a non-integer window never reaches the surface', async () => {
  for (const action of [undefined, null, {}, { type: 'observe', hwnd: 5 }, { type: 'format_disk', hwnd: 5 }, { type: 'invoke' }, { type: 'invoke', hwnd: 0 }, { type: 'invoke', hwnd: '5' }, { type: 'invoke', hwnd: 5.5 }]) {
    const result = await desktopMower.action(action);
    assert.equal(result.ok, false, JSON.stringify(action));
    assert.equal(result.outcomeUnknown, false, 'a refused request is a definite failure, not an unknown outcome');
  }
  assert.equal(sent.length, 0);
  assert.deepEqual([...DESKTOP_ACTION_TYPES].sort(), ['collapse', 'expand', 'focus', 'invoke', 'scroll', 'select', 'set_value', 'toggle']);
});

test('executeTask dispatches desktop-action instead of failing with UNKNOWN_TASK_TYPE', async () => {
  const result = await executeTask({ id: 't1', type: 'desktop-action', data: { action: { type: 'focus', hwnd: 7 } } }, { errors: [], surfaces: {}, taskQueue: [] }, { id: 'm1', allowedTasks: ['desktop-action'] });
  assert.notEqual(result?.error, 'UNKNOWN_TASK_TYPE:desktop-action');
  assert.equal(result?.outcomeUnknown === true && /UNKNOWN_TASK_TYPE/.test(String(result?.error)), false);
  assert.ok(sent.some(r => /hands-off\/action$/.test(r.url)));
});

// Q9: the write verified; Aura repeated the identical set_value, the field already held the value, the surface saw no change and
// reported it unverified, and the loop stopped the mission with an unknown outcome.
import { verifiedRepeatOf } from '../../agents/hands-off-agent.mjs';
const setValue = text => ({ type: 'desktop-action', data: { action: { type: 'set_value', hwnd: 4260720, selector: { name: 'Textredigerare', controlType: 'Document' }, text } } });
const receipt = (turn, type, ok, verified, input = {}) => ({ actionId: `m:turn:${turn}`, type, ok, verified, input });

test('an identical set_value after a verified one is answered as already done, not sent again', async () => {
  const first = receipt(3, 'desktop-action', true, true, setValue('Aura Q9').data);
  const mission = { id: 'm', receipts: [first, receipt(4, 'desktop-observe', true, true)] };
  assert.equal(verifiedRepeatOf(setValue('Aura Q9'), mission), 3);
  const result = await executeTask({ id: 't', type: 'desktop-action', data: setValue('Aura Q9').data }, { errors: [], surfaces: {}, taskQueue: [] }, mission);
  assert.equal(result.ok, false);
  assert.equal(result.outcomeUnknown, false, 'a definite answer the loop can recover from, not an unknown outcome');
  assert.match(result.error, /^STEP_ALREADY_VERIFIED:turn 3/);
  assert.equal(sent.length, 0, 'nothing reaches the surface');
});

test('a different text, a failed first attempt or a change in between is not a repeat', () => {
  const first = receipt(3, 'desktop-action', true, true, setValue('Aura Q9').data);
  assert.equal(verifiedRepeatOf(setValue('Something else'), { receipts: [first] }), null);
  assert.equal(verifiedRepeatOf(setValue('Aura Q9'), { receipts: [receipt(3, 'desktop-action', false, false, setValue('Aura Q9').data)] }), null);
  assert.equal(verifiedRepeatOf(setValue('Aura Q9'), { receipts: [first, receipt(4, 'type-text', true, true)] }), null, 'the field may have changed');
  assert.equal(verifiedRepeatOf({ type: 'desktop-action', data: { action: { type: 'focus', hwnd: 1 } } }, { receipts: [first] }), null, 'only set_value is treated as idempotent');
  assert.equal(verifiedRepeatOf(setValue('Aura Q9'), { receipts: [] }), null);
  assert.equal(verifiedRepeatOf(setValue('Aura Q9'), {}), null);
});
