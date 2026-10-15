// Operator 2026-10-03: answers cite their receipts, and the runtime checks the citations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { citedSteps, checkCitations } = await import('../../agents/lib/evidence.mjs');
const { autoResolution } = await import('../../agents/lib/approval-policy.mjs');
const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');

const r = (n, ok = true, verified = ok) => ({ actionId: `m:turn:${n}`, type: 'mcp-call', ok, verified });

test('citations [#n] and [#1, #2] are found and checked against the receipts', () => {
  assert.deepEqual(citedSteps('Python 3.14.8 [#2]; LTS [#1, #3] and [#2]'), [1, 2, 3]);
  assert.deepEqual(citedSteps('no citations here #4'), []);
  assert.deepEqual(checkCitations('A [#1] B [#2]', [r(1), r(2)]), { cited: [1, 2], verified: [1, 2], missing: [], unverified: [], ok: true });
  const bad = checkCitations('A [#1] B [#2] C [#7]', [r(1), r(2, false)]);
  assert.deepEqual([bad.missing, bad.unverified, bad.ok], [[7], [2], false]);
  assert.equal(checkCitations('no cites', [r(1)]).ok, false);
});

test('an answer with a bad citation is left for the operator; good or absent citations are auto-approved as before', () => {
  const mission = { id: 'm', status: 'AWAITING_VERIFICATION', receipts: [r(1), r(2)] };
  assert.equal(autoResolution(mission, { level: 5, evidence: { cited: [1, 9], ok: false } }), null);
  assert.equal(autoResolution(mission, { level: 5, evidence: { cited: [1, 2], ok: true } }).decision, 'confirm');
  assert.equal(autoResolution(mission, { level: 5, evidence: { cited: [], ok: false } }).decision, 'confirm');
  assert.equal(autoResolution(mission, { level: 5 }).decision, 'confirm');
});

test('the runtime stores the citation check with the completion proposal', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-evidence-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = new NovaMissionControl(bus, { allowedTasks: ['health-check'] });
  const m = control.create({ goal: 'Hur mår runtime?', idempotencyKey: 'ev-1' });
  const lease = control.claim(m.id, 'nova');
  const a = control.begin(m.id, { owner: 'nova', token: lease.token, task: { type: 'health-check', data: {} } });
  control.finish(m.id, { owner: 'nova', token: lease.token, actionId: a.id, receipt: { ok: true, verified: true } });
  const again = control.claim(m.id, 'nova');
  control.release(m.id, { owner: 'nova', token: again.token, completionProposed: true, completionReason: 'Runtime svarar [#1], databasen [#2].' });
  const ev = bus.lastMissionEvent(m.id, 'NOVA_PLANNING_RESULT').payload.evidence;
  assert.deepEqual([ev.verified, ev.missing, ev.ok], [[1], [2], false]);
});
