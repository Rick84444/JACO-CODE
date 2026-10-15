import crypto from 'node:crypto';

export function constantTimeSecretEqual(expected, candidate) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(candidate || ''), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearer(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || '').trim());
  return match ? match[1].trim() : '';
}

export function cloudflareWebhookAuth({ env = process.env } = {}) {
  return function requireCloudflareWebhook(req, res, next) {
    const expected = String(env.JACO_CLOUDFLARE_WEBHOOK_SECRET || '').trim();
    if (!expected) {
      return res.status(503).json({
        success: false,
        error: { code: 'CLOUDFLARE_WEBHOOK_NOT_CONFIGURED', message: 'External webhook ingestion is disabled.' },
      });
    }

    const headerSecret = Array.isArray(req.headers?.['x-jaco-webhook-secret'])
      ? req.headers['x-jaco-webhook-secret'][0]
      : req.headers?.['x-jaco-webhook-secret'];
    const candidate = String(headerSecret || bearer(req.headers?.authorization) || '').trim();
    if (!constantTimeSecretEqual(expected, candidate)) {
      return res.status(401).json({
        success: false,
        error: { code: 'CLOUDFLARE_WEBHOOK_AUTH_REQUIRED', message: 'Valid webhook authentication is required.' },
      });
    }
    return next();
  };
}
