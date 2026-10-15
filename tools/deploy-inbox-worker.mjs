// Deploys gateway/cloudflare/jaco-inbox-worker.mjs as the Cloudflare Worker "jaco-inbox" and makes
// sure JACO_INBOX_SECRET exists in .env (shared HMAC secret between the worker and the gateway).
// Email Routing then sends the domain's catch-all to this worker. No secret is printed.
//   node tools/deploy-inbox-worker.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
let env = fs.readFileSync(ENV_FILE, 'utf8');
const get = name => (env.match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1]?.replace(/\s+#.*$/, '').trim();

let secret = get('JACO_INBOX_SECRET');
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  env = env.replace(/\s*$/, '\n') + `JACO_INBOX_SECRET=${secret}\n`;
  fs.writeFileSync(ENV_FILE, env);
  console.log('created JACO_INBOX_SECRET in .env');
}
const token = get('CLOUDFLARE_DEPLOY_API_TOKEN') || get('CLOUDFLARE_API_TOKEN');
const account = get('CLOUDFLARE_ACCOUNT_ID');
const publicUrl = (get('JACO_GATEWAY_PUBLIC_URL') || '').replace(/\/+$/, '');
if (!token || !account || !publicUrl) throw new Error('CLOUDFLARE_DEPLOY_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and JACO_GATEWAY_PUBLIC_URL are required');

const form = new FormData();
form.append('metadata', new Blob([JSON.stringify({
  main_module: 'worker.mjs',
  compatibility_date: '2026-09-01',
  bindings: [
    { type: 'plain_text', name: 'INBOX_URL', text: `${publicUrl}/v1/inbox` },
    { type: 'secret_text', name: 'INBOX_SECRET', text: secret },
  ],
})], { type: 'application/json' }));
form.append('worker.mjs', new Blob([fs.readFileSync(path.join(ROOT, 'gateway', 'cloudflare', 'jaco-inbox-worker.mjs'), 'utf8')], { type: 'application/javascript+module' }), 'worker.mjs');

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jaco-inbox`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form });
const body = await res.json().catch(() => null);
console.log(JSON.stringify({ status: res.status, success: body?.success ?? false, id: body?.result?.id || null, errors: (body?.errors || []).map(e => e.message) }));
if (!res.ok) process.exit(1);
