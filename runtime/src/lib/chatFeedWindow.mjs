// The chat renders the latest part of the conversation; older items stay one click away.
export const CHAT_FEED_PAGE = 40;
const LONG_MESSAGE_CHARS = 700;
const LONG_MESSAGE_LINES = 12;

export function chatFeedWindow(feed, limit = CHAT_FEED_PAGE) {
  const items = Array.isArray(feed) ? feed : [];
  const size = Math.max(1, Number(limit) || CHAT_FEED_PAGE);
  return { visible: items.slice(-size), olderCount: Math.max(0, items.length - size) };
}

export function isLongChatMessage(text) {
  const value = String(text ?? '');
  return value.length > LONG_MESSAGE_CHARS || value.split('\n').length > LONG_MESSAGE_LINES;
}
