import test from 'node:test';
import assert from 'node:assert/strict';
import { boundChatHistory } from '../../runtime/src/lib/chatHistory.mjs';

test('twenty very long answers are bounded and the newest message is kept whole', () => {
  const long = 'x'.repeat(6000);
  const items = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', content: i === 19 ? 'senaste frågan' : long }));
  const out = boundChatHistory(items);
  const total = out.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= 8000 + 1200, `history is ${total} chars`);
  assert.equal(out.at(-1).content, 'senaste frågan', 'the newest message is kept');
  assert.ok(out.every(m => m.content.length <= 1200));
});

test('a short history is passed through unchanged', () => {
  const items = [{ role: 'user', content: 'hej' }, { role: 'model', content: 'hej på dig' }];
  assert.deepEqual(boundChatHistory(items), items);
});

test('the newest message is never dropped even when it alone exceeds the budget', () => {
  const out = boundChatHistory([{ role: 'user', content: 'y'.repeat(9000) }], { maxTotalChars: 100 });
  assert.equal(out.length, 1);
});
