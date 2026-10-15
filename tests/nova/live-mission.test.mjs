// The live build view streams liveMissionView: steps in order with readable result text, bounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveMissionView, resultText } from '../../runtime/src/server/connected/liveMission.mjs';

test('steps carry type, input, state and the readable part of the result', () => {
  const v = liveMissionView({ id: 'm1', goal: 'Lägg till en rubrik', status: 'ACTIVE', phase: 'EXECUTING',
    activeTask: { type: 'repo-test', data: { command: 'npm test' } },
    receipts: [
      { type: 'repo-read', input: { path: 'a.md' }, ok: true, verified: true, result: { content: '# A' } },
      { type: 'repo-edit', input: { path: 'a.md', old: '# A', new: '# B' }, ok: true, verified: true, result: { path: 'a.md' } },
      { type: 'shell', input: { command: 'x' }, ok: false, verified: false, error: 'EXIT_1', result: { stderr: 'boom' } },
    ] }, 'svar');
  assert.deepEqual(v.steps.map(s => [s.n, s.type, s.ok, s.verified]), [[1, 'repo-read', true, true], [2, 'repo-edit', true, true], [3, 'shell', false, false]]);
  assert.equal(v.steps[0].text, '# A');
  assert.equal(v.steps[2].text, 'boom');
  assert.equal(v.steps[2].error, 'EXIT_1');
  assert.deepEqual(v.activeTask, { type: 'repo-test', data: { command: 'npm test' } });
  assert.equal(v.answer, 'svar');
});

test('MCP content, nested results and sizes are bounded', () => {
  assert.equal(resultText({ result: { content: [{ type: 'text', text: 'log' }] } }), 'log');
  assert.equal(resultText({ ok: true }), null);
  assert.ok(resultText('x'.repeat(10000)).length < 4100);
  const many = Array.from({ length: 60 }, (_, i) => ({ type: 'repo-read', input: { path: `f${i}` }, ok: true, verified: true }));
  const v = liveMissionView({ id: 'm', goal: 'g', status: 'ACTIVE', receipts: many });
  assert.equal(v.steps.length, 40);
  assert.equal(v.steps[0].n, 21, 'step numbers stay those of the mission');
  assert.equal(v.steps.at(-1).n, 60);
});
