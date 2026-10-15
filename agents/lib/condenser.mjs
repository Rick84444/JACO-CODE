// Keeps a long agent conversation inside a budget without losing what was done (idea from OpenHands'
// condenser). When the messages grow past the budget, the oldest tool exchanges are replaced by ONE short
// message that lists each earlier step and how it went; the system prompt, the mission message and the
// most recent exchanges stay as they are. The dropped messages are handed to onCondense so the caller
// can keep the full log. No model call: the summary is built from the calls and results themselves.
export const SUMMARY_MARK = 'EARLIER STEPS (condensed';

const size = m => (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length)
  + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
export const conversationChars = messages => messages.reduce((n, m) => n + size(m), 0);

const oneLine = (value, max) => {
  const s = (typeof value === 'string' ? value : JSON.stringify(value ?? '')).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

function describeExchange(assistant, toolMessages) {
  const lines = [];
  for (const call of assistant.tool_calls || []) {
    const reply = toolMessages.find(t => t.tool_call_id === call.id);
    let outcome = reply ? oneLine(reply.content, 160) : 'no result';
    try {
      const parsed = JSON.parse(reply?.content || '');
      if (parsed && typeof parsed === 'object' && 'ok' in parsed) outcome = parsed.ok ? 'ok' : `failed: ${oneLine(parsed.error || parsed.result?.error || '', 120)}`;
    } catch {}
    lines.push(`- ${call.function?.name}(${oneLine(call.function?.arguments, 100)}) -> ${outcome}`);
  }
  if (!lines.length && assistant.content) lines.push(`- said: ${oneLine(assistant.content, 120)}`);
  return lines;
}

/**
 * @returns {{messages:any[], condensed:boolean, dropped:any[]}}
 */
export function condenseMessages(messages, { maxChars = 60_000, keepLast = 10, maxLines = 80 } = {}) {
  if (conversationChars(messages) <= maxChars || messages.length <= 2 + keepLast) return { messages, condensed: false, dropped: [] };
  const head = messages.slice(0, 2);
  let cut = messages.length - keepLast;
  // The kept tail must start at a message that is not a tool result, or its assistant message would be lost.
  while (cut > 2 && messages[cut].role === 'tool') cut--;
  if (cut <= 2) return { messages, condensed: false, dropped: [] };
  const middle = messages.slice(2, cut);

  const lines = [];
  for (let i = 0; i < middle.length; i++) {
    const m = middle[i];
    if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(SUMMARY_MARK)) {
      lines.push(...m.content.split('\n').slice(1));
    } else if (m.role === 'assistant') {
      const tools = [];
      while (middle[i + 1]?.role === 'tool') tools.push(middle[++i]);
      lines.push(...describeExchange(m, tools));
    } else if (m.role === 'user') {
      lines.push(`- instruction: ${oneLine(m.content, 140)}`);
    }
  }
  const kept = lines.length > maxLines ? [`- (${lines.length - maxLines} older steps not listed)`, ...lines.slice(-maxLines)] : lines;
  const summary = { role: 'user', content: `${SUMMARY_MARK}, the full log is kept; ${middle.length} messages replaced):\n${kept.join('\n')}` };
  return { messages: [...head, summary, ...messages.slice(cut)], condensed: true, dropped: middle };
}
