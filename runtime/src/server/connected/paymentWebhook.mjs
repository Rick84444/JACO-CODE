// Payment webhook gate. Revenue is booked only from an event whose signature was verified against a
// secret the operator configured; an adapter that cannot do that (the local offline ledger) may still
// accept an authenticated event for development, but the event is marked unverified and never becomes revenue.
import crypto from 'node:crypto';

export class WebhookNotConfiguredError extends Error {
  constructor(message) { super(message); this.name = 'WebhookNotConfiguredError'; this.code = 'WEBHOOK_SECRET_NOT_CONFIGURED'; }
}

const MIN_SECRET_LENGTH = 16;

// HMAC-SHA256 (hex, optional "sha256=" prefix) of the raw body with JACO_LEDGER_WEBHOOK_SECRET.
// Without a secret there is nothing to verify against, so the request is refused rather than trusted.
export function verifyLedgerSignature(rawBody, signature, env = process.env) {
  const secret = String(env.JACO_LEDGER_WEBHOOK_SECRET || '');
  if (secret.length < MIN_SECRET_LENGTH) throw new WebhookNotConfiguredError('JACO_LEDGER_WEBHOOK_SECRET is not configured (at least 16 characters)');
  const given = String(signature || '').trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) throw new Error('WEBHOOK_SIGNATURE_INVALID');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) throw new Error('WEBHOOK_SIGNATURE_INVALID');
}

// Decides the HTTP outcome of a payment webhook. bookRevenue runs only for a verified successful payment.
export async function handlePaymentWebhook({ provider, rawBody, signature, bookRevenue, log = () => {} }) {
  if (!rawBody || !signature) {
    log('warn', 'Payment webhook rejected: missing signature');
    return { status: 400, body: { received: false, error: 'signature required' } };
  }
  let event;
  try {
    event = await provider.verifyWebhook(rawBody, signature);
  } catch (error) {
    if (error instanceof WebhookNotConfiguredError || error?.code === 'WEBHOOK_SECRET_NOT_CONFIGURED') {
      log('error', `Payment webhook refused: ${error.message}`);
      return { status: 503, body: { received: false, error: 'webhook secret not configured' } };
    }
    log('error', `Payment webhook rejected: ${error?.message || error}`);
    return { status: 400, body: { received: false, error: `Webhook Error: ${error?.message || error}` } };
  }
  const verified = event?.verified === true;
  let booked = false;
  if (event?.type === 'payment.succeeded') {
    if (verified) {
      await bookRevenue(event);
      booked = true;
    } else {
      log('warn', `Unverified local payment from ${provider.providerName} recorded as NOT revenue (${event.amount} ${event.currency})`);
    }
  }
  return { status: 200, body: { received: true, provider: provider.providerName, eventId: event?.eventId, verified, booked } };
}
