import { PaymentProvider, PaymentOrder, PaymentCheckoutResult, PaymentVerifiedEvent, PaymentRefundResult } from '../types';
import crypto from 'crypto';
import { verifyLedgerSignature, WebhookNotConfiguredError } from '../server/connected/paymentWebhook.mjs';

/**
 * StripePaymentAdapter
 * Implements PaymentProvider contract. Isolates Stripe SDK behind an exchangeable abstraction.
 */
export class StripePaymentAdapter implements PaymentProvider {
  public providerName = 'stripe';

  async createCheckout(order: PaymentOrder): Promise<PaymentCheckoutResult> {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY saknas i miljövariabler.');
    }
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: order.currency.toLowerCase(),
            product_data: {
              name: order.description,
            },
            unit_amount: Math.round(order.amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: order.customerEmail,
      success_url: order.successUrl,
      cancel_url: order.cancelUrl,
      metadata: {
        orderId: order.orderId,
        ...(order.metadata || {})
      }
    });

    return {
      checkoutId: session.id,
      checkoutUrl: session.url || '',
      provider: 'stripe',
      status: 'created'
    };
  }

  async verifyWebhook(rawBody: Buffer | string, signature: string, secret?: string): Promise<PaymentVerifiedEvent> {
    const webhookSecret = secret || process.env.STRIPE_WEBHOOK_SECRET;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!webhookSecret || !stripeKey) {
      throw new WebhookNotConfiguredError('STRIPE_WEBHOOK_SECRET eller STRIPE_SECRET_KEY är inte konfigurerat.');
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const dataObj = event.data.object as any;
      const amount = (dataObj.amount_total || dataObj.amount || 0) / 100;
      return {
        eventId: event.id,
        type: 'payment.succeeded',
        amount,
        currency: (dataObj.currency || 'sek').toUpperCase(),
        customerEmail: dataObj.customer_details?.email || dataObj.customer_email,
        transactionId: dataObj.id,
        rawPayloadHash: payloadHash,
        timestamp: new Date(event.created * 1000).toISOString(),
        verified: true
      };
    }

    return {
      eventId: event.id,
      type: 'payment.failed',
      amount: 0,
      currency: 'SEK',
      transactionId: (event.data.object as any)?.id || 'N/A',
      rawPayloadHash: payloadHash,
      timestamp: new Date(event.created * 1000).toISOString(),
      verified: true
    };
  }

  async refund(paymentId: string, amount?: number): Promise<PaymentRefundResult> {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY saknas.');
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);

    const refund = await stripe.refunds.create({
      payment_intent: paymentId,
      amount: amount ? Math.round(amount * 100) : undefined
    });

    return {
      refundId: refund.id,
      paymentId,
      amount: (refund.amount || 0) / 100,
      status: refund.status === 'succeeded' ? 'succeeded' : 'pending'
    };
  }
}

/**
 * OfflineLedgerPaymentAdapter
 * Zero-dependency local ledger fallback for offline A2A settlement without third-party lock-in.
 */
export class OfflineLedgerPaymentAdapter implements PaymentProvider {
  public providerName = 'offline_ledger';

  async createCheckout(order: PaymentOrder): Promise<PaymentCheckoutResult> {
    const checkoutId = `offline-chk-${Date.now()}`;
    return {
      checkoutId,
      checkoutUrl: `/api/ledger/settle?orderId=${order.orderId}&amount=${order.amount}`,
      provider: 'offline_ledger',
      status: 'created'
    };
  }

  // A local ledger holds no money and no payment provider vouches for it, so even an authenticated event
  // is returned as unverified: it never counts as revenue. Without JACO_LEDGER_WEBHOOK_SECRET it is refused.
  async verifyWebhook(rawBody: Buffer | string, signature: string): Promise<PaymentVerifiedEvent> {
    verifyLedgerSignature(rawBody, signature);
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf-8'));
    return {
      eventId: `evt-ledger-${Date.now()}`,
      type: 'payment.succeeded',
      amount: Number(parsed.amount) || 0,
      currency: parsed.currency || 'SEK',
      customerEmail: parsed.customerEmail || undefined,
      transactionId: parsed.transactionId || `tx-local-${Date.now()}`,
      rawPayloadHash: payloadHash,
      timestamp: new Date().toISOString(),
      verified: false
    };
  }

  async refund(paymentId: string, amount?: number): Promise<PaymentRefundResult> {
    return {
      refundId: `ref-local-${Date.now()}`,
      paymentId,
      amount: amount || 0,
      status: 'succeeded'
    };
  }
}

/**
 * PaymentGatewayFactory
 * Returns appropriate adapter dynamically based on environment configuration.
 */
export function getPaymentProvider(): PaymentProvider {
  if (process.env.STRIPE_SECRET_KEY) {
    return new StripePaymentAdapter();
  }
  return new OfflineLedgerPaymentAdapter();
}
