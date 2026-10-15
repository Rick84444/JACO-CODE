// OpenHands-inspired guards for Nova's agent loop: stuck detection, condensing a long conversation,
// and keeping secrets out of what the model is shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StuckDetector } from '../../agents/lib/stuck-detector.mjs';
import { condenseMessages, conversationChars, SUMMARY_MARK } from '../../agents/lib/condenser.mjs';
import { receiptForModel } from '../../agents/lib/agent-loop.mjs';

const step = (name, args, ok, result, error) => ({ name, args, ok, result, error });

test('stuck: the same call with the same result three times is a repeat; a changed result is not', () => {
  const d = new StuckDetector();
  d.record(step('repo-read', { path: 'a' }, true, { text: 'x' }));
  d.record(step('repo-read', { path: 'a' }, true, { text: 'x' }));
  assert.equal(d.check().stuck, false);
  d.record(step('repo-read', { path: 'a' }, true, { text: 'x' }));
  const v = d.check();
  assert.equal(v.stuck, true); assert.equal(v.kind, 'repeat'); assert.match(v.hint, /repo-read/);
  const ok = new StuckDetector();
  for (const n of [1, 2, 3, 4]) ok.record(step('shell', { command: 'ls' }, true, { out: String(n) }));
  assert.equal(ok.check().stuck, false, 'same call but new results is progress (a poll)');
});

test('stuck: four failures with the same error are a loop even with different arguments', () => {
  const d = new StuckDetector();
  for (const f of ['a', 'b', 'c']) d.record(step('shell', { f }, false, null, 'ENOENT: no such file'));
  assert.equal(d.check().stuck, false);
  d.record(step('shell', { f: 'd' }, false, null, 'ENOENT: no such file'));
  assert.equal(d.check().kind, 'error-loop');
});

test('stuck: A,B,A,B,A,B with identical results is ping-pong; a nudge starts a fresh window', () => {
  const d = new StuckDetector();
  for (let i = 0; i < 3; i++) { d.record(step('git-status', {}, true, { clean: true })); d.record(step('git-diff', {}, true, { diff: '' })); }
  assert.equal(d.check().kind, 'ping-pong');
  assert.equal(d.nudge(), 1);
  assert.equal(d.check().stuck, false);
});

const assistant = (id, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const tool = (id, ok, extra = 'x'.repeat(2000)) => ({ role: 'tool', tool_call_id: id, content: JSON.stringify({ ok, error: ok ? undefined : 'ENOENT', data: extra }) });
const conversation = n => {
  const m = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'goal' }];
  for (let i = 0; i < n; i++) m.push(assistant('c' + i, 'repo-read', { path: `f${i}` }), tool('c' + i, i % 5 !== 0));
  return m;
};

test('condense: under budget nothing changes; over budget old exchanges become one summary and the tail is intact', () => {
  const small = conversation(3);
  assert.equal(condenseMessages(small, { maxChars: 100_000 }).condensed, false);
  const big = conversation(40);
  const out = condenseMessages(big, { maxChars: 20_000, keepLast: 10 });
  assert.equal(out.condensed, true);
  assert.deepEqual(out.messages.slice(0, 2), big.slice(0, 2), 'system and mission message stay');
  assert.equal(out.messages[2].role, 'user');
  assert.ok(out.messages[2].content.startsWith(SUMMARY_MARK));
  assert.match(out.messages[2].content, /repo-read\(\{"path":"f0"\}\) -> failed: ENOENT/);
  assert.match(out.messages[2].content, /repo-read\(\{"path":"f1"\}\) -> ok/);
  assert.deepEqual(out.messages.slice(3), big.slice(big.length - 10), 'the most recent exchanges are kept verbatim');
  assert.equal(out.dropped.length + out.messages.length - 1, big.length, 'nothing is lost: the dropped messages are returned for the full log');
  assert.ok(conversationChars(out.messages) < conversationChars(big) / 2);
});

test('condense: the tail never starts with an orphan tool result, and a second pass keeps the first summary', () => {
  const big = conversation(40);
  for (const keep of [9, 10, 11]) {
    const out = condenseMessages(big, { maxChars: 20_000, keepLast: keep });
    assert.notEqual(out.messages[3].role, 'tool');
    const ids = new Set(out.messages.filter(m => m.tool_calls).flatMap(m => m.tool_calls.map(c => c.id)));
    for (const m of out.messages.filter(m => m.role === 'tool')) assert.ok(ids.has(m.tool_call_id), 'every kept tool result still has its call');
  }
  const first = condenseMessages(big, { maxChars: 20_000, keepLast: 10 }).messages;
  const grown = [...first, ...conversation(40).slice(2)];
  const second = condenseMessages(grown, { maxChars: 20_000, keepLast: 10 });
  assert.equal(second.messages.filter(m => m.content?.startsWith?.(SUMMARY_MARK)).length, 1, 'one summary, not a stack');
  assert.match(second.messages[2].content, /f0/, 'the earlier summary lines survive');
});

test('what the model is shown has secrets replaced by handles', () => {
  const key = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx0123456789';
  const shown = receiptForModel(1, { ok: true, verified: true, result: { stdout: `OPENAI_API_KEY=${key}\nall good` } });
  assert.ok(!shown.includes(key), shown);
  assert.match(shown, /all good/);
  assert.match(shown, /secret:/);
});
