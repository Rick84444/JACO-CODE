import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();
export const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));

const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key|credential|otp)/i;
export function redactSensitive(value, depth = 0) {
  if (depth > 24) return '[REDACTED:DEPTH]';
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{8,}=?=?/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]');
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, depth + 1);
    return out;
  }
  return value;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function atomicWriteJson(file, value) {
  // Redaction happens at the call sites that build untrusted fields
  // (metadata, content, payload, ...) via redactSensitive() directly.
  // Applying it again here, blindly, over the whole object matched every
  // structural field whose NAME merely contains "secret"/"token" - e.g.
  // provider.secretEnv (an env var name, not a secret) or
  // provider.maxContextTokens (a count) - and silently overwrote them
  // with the literal string "[REDACTED]" on every persisted write.
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

export function assertString(value, name, max = 1000) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  if (text.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return text;
}

export function assertEnum(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
