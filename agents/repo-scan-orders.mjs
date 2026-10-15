// Repo-scan order intake: turns each paid Stripe checkout of the repo-scan payment link into one durable
// Nova mission. Polls Stripe (no public webhook needed); the checkout session id is the order id and the
// mission's idempotency key, so an order can never become two missions.
//   node agents/repo-scan-orders.mjs          (loop; started by agents/start-missing.ps1)
//   node agents/repo-scan-orders.mjs --once
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRepoUrl, reportDir } from './lib/repo-scan.mjs';

export function orderMissionGoal(order, repoUrl) {
  return `Paid order ${order}: run the repo security scan for ${repoUrl} with one repo-scan task (url ${repoUrl}, order ${order}), then propose completion with the report link as evidence.`;
}

// Decides what to do with each paid session. Pure: Stripe and the runtime are injected.
export async function processOrders({ sessions, state, createMission, now = () => new Date().toISOString() }) {
  const results = [];
  for (const s of sessions) {
    if (s.status !== 'complete' || s.payment_status !== 'paid' || state[s.id]) continue;
    const raw = (s.custom_fields || []).find(f => f.key === 'repo')?.text?.value || '';
    let repo;
    try { repo = parseRepoUrl(raw); } catch (error) {
      // Paid, but not scannable as entered: left for the operator (refund or contact), never guessed.
      state[s.id] = { status: 'NEEDS_OPERATOR', reason: String(error.message), entered: String(raw).slice(0, 200), email: s.customer_details?.email || null, at: now() };
      results.push({ order: s.id, status: 'NEEDS_OPERATOR' });
      continue;
    }
    const mission = await createMission({
      goal: orderMissionGoal(s.id, repo.url),
      idempotencyKey: s.id,
      allowedTasks: ['repo-scan'],
      source: 'stripe-order',
    });
    state[s.id] = { status: 'MISSION_CREATED', missionId: mission?.id || null, repo: repo.url, at: now() };
    results.push({ order: s.id, status: 'MISSION_CREATED', missionId: mission?.id });
  }
  return results;
}

async function stripeSessions(key, link) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?payment_link=${encodeURIComponent(link)}&status=complete&limit=100`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`STRIPE_${res.status}: ${body?.error?.message || ''}`);
  return body.data || [];
}

async function createMissionViaRuntime(input) {
  const base = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
  const token = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '';
  const res = await fetch(`${base}/api/connected/nova/missions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-gateway-token': token },
    body: JSON.stringify(input), signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`RUNTIME_${res.status}: ${JSON.stringify(body?.error || body).slice(0, 200)}`);
  return body.mission;
}

async function tick() {
  const key = process.env.STRIPE_SECRET_KEY;
  const link = process.env.JACO_REPO_SCAN_PAYMENT_LINK;
  if (!key || !link) { console.log(`[repo-scan-orders] idle: ${!key ? 'STRIPE_SECRET_KEY' : 'JACO_REPO_SCAN_PAYMENT_LINK'} is not set`); return; }
  const dir = reportDir();
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'orders.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const results = await processOrders({ sessions: await stripeSessions(key, link), state, createMission: createMissionViaRuntime });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  for (const r of results) console.log(`[repo-scan-orders] ${r.order.slice(0, 20)}… ${r.status}${r.missionId ? ` ${r.missionId}` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const once = process.argv.includes('--once');
  const run = () => tick().catch(e => console.error(`[repo-scan-orders] ${e.message}`));
  await run();
  if (!once) setInterval(run, Number(process.env.JACO_REPO_SCAN_POLL_MS || 60_000));
}
