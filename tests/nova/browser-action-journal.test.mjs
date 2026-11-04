import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserActionJournal } from '../../agents/lib/browser-action-journal.mjs';

async function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'jaco-browser-journal-'));
  try { await run(createBrowserActionJournal(dir), dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const action = (actionId = 'action_12345678') => ({ actionId, kind: 'click', payload: { selector: '#save', expectedUrl: 'https://test.invalid' } });
test('verified action survives journal restart without second write', async () => fixture(async (journal, dir) => {
  let calls = 0;
  const first = await journal.execute({ ...action(), perform: async () => { calls++; return { ok: true, verified: true }; } });
  assert.equal(first.verified, true);
  const again = await createBrowserActionJournal(dir).execute({ ...action(), perform: async () => { calls++; throw Error('duplicate'); } });
  assert.equal(again.replayed, true);
  assert.equal(again.receiptId, first.receiptId);
  assert.equal(calls, 1);
}));
test('same id with different input or operation is rejected', async () => fixture(async journal => {
  await journal.execute({ ...action(), perform: async () => ({ ok: true, verified: true }) });
  const conflict = await journal.execute({ ...action(), payload: { selector: '#delete' }, perform: async () => assert.fail('called') });
  assert.equal(conflict.error, 'ACTION_ID_CONFLICT');
}));
test('unknown write cannot be replayed after response loss or restart', async () => fixture(async (journal, dir) => {
  let calls = 0;
  const first = await journal.execute({ ...action(), perform: async () => { calls++; throw Error('lost'); } });
  assert.equal(first.outcomeUnknown, true);
  const second = await createBrowserActionJournal(dir).execute({ ...action(), perform: async () => { calls++; } });
  assert.equal(second.error, 'ACTION_RECONCILIATION_REQUIRED');
  assert.equal(second.outcomeUnknown, true);
  assert.equal(calls, 1);
}));
test('concurrent requests dispatch once', async () => fixture(async journal => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const perform = async () => { calls++; await gate; return { ok: true, verified: true }; };
  const p = journal.execute({ ...action(), perform });
  const duplicate = await journal.execute({ ...action(), perform });
  assert.equal(duplicate.outcomeUnknown, true);
  release();
  assert.equal((await p).verified, true);
  assert.equal(calls, 1);
}));
test('unverified postcondition is not promoted to success', async () => fixture(async journal => {
  const first = await journal.execute({ ...action(), perform: async () => ({ ok: true, verified: false }) });
  assert.equal(first.outcomeUnknown, true);
  assert.equal(first.verified, false);
  assert.equal((await journal.execute({ ...action(), perform: async () => assert.fail('called') })).error, 'ACTION_RECONCILIATION_REQUIRED');
}));
