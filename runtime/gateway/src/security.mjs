import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function parseHostHeader(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('@') || /[\s\\/]/.test(raw)) return null;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end < 0) return null;
    const host = raw.slice(0, end + 1).toLowerCase();
    const rest = raw.slice(end + 1);
    if (rest && !/^:\d+$/.test(rest)) return null;
    return host;
  }
  const parts = raw.split(':');
  if (parts.length > 2) return null;
  if (parts[1] && !/^\d+$/.test(parts[1])) return null;
  return parts[0].toLowerCase();
}

export function hostAllowed(req, allowedHosts) {
  const parsed = parseHostHeader(req.headers.host);
  if (!parsed) return false;
  const allowed = new Set(allowedHosts.map(x => String(x).toLowerCase().replace(/:\d+$/, '')));
  return allowed.has(parsed);
}

export function originAllowed(req, { gatewayHost, gatewayPort, allowedHosts }) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (String(origin).includes('@')) return false;
    const u = new URL(origin);
    const allowed = new Set(allowedHosts.map(x => String(x).toLowerCase().replace(/^\[|\]$/g, '')));
    const host = u.hostname.toLowerCase();
    if (!allowed.has(host) && host !== gatewayHost && host !== '::1') return false;
    return !u.port || Number(u.port) === gatewayPort;
  } catch {
    return false;
  }
}

export function bearerAllowed(req, expected) {
  if (!expected) return true;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7), expected);
}

export function writeJson(res, status, body, extraHeaders = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders
  });
  res.end(data);
}

export async function readJson(req, maxBytes = 64 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
