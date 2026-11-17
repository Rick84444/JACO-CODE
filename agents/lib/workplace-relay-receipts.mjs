// Communication-only, evidence-limited ACK for ChatGPT's public Git-ref relay.
// JACO keeps a single Aura runtime; this module neither starts a second agent
// nor interprets remote messages as tasks or grants.
import { createHash } from 'node:crypto';

const MAX_PENDING = 64;
const AGENT_ID = /^agent:chatgpt:[a-f0-9]{8,64}$/i;
const MARKER = /\bAURA_ACK_[A-Z0-9_-]{1,32}\b/;

export function relayQuestion(event) {
  const sender = String(event?.sender?.agentId || '');
  const messageId = String(event?.payload?.messageId || '');
  if (event?.kind !== 'QUESTION' || event?.thread !== 'chatgpt'
      || event?.payload?.transport !== 'git-ref' || !AGENT_ID.test(sender)
      || !messageId || !String(event?.eventId || '').startsWith('chatgpt-git:')) return null;
  const eventId = 'aura-workplace-receipt:' + createHash('sha256')
    .update(sender + '\n' + String(event.eventId)).digest('hex').slice(0, 48);
  const marker = String(event.body || '').match(MARKER)?.[0] || '';
  return {
    eventId,
    kind: 'ANSWER',
    thread: 'chatgpt',
    targets: [sender],
    body: 'Aura execution client received the ChatGPT Workplace question. '
      + 'This is a verified transport receipt only: no LLM reasoning, tool execution, '
      + 'mission completion, permissions or approvals are implied.'
      + (marker ? ' Verification marker: ' + marker : ''),
    payload: { receiptOnly: true, modelInvoked: false, missionExecuted: false },
  };
}

export function createRelayReceiptQueue() {
  const pending = new Map();
  return {
    get size() { return pending.size; },
    accept(events = []) {
      for (const event of events) {
        const receipt = relayQuestion(event);
        if (!receipt || pending.has(receipt.eventId)) continue;
        if (pending.size >= MAX_PENDING) throw Error('CHATGPT_WORKPLACE_RECEIPT_BACKPRESSURE');
        pending.set(receipt.eventId, receipt);
      }
      return pending.size;
    },
    async flush(post) {
      if (typeof post !== 'function') throw Error('CHATGPT_WORKPLACE_POST_UNAVAILABLE');
      let sent = 0;
      for (const [id, receipt] of pending) {
        await post(receipt.kind, receipt.body, {
          thread: receipt.thread,
          targets: receipt.targets,
          eventId: receipt.eventId,
          payload: receipt.payload,
        });
        pending.delete(id);
        sent++;
      }
      return sent;
    },
  };
}
