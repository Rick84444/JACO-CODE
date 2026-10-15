import crypto from 'node:crypto';
import type express from 'express';

/**
 * Edge hardening for the JACO runtime.
 *
 * 0.17 shipped with `x-powered-by` disabled and a 2 MB JSON cap, and that was
 * the whole edge. On a loopback-only workstation that is defensible. The moment
 * `HOST=0.0.0.0` is set — which render.yaml does — the same process is exposed
 * with no rate limit, no security headers and no request correlation.
 *
 * This module adds those without changing any existing route or response shape,
 * and without adding a dependency: everything here is Node stdlib plus Express
 * middleware signatures already in use.
 */

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/** Client key: the socket address. Trust-proxy headers are deliberately ignored. */
function clientKey(req: express.Request): string {
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/**
 * Fixed-window limiter. Chosen over a sliding window because it needs one
 * counter per client, holds no request history, and cannot itself be used to
 * exhaust memory: the map is swept every minute and keyed by socket address.
 */
export function rateLimit(rule: RateLimitRule, scope: string): express.RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    sweep(now);
    const key = `${scope}:${clientKey(req)}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      res.setHeader('X-RateLimit-Limit', String(rule.max));
      res.setHeader('X-RateLimit-Remaining', String(rule.max - 1));
      return next();
    }

    bucket.count += 1;
    const remaining = Math.max(0, rule.max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(rule.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: `rate limit exceeded for ${scope}: ${rule.max} requests per ${Math.round(rule.windowMs / 1000)}s`,
        retryAfterSeconds,
      });
    }
    next();
  };
}

/** Correlates a request across the audit log, evidence receipts and the response. */
export const requestId: express.RequestHandler = (req, res, next) => {
  const incoming = String(req.headers['x-request-id'] || '');
  const id = /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  (req as express.Request & { jacoRequestId?: string }).jacoRequestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/**
 * Security headers.
 *
 * The CSP allows inline styles because the built GUI ships Tailwind's injected
 * style element; it does not allow inline script, remote script origins or
 * framing. `connect-src 'self'` keeps a compromised bundle from beaconing out.
 *
 * In dev mode Vite injects an inline module (the React Refresh preamble) into
 * index.html and talks to its HMR socket. Under `script-src 'self'` that inline
 * module is blocked, `$RefreshReg$` never gets defined and the GUI renders a blank
 * page. Dev therefore allows inline script and the websocket; the built GUI, which
 * is what ships, keeps the strict policy.
 */
export function securityHeaders(options: { httpsOnly: boolean; dev?: boolean }): express.RequestHandler {
  const dev = options.dev ?? process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');

  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    if (options.httpsOnly) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/**
 * Read guard for introspection endpoints.
 *
 * 0.17 authenticates mutations but leaves the read surface open. On a public
 * deployment that publishes the workspace file tree, the mission event log, the
 * job queue, the SEER configuration and the debugger incidents to anyone who
 * knows the path. This guard applies the same token to reads once the runtime is
 * bound beyond loopback, and stays transparent for loopback operation so the
 * local workstation experience is unchanged.
 */
export function requireReadAuth(host: string): express.RequestHandler {
  return (req, res, next) => {
    if (isLoopbackHost(host)) return next();

    const expected = String(process.env.GATEWAY_TOKEN || '').trim();
    if (!expected) {
      return res.status(503).json({
        success: false,
        error: 'GATEWAY_TOKEN is required before introspection APIs may be exposed beyond loopback',
      });
    }

    const provided = String(req.headers['x-gateway-token'] || '');
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    const matches = left.length === right.length && crypto.timingSafeEqual(left, right);
    if (!matches) return res.status(401).json({ success: false, error: 'gateway authentication required' });
    next();
  };
}

/** Rejects oversized or unexpected content types before the body parser buffers them. */
export function requireJsonBody(maxBytes: number): express.RequestHandler {
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const declared = Number(req.headers['content-length'] || '0');
    if (declared > maxBytes) {
      return res.status(413).json({ success: false, error: `request body exceeds ${maxBytes} bytes` });
    }
    const contentType = String(req.headers['content-type'] || '');
    if (declared > 0 && contentType && !contentType.includes('application/json')) {
      return res.status(415).json({ success: false, error: 'content-type must be application/json' });
    }
    next();
  };
}

/** Test seam: clears limiter state between verification runs. */
export function resetRateLimitState(): void {
  buckets.clear();
}
