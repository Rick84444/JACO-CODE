import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, runCase, summarize } from '../../tools/eval-web-missions.mjs';

test('a case starts one mission, waits for its answer and judges it against what the page says', async () => {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', new URL(url).pathname]);
    if (url.endsWith('/start-goal')) { globalThis.__goal = JSON.parse(opts.body).goal; return { json: async () => ({ success: true }) }; }
    polls++;
    const status = polls < 2 ? 'ACTIVE' : 'DONE';
    return { json: async () => ({ missions: [{ id: 'm1', goal: globalThis.__goal, status, step: 2, answer: status === 'DONE' ? 'The title is "Example Domains".' : '' }] }) };
  };
  const r = await runCase('http://x', CASES[0], { pollMs: 1, fetchImpl });
  assert.equal(r.pass, true);
  assert.equal(r.status, 'DONE');
  assert.equal(calls.filter(c => c[1].endsWith('/cancel')).length, 0, 'a finished mission is not cancelled');
});

test('a mission that does not finish is cancelled so the next case starts on an empty queue', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push(new URL(url).pathname);
    if (url.endsWith('/start-goal')) { globalThis.__goal2 = JSON.parse(opts.body).goal; return { json: async () => ({}) }; }
    return { json: async () => ({ missions: [{ id: 'm2', goal: globalThis.__goal2, status: 'BLOCKED', answer: '' }] }) };
  };
  const r = await runCase('http://x', CASES[1], { pollMs: 1, timeoutMs: 1000, fetchImpl });
  assert.equal(r.pass, false);
  assert.ok(calls.some(p => p.endsWith('/missions/m2/cancel')));
});

test('the summary gives a rate overall and per case', () => {
  const s = summarize([{ case: 'a', pass: true }, { case: 'a', pass: false }, { case: 'b', pass: true }]);
  assert.deepEqual(s, { passed: 2, total: 3, rate: 67, cases: { a: '1/2', b: '1/1' } });
});
