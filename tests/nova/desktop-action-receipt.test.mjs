import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopActionRequest } from '../../agents/hands-off-agent.mjs';

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const action = { type: 'invoke', hwnd: 13244066, selector: { name: 'Textredigerare' } };

// Observed 2026-11-22: invoking Notepad's text box (no Invoke pattern) came back as RUNTIME_HTTP_409 with
// outcomeUnknown, and the mission stopped instead of typing with the keyboard.
test('an unverified desktop action keeps its real reason and is a definite, recoverable failure', async () => {
  const r = await desktopActionRequest(action, { fetchImpl: reply(409, { success: false, receipt: { success: false, verified: false, error: 'element does not support InvokePattern' } }) });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'element does not support InvokePattern');
  assert.equal(r.outcomeUnknown, false);
});

test('a policy refusal is reported as such, never as unknown', async () => {
  const r = await desktopActionRequest(action, { fetchImpl: reply(403, { success: false, receipt: { success: false, verified: false, refusal: 'no active desktop hands-off grant' } }) });
  assert.equal(r.ok, false);
  assert.equal(r.outcomeUnknown, false);
});

test('a server fault or lost transport stays an unknown outcome that must not be repeated blindly', async () => {
  assert.equal((await desktopActionRequest(action, { fetchImpl: reply(500, { success: false }) })).outcomeUnknown, true);
  assert.equal((await desktopActionRequest(action, { fetchImpl: async () => { throw new Error('socket hang up'); } })).outcomeUnknown, true);
});

test('a verified action succeeds with its receipt', async () => {
  const r = await desktopActionRequest(action, { fetchImpl: reply(200, { success: true, receipt: { success: true, verified: true } }) });
  assert.equal(r.ok, true);
  assert.equal(r.verified, true);
});
