// Creates (once) the Stripe product, price and payment link for the repo security scan, and prints the
// payment link id for JACO_REPO_SCAN_PAYMENT_LINK in .env. Idempotent: an existing offer (metadata
// jaco_offer=repo-scan) is reused, never duplicated.
//   node tools/create-repo-scan-offer.mjs [--price-sek 199] [--apply]
import 'dotenv/config';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const priceSek = Number(args[args.indexOf('--price-sek') + 1]) || 199;
const key = process.env.STRIPE_SECRET_KEY;
const publicBase = String(process.env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
if (!/^https:\/\//.test(publicBase)) throw new Error('JACO_GATEWAY_PUBLIC_URL must be the public https base where /scan/<order> is served');

const api = async (path, params) => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, params
    ? { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }
    : { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body?.error?.message}`);
  return body;
};

const OFFER = {
  name: 'Repo-säkerhetsskanning (GitHub)',
  description: 'Automatisk skanning av ett publikt GitHub-repo: läckta nycklar och lösenord i nuvarande filer (maskerade i rapporten) och beroenden med publicerade sårbarheter (OSV.dev). Rapporten visas på kvittosidan när skanningen är klar, oftast inom några minuter.',
};

async function main() {
  // Search is eventually consistent (a just-created product can be missing for about a minute), so the
  // newest products are also listed directly before anything is created.
  let existing = (await api(`products/search?query=${encodeURIComponent("metadata['jaco_offer']:'repo-scan' AND active:'true'")}`)).data;
  if (!existing.length) existing = (await api('products?active=true&limit=100')).data.filter(p => p.metadata?.jaco_offer === 'repo-scan');
  if (existing.length) {
    const product = existing[0];
    const links = (await api('payment_links?active=true&limit=100')).data;
    for (const link of links) {
      const items = await api(`payment_links/${link.id}/line_items?limit=5`);
      if (items.data.some(i => i.price?.product === product.id)) {
        console.log(JSON.stringify({ reused: true, product: product.id, paymentLink: link.id, url: link.url }));
        return;
      }
    }
  }
  const plan = { product: OFFER.name, priceSek, redirect: `${publicBase}/scan/{CHECKOUT_SESSION_ID}` };
  if (!apply) { console.log(JSON.stringify({ dryRun: true, ...plan })); return; }

  const product = existing[0] || await api('products', { name: OFFER.name, description: OFFER.description, 'metadata[jaco_offer]': 'repo-scan' });
  const price = await api('prices', { product: product.id, currency: 'sek', unit_amount: String(Math.round(priceSek * 100)) });
  const link = await api('payment_links', {
    'line_items[0][price]': price.id,
    'line_items[0][quantity]': '1',
    'custom_fields[0][key]': 'repo',
    'custom_fields[0][label][type]': 'custom',
    'custom_fields[0][label][custom]': 'Publikt GitHub-repo (https://github.com/...)',
    'custom_fields[0][type]': 'text',
    'after_completion[type]': 'redirect',
    'after_completion[redirect][url]': plan.redirect,
    'metadata[jaco_offer]': 'repo-scan',
  });
  console.log(JSON.stringify({ created: true, product: product.id, price: price.id, paymentLink: link.id, url: link.url }));
}
await main();
