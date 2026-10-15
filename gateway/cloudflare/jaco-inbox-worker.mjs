// Cloudflare Email Worker for JACO's own inbox (operator 2026-10-03: agents create their own logins).
// Mail to <anything>@<JACO domain> reaches this worker through Email Routing (catch-all -> worker).
// It forwards the raw message to the JACO gateway, signed with HMAC-SHA256, and keeps nothing.
// Deployed by tools/deploy-inbox-worker.mjs. Bindings: INBOX_URL (plain), INBOX_SECRET (secret).
const MAX_RAW = 512 * 1024;

async function sign(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async email(message, env) {
    if (message.rawSize > MAX_RAW) { message.setReject('Message too large'); return; }
    const raw = await new Response(message.raw).text();
    const body = JSON.stringify({ from: message.from, to: message.to, raw, receivedAt: new Date().toISOString() });
    const res = await fetch(env.INBOX_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jaco-signature': await sign(env.INBOX_SECRET, body) },
      body,
    });
    // A gateway that is down makes the sender retry later instead of losing the message.
    if (!res.ok) message.setReject(`JACO inbox unavailable (${res.status})`);
  },
};
