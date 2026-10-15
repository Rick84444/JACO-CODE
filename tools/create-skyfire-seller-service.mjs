// Registers (once) the repo scan as a Skyfire seller service and prints its id for
// SKYFIRE_SELLER_SERVICE_ID in .env. Needs a valid SKYFIRE_API_KEY of the seller agent.
//   node tools/create-skyfire-seller-service.mjs [--apply]
import 'dotenv/config';
import { repoScanPriceUsd } from '../agents/lib/skyfire-seller.mjs';

const apply = process.argv.includes('--apply');
const key = process.env.SKYFIRE_API_KEY;
const base = String(process.env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
const NAME = 'JACO Repo Security Scan';

async function main() {
  if (!key) throw new Error('SKYFIRE_API_KEY is not set');
  const api = async (path, body) => {
    const res = await fetch(`https://api.skyfire.xyz${path}`, { method: body ? 'POST' : 'GET', headers: { 'skyfire-api-key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const out = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${res.status} ${path}: ${out?.message || out?.code || ''}`);
    return out;
  };
  const existing = await api('/api/v1/agents/seller-services');
  const list = Array.isArray(existing) ? existing : existing?.data || existing?.sellerServices || [];
  const found = list.find(s => s.name === NAME);
  if (found) { console.log(JSON.stringify({ reused: true, id: found.id, active: found.active, approved: found.approved })); return; }
  const service = {
    name: NAME,
    description: 'Security scan of a public GitHub repository: exposed credentials in current files (masked) and dependencies with published vulnerabilities (OSV.dev). Returns an HTML and JSON report. Charged after delivery.',
    type: 'API',
    openApiSpecUrl: `${base}/v1/repo-scan/openapi.json`,
    price: String(repoScanPriceUsd()),
    priceModel: 'PAY_PER_USE',
    minimumTokenAmount: String(repoScanPriceUsd()),
    humanIdentityRequirement: { individual: [], organization: [] },
    tags: ['security', 'github', 'code-scan'],
    acceptedTokens: ['pay', 'kya-pay'],
    termsOfService: { url: `${base}/terms`, required: false },
  };
  if (!apply) { console.log(JSON.stringify({ dryRun: true, ...service })); return; }
  const created = await api('/api/v1/agents/seller-services', service);
  console.log(JSON.stringify({ created: true, id: created.id, active: created.active, approved: created.approved }));
}
await main();
