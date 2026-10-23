// Regression: the public repository must not carry the operator's Stripe payment links, Cloudflare account
// subdomain, personal e-mail address or marketplace seller id. Such values belong in the operator's environment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const self = 'tests/nova/operator-data-hygiene.test.mjs';
const FORBIDDEN = [
  ['a hard-coded Stripe payment link', /buy\.stripe\.com\/[A-Za-z0-9]{10,}/],
  ['a concrete workers.dev account subdomain', /[a-z0-9-]+\.(?!<)[a-z0-9]+\.workers\.dev/i],
  ['the operator e-mail local part', /dickjacobsson022/i],
  ['the operator marketplace seller id', /7b6e0f43-c64b-4a06-a4cd-e8d3bd6c5290/],
];

test('tracked source and docs contain no operator-specific payment, account or identity values', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
    .filter(f => f && f !== self && !/^runtime\/dist\/|package-lock\.json$|\.(png|jpg|ico|zip|sqlite)$/i.test(f));
  const hits = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(resolve(root, file), 'utf8'); } catch { continue; }
    for (const [label, re] of FORBIDDEN) if (re.test(text)) hits.push(`${file}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

test('the checkout component takes its payment links from configuration only', () => {
  const source = readFileSync(resolve(root, 'src/components/QuickCheckout.tsx'), 'utf8');
  assert.match(source, /VITE_JACO_PAYMENT_LINKS/);
  assert.doesNotMatch(source, /paymentLink:\s*'https?:/);
  assert.match(source, /disabled=\{!link\.paymentLink\}/);
});
