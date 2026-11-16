// The chat sends its recent history with every question. Twenty long answers can exceed the model's safe
// context, so the chat failed with a "context too large" reply. The newest messages are kept whole up to a
// total budget; each message is capped, and the oldest are dropped first. Nothing is invented or summarized.
export function boundChatHistory(items, { maxMessages = 20, maxTotalChars = 8000, maxMessageChars = 1200 } = {}) {
  const recent = (Array.isArray(items) ? items : []).slice(-maxMessages).map(item => ({
    role: item.role,
    content: String(item.content ?? '').slice(0, maxMessageChars),
  }));
  let total = 0;
  const kept = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    total += recent[i].content.length;
    if (total > maxTotalChars && kept.length > 0) break;
    kept.unshift(recent[i]);
  }
  return kept;
}
