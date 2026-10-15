// x402 seller side: agents pay for the repo scan in USDC on Base (operator 2026-10-02). The payment is
// verified and settled by Coinbase's facilitator (CDP keys in .env, @coinbase/x402); funds go straight to
// X402_PAY_TO. Settlement happens before the scan starts, because the buyer's signed authorization is
// only valid for maxTimeoutSeconds; a paid scan that then fails is left for the operator to refund.
import crypto from 'node:crypto';
import { HTTPFacilitatorClient } from '@x402/core/http';
import { createFacilitatorConfig } from '@coinbase/x402';
import { repoScanPriceUsd } from './skyfire-seller.mjs';

export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_MAINNET = 'eip155:8453';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function x402Configured(env = process.env) {
  return ADDRESS.test(String(env.X402_PAY_TO || '')) && Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);
}

// priceUsd: the price of the endpoint being paid for (default: the repo scan).
export function paymentRequirements(env = process.env, priceUsd = repoScanPriceUsd(env)) {
  return {
    scheme: 'exact',
    network: BASE_MAINNET,
    asset: USDC_BASE,
    amount: String(Math.round(priceUsd * 1e6)), // USDC has 6 decimals
    payTo: String(env.X402_PAY_TO || ''),
    maxTimeoutSeconds: 300,
    extra: { name: 'USD Coin', version: '2' },
  };
}

// Bazaar discovery metadata (CDP x402 Bazaar indexes it after the first settlement through Coinbase's
// facilitator). Wire shape as @coinbase/cdp-sdk buildBazaarDeclaration, enriched with a body example
// and the response, so agents searching the Bazaar can call the endpoint without other docs.
export function bazaarDeclaration(env = process.env) {
  const base = String(env.JACO_GATEWAY_PUBLIC_URL || 'https://api.jacocode.com').replace(/\/+$/, '');
  const input = { type: 'http', method: 'POST', bodyType: 'json', body: { repo: 'https://github.com/OWASP/NodeGoat' } };
  const output = { type: 'json', example: { order: 'x4_<id>', status: 'accepted', reportUrl: `${base}/scan/x4_<id>`, statusUrl: `${base}/v1/repo-scan/x4_<id>`, transaction: '0x<settlement tx>' } };
  return {
    info: { input, output },
    schema: {
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', enum: ['POST'] },
            bodyType: { type: 'string', enum: ['json'] },
            body: { type: 'object', properties: { repo: { type: 'string', description: 'Public GitHub repository URL, https://github.com/<owner>/<repo>' } }, required: ['repo'] },
          },
          required: ['type', 'method', 'bodyType', 'body'],
          additionalProperties: false,
        },
        output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } } },
      },
    },
    routeTemplate: '/v1/repo-scan',
  };
}

// options: { priceUsd, description, bazaar } for endpoints other than the repo scan.
export function paymentRequired(resourceUrl, env = process.env, { priceUsd = repoScanPriceUsd(env), description = null, bazaar = null } = {}) {
  return {
    x402Version: 2,
    resource: { url: resourceUrl, description: description || 'Security scan of a public GitHub repository: exposed credentials in current files (masked) and dependencies with published vulnerabilities (OSV.dev). Returns an HTML and JSON report within minutes.', mimeType: 'application/json' },
    accepts: x402Configured(env) ? [paymentRequirements(env, priceUsd)] : [],
    extensions: { bazaar: bazaar || bazaarDeclaration(env) },
  };
}
export const encodeHeader = obj => Buffer.from(JSON.stringify(obj)).toString('base64');

export function decodePayment(header) {
  try { return JSON.parse(Buffer.from(String(header || ''), 'base64').toString('utf8')); } catch { return null; }
}

// The payment must be for exactly our requirements: a client cannot pick a cheaper asset, amount or
// another receiver.
export function matchesRequirements(payload, env = process.env, priceUsd = repoScanPriceUsd(env)) {
  const want = paymentRequirements(env, priceUsd);
  const got = payload?.accepted || {};
  return payload?.x402Version === 2 && ['scheme', 'network', 'asset', 'amount'].every(k => String(got[k]) === String(want[k]))
    && String(got.payTo).toLowerCase() === want.payTo.toLowerCase();
}

export const orderIdFor = header => `x4_${crypto.createHash('sha256').update(String(header)).digest('hex').slice(0, 32)}`;

export function facilitatorClient(env = process.env) {
  return new HTTPFacilitatorClient(createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET));
}

// Verify, then settle. Returns { ok, order, settlement } or { ok: false, error }.
export async function verifyAndSettle(header, { env = process.env, client = null, priceUsd = repoScanPriceUsd(env) } = {}) {
  if (!x402Configured(env)) return { ok: false, error: 'X402_NOT_CONFIGURED' };
  const payload = decodePayment(header);
  if (!payload) return { ok: false, error: 'X402_PAYMENT_MALFORMED' };
  if (!matchesRequirements(payload, env, priceUsd)) return { ok: false, error: 'X402_PAYMENT_DOES_NOT_MATCH_OFFER' };
  const requirements = paymentRequirements(env, priceUsd);
  client ||= facilitatorClient(env);
  const verified = await client.verify(payload, requirements);
  if (!verified?.isValid) return { ok: false, error: `X402_INVALID:${verified?.invalidReason || 'unknown'}` };
  const settlement = await client.settle(payload, requirements);
  if (!settlement?.success) return { ok: false, error: `X402_SETTLE_FAILED:${settlement?.errorReason || 'unknown'}` };
  return { ok: true, order: orderIdFor(header), settlement, payer: verified.payer || settlement.payer || null };
}
