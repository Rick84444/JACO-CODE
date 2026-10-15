// JACO's own inbox (operator 2026-10-03: agents create logins on sites and must get past e-mail
// verification on their own). Mail to jaco-*@<JACO_INBOX_DOMAIN> arrives through Cloudflare Email
// Routing and gateway/cloudflare/jaco-inbox-worker.mjs, which posts it signed to the gateway.
// The gateway verifies the signature and stores the parsed message here; Nova reads it with the
// email-inbox task. Only jaco-* addresses are kept, for 48 hours, at most 200 messages.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEEP_MS = 48 * 3600_000;
const MAX_MESSAGES = 200;
export const inboxFile = (env = process.env) => path.join(path.resolve(env.JACO_WORKSPACE_ROOT || process.cwd()), '.jaco', 'inbox', 'messages.json');
export const inboxDomain = (env = process.env) => String(env.JACO_INBOX_DOMAIN || 'mimirpower.com').toLowerCase();
// jaco@, jaco-<site>@ and jaco+<site>@ belong to JACO; any other address on the domain is not read.
export const isJacoAddress = (address, env = process.env) => new RegExp(`^jaco(?:[-+][a-z0-9.-]{1,40})?@${inboxDomain(env).replace(/\./g, '\\.')}$`, 'i').test(String(address || '').trim());

export function verifySignature(body, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ---- minimal MIME parsing: headers, multipart, quoted-printable, base64, HTML to text ----------
function splitHeaders(part) {
  const i = part.search(/\r?\n\r?\n/);
  const head = i < 0 ? part : part.slice(0, i);
  const body = i < 0 ? '' : part.slice(i).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { headers, body };
}
const decodeQP = s => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
function decodeBody(headers, body) {
  const enc = String(headers['content-transfer-encoding'] || '').toLowerCase();
  if (enc.includes('base64')) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc.includes('quoted-printable')) return decodeQP(body);
  return body;
}
const decodeWords = s => String(s || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs, e, t) => e.toLowerCase() === 'b'
  ? Buffer.from(t, 'base64').toString('utf8') : decodeQP(t.replace(/_/g, ' ')));
export const htmlToText = html => String(html)
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label} (${href})`)
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

function collectText(part, depth = 0) {
  const { headers, body } = splitHeaders(part);
  const type = String(headers['content-type'] || 'text/plain').toLowerCase();
  if (type.startsWith('multipart/') && depth < 5) {
    const boundary = /boundary="?([^";]+)"?/i.exec(headers['content-type'] || '')?.[1];
    if (!boundary) return { plain: '', html: '' };
    const parts = body.split(`--${boundary}`).slice(1).filter(p => !p.startsWith('--'));
    return parts.map(p => collectText(p.replace(/^\r?\n/, ''), depth + 1)).reduce((a, b) => ({ plain: a.plain || b.plain, html: a.html || b.html }), { plain: '', html: '' });
  }
  if (type.startsWith('text/html')) return { plain: '', html: decodeBody(headers, body) };
  if (type.startsWith('text/')) return { plain: decodeBody(headers, body), html: '' };
  return { plain: '', html: '' };
}

export function parseMessage(raw) {
  const { headers } = splitHeaders(raw);
  const { plain, html } = collectText(raw);
  const text = (plain || htmlToText(html)).replace(/\r/g, '').trim();
  return { subject: decodeWords(headers.subject), from: decodeWords(headers.from), date: headers.date || null, text: text.slice(0, 20_000) };
}

// One-time codes and links a verification mail asks the reader to use.
export function extractVerification(text) {
  const codes = [...new Set([...String(text).matchAll(/(?:code|kod|pin|otp|verification|verify|bekräfta)[^\d\n]{0,40}\b(\d{4,8})\b|\b(\d{6})\b/gi)].map(m => m[1] || m[2]))].slice(0, 3);
  const links = [...new Set([...String(text).matchAll(/https?:\/\/[^\s)"'<>]+/g)].map(m => m[0].replace(/[.,;]+$/, '')))]
    .filter(u => /verif|confirm|activate|validate|magic|token|signup|register|login|auth/i.test(u)).slice(0, 5);
  return { codes, links };
}

// ---- store -------------------------------------------------------------------------------------
export function loadInbox(env = process.env) { try { return JSON.parse(fs.readFileSync(inboxFile(env), 'utf8')); } catch { return []; } }
export function storeMessage({ from, to, raw, receivedAt }, env = process.env, now = Date.now()) {
  if (!isJacoAddress(to, env)) return { stored: false, reason: 'NOT_A_JACO_ADDRESS' };
  const parsed = parseMessage(String(raw || ''));
  const message = { id: crypto.createHash('sha256').update(`${to}|${receivedAt}|${parsed.subject}`).digest('hex').slice(0, 16), to: String(to).toLowerCase(), envelopeFrom: String(from || ''), receivedAt: receivedAt || new Date(now).toISOString(), ...parsed };
  const kept = loadInbox(env).filter(m => now - Date.parse(m.receivedAt) < KEEP_MS && m.id !== message.id);
  const next = [...kept, message].slice(-MAX_MESSAGES);
  fs.mkdirSync(path.dirname(inboxFile(env)), { recursive: true });
  fs.writeFileSync(inboxFile(env), JSON.stringify(next, null, 2));
  return { stored: true, id: message.id };
}

// What Nova sees: recent mail to one JACO address (or all), newest first, with codes and links.
export function readInbox({ to = null, sinceMinutes = 60, limit = 5 } = {}, env = process.env, now = Date.now()) {
  const since = now - Math.max(1, Math.min(2880, Number(sinceMinutes) || 60)) * 60_000;
  return loadInbox(env)
    .filter(m => Date.parse(m.receivedAt) >= since && (!to || m.to === String(to).toLowerCase()))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, Math.max(1, Math.min(10, Number(limit) || 5)))
    .map(m => ({ id: m.id, to: m.to, from: m.from || m.envelopeFrom, subject: m.subject, receivedAt: m.receivedAt, ...extractVerification(m.text), text: m.text.slice(0, 1500) }));
}
