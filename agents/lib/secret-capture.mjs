// Secrets on web pages (operator 2026-10-03: agents create logins and API keys, and must handle that
// step safely). When a site shows an API key, token or one-time code, the page text reaches the
// planner (an external LLM) and the mission's receipts. This module replaces such values with a
// handle before either sees them, keeps the value in this process for a short time, and lets the
// planner store it in the vault by handle (secret-store) without ever seeing it. Passwords are
// generated here (vault-generate-secret) for the same reason.
import crypto from 'node:crypto';

const TTL_MS = 30 * 60_000;
const held = new Map(); // handle -> { value, at }

// Known credential shapes, and long high-entropy tokens of mixed character classes. Pure hex (commit
// hashes, sha256) and plain words are left alone: they are evidence, not secrets.
const KNOWN = /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\bhf_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9_-]{20,}/g;
const TOKEN = /[A-Za-z0-9_\-+/=]{24,}/g;

function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}
export function looksSecret(s) {
  if (/^[0-9a-f]+$/i.test(s) || /^[A-Za-z]+$/.test(s) || /^\d+$/.test(s)) return false;
  if (/^https?:|\/\//.test(s) || s.includes('/') && s.split('/').length > 3) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter(r => r.test(s)).length;
  return classes >= 2 && entropy(s) >= 3.6;
}

export const handleOf = value => `secret:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
function hold(value, now) {
  const handle = handleOf(value);
  held.set(handle, { value, at: now });
  return handle;
}
function sweep(now) { for (const [k, v] of held) if (now - v.at > TTL_MS) held.delete(k); }

// Replaces secrets in one string. Returns the redacted text and the handles created.
export function redactText(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length < 20) return { text, handles: [] };
  sweep(now);
  const handles = [];
  const swap = value => { const h = hold(value, now); handles.push(h); return `[${h}]`; };
  let out = text.replace(KNOWN, m => swap(m));
  out = out.replace(TOKEN, m => (m.startsWith('[secret:') || !looksSecret(m) ? m : swap(m)));
  return { text: out, handles: [...new Set(handles)] };
}

// Redacts every string in a JSON-like value (observations, browser task results).
export function redactDeep(value, now = Date.now(), depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value, now).text;
  if (Array.isArray(value)) return value.map(v => redactDeep(v, now, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, now, depth + 1)]));
  return value;
}

export function takeHeld(handle, now = Date.now()) {
  sweep(now);
  const entry = held.get(String(handle || '').replace(/^\[|\]$/g, ''));
  return entry ? entry.value : null;
}

export function generateSecret(length = 24) {
  const n = Math.max(16, Math.min(64, Number(length) || 24));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%+=?';
  const bytes = crypto.randomBytes(n);
  // At least one of each class, so common password rules accept it.
  const base = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
  return `${base.slice(0, n - 4)}Aa7!`;
}

const KEY = /^[A-Z][A-Z0-9_]{2,80}$/;
export function validateVaultKey(key) {
  const k = String(key || '').trim();
  if (!KEY.test(k)) throw new Error('VAULT_KEY_INVALID');
  // Runtime credentials stay out of reach of the planner: it may only create and use keys of its own.
  if (!k.startsWith('NOVA_')) throw new Error('VAULT_KEY_MUST_START_WITH_NOVA_');
  return k;
}

// Holds a value the runtime itself found (e.g. a one-time code in a verification mail) and returns
// its handle, so the planner can use it (secret-store, then vault:<key>) without reading it.
export function holdValue(value, now = Date.now()) {
  sweep(now);
  return hold(String(value), now);
}
