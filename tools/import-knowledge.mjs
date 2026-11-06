#!/usr/bin/env node
// Imports a folder of markdown pages into JACO's knowledge store (the memory Aura and Nova search).
//
//   node tools/import-knowledge.mjs <folder> [--source wiki] [--url http://127.0.0.1:3000] [--dry-run]
//
// The gateway token is read from JACO_GATEWAY_TOKEN (or GATEWAY_TOKEN) in the environment, never from an argument.
// Running it again updates changed pages in place and marks pages removed from the folder as STALE.
import { buildKnowledge, KIND } from '../agents/lib/knowledge-import.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const folder = args.find((a, i) => !a.startsWith('--') && (i === 0 || !['--source', '--url'].includes(args[i - 1])));
const source = flag('--source') || 'wiki';
const base = (flag('--url') || process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const dryRun = args.includes('--dry-run');
if (!folder) { console.error('usage: node tools/import-knowledge.mjs <folder> [--source wiki] [--url http://127.0.0.1:3000] [--dry-run]'); process.exit(2); }

const built = buildKnowledge(folder, { source });
console.log(`${built.pages} pages -> ${built.objects.length} knowledge objects; skipped ${built.skipped.length}`);
for (const s of built.skipped) console.log(`  skipped ${s.path}${s.part ? ` (part ${s.part})` : ''}: ${s.reason}`);
if (dryRun) { console.log('dry run: nothing was sent'); process.exit(0); }

const token = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '';
if (!token) { console.error('JACO_GATEWAY_TOKEN is not set in the environment'); process.exit(2); }
const call = async (method, path, body) => {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-gateway-token': token, origin: base }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload.error || payload).slice(0, 160)}`);
  return payload;
};

let created = 0, failed = 0;
for (const object of built.objects) {
  try { await call('POST', '/api/continuum/knowledge', object); created++; }
  catch (error) { failed++; console.error(`  ${object.id}: ${error.message}`); }
}

// Pages that are gone from the folder stop answering questions, but stay on record.
const prefix = `wiki-${built.source}-`;
const keep = new Set(built.objects.map(o => o.id));
let stale = 0;
try {
  const existing = (await call('GET', `/api/continuum/knowledge?kind=${KIND}&limit=1000`)).knowledge || [];
  for (const item of existing) {
    if (!item.id.startsWith(prefix) || keep.has(item.id) || ['STALE', 'SUPERSEDED', 'INVALID'].includes(item.verificationStatus)) continue;
    await call('POST', `/api/continuum/knowledge/${encodeURIComponent(item.id)}/status`, { status: 'STALE', reason: 'The page is no longer in the imported folder.' });
    stale++;
  }
} catch (error) { console.error(`stale check failed: ${error.message}`); }
console.log(`stored ${created}, failed ${failed}, marked stale ${stale}`);
process.exit(failed ? 1 : 0);
