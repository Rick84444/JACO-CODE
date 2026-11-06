import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_FEED_PAGE, chatFeedWindow, isLongChatMessage } from '../../runtime/src/lib/chatFeedWindow.mjs';

test('the chat shows the latest items and counts what is older', () => {
  const feed = Array.from({ length: CHAT_FEED_PAGE + 5 }, (_, i) => i);
  const first = chatFeedWindow(feed);
  assert.equal(first.visible.length, CHAT_FEED_PAGE);
  assert.equal(first.visible.at(-1), feed.at(-1));
  assert.equal(first.olderCount, 5);
  assert.deepEqual(chatFeedWindow(feed, feed.length), { visible: feed, olderCount: 0 });
  assert.deepEqual(chatFeedWindow(undefined), { visible: [], olderCount: 0 });
});

test('only long messages collapse', () => {
  assert.equal(isLongChatMessage('Hej'), false);
  assert.equal(isLongChatMessage('x'.repeat(701)), true);
  assert.equal(isLongChatMessage(Array(13).fill('rad').join('\n')), true);
  assert.equal(isLongChatMessage(undefined), false);
});
