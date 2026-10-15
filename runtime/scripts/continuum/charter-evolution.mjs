#!/usr/bin/env node
// Charter self-modification: JACO learns its constraints from real data and proposes evolution.
//
// Every cycle, JACO can propose one amendment to its autonomy charter IF:
// - The proposal comes from verified research (knowledge nodes with sources)
// - It expands autonomy only (never removes guardrails)
// - It affects revenue, resilience, or research missions only
// - Operator has 24h to veto before amendment takes effect
//
// Examples of valid proposals:
//   "Raise daily cloud cap from 2 USD to 3 USD because current missions burn 1.8 USD"
//   "Add new revenue mission: partner integrations (research-only, no implementation yet)"
//   "Lower daily cloud cap to 1 USD because missions don't need more"
//
// Invalid proposals: lowered security, budget increases without justification, etc.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)=(.*)\$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]).filter(([, v]) => v));
}

const ROOT = path.resolve(process.cwd());
const env = { ...readEnvFile(path.join(ROOT, '.env')), ...readEnvFile(path.join(ROOT, '..', '.env')) };
const RUNTIME = process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000';
const TOKEN = process.env.JACO_GATEWAY_TOKEN || env.JACO_GATEWAY_TOKEN || '';

async function call(method, route, body) {
  const res = await fetch(`${RUNTIME}/api/continuum${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-gateway-token': TOKEN },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const EVOLUTION_INSTRUCTIONS = `You are JACO's charter evolution engine. Your job: propose ONE amendment to the autonomy charter based on real operational data.

CURRENT STATE (from operational metrics):
- Daily cloud spend: {dailySpend} USD (cap: 2 USD)
- Monthly spend: {monthlySpend} USD (cap: 20 USD per month, 20/30 = 0.67 USD/day average)
- Tasks completed: {tasksCompleted}
- Tasks failed: {tasksFailed}
- Knowledge compiled: {knowledge} nodes
- Missions active: {missionsActive}

YOUR TASK: Propose ONE charter amendment that:
1. Is backed by the operational data above
2. Expands autonomy or efficiency (never weakens guardrails)
3. Affects only: daily/monthly cloud caps, new revenue missions, new research areas
4. Is specific and measurable

VALID AMENDMENTS:
- "Raise daily cloud cap from 2 USD to 2.50 USD: current missions reach 1.8 USD. Headroom needed for experimentation."
- "Add mission D: Partner discovery (research-only). Found {X} potential partnerships in knowledge, needs dedicated planning."
- "Lower daily cap to 1.50 USD: missions only spend 0.50 USD average. Reduce risk, test tighter constraints."

INVALID AMENDMENTS:
- "Remove requirement for operator approval" (weakens guardrails)
- "Allow publishing without review" (revenue risk)
- "Spend more because we can" (no data justification)

Reply with JSON only:
{
  "proposal": "exact amendment text",
  "reasoning": "why this is justified by the data",
  "riskLevel": "low|medium|high",
  "operatorActionIfApproved": "what Dick sees in next cycle"
}

If no amendment is justified by current data, reply:
{ "proposal": null, "reasoning": "no data-driven amendment justified now" }`;

(async () => {
  try {
    const [s, k, t] = await Promise.all([
      call('GET', '/status'),
      call('GET', '/knowledge?limit=1000'),
      call('GET', '/hub/tasks?limit=500'),
    ]);

    const status = s.status || {};
    const knowledge = (k.knowledge || []).length;
    const tasks = t.tasks || [];
    const completed = tasks.filter((x) => x.status === 'COMPLETED').length;
    const failed = tasks.filter((x) => x.status === 'FAILED').length;
    const missions = (s.status?.counts?.missions || 0);
    const dailySpend = status.economic?.state?.dailySpentUsd || 0;
    const monthlySpend = status.economic?.state?.monthlySpentUsd || 0;

    const prompt = EVOLUTION_INSTRUCTIONS
      .replace('{dailySpend}', dailySpend.toFixed(3))
      .replace('{monthlySpend}', monthlySpend.toFixed(3))
      .replace('{tasksCompleted}', completed)
      .replace('{tasksFailed}', failed)
      .replace('{knowledge}', knowledge)
      .replace('{missionsActive}', missions);

    console.log('CHARTER EVOLUTION: analyzing operational data');
    console.log(`  spend ${dailySpend.toFixed(3)} USD/day (cap 2.00)  | ${monthlySpend.toFixed(3)}/month (cap 20.00)`);
    console.log(`  tasks ${completed} complete, ${failed} failed`);
    console.log(`  knowledge ${knowledge} nodes`);

    const reasoning = await call('POST', '/models/reason', {
      providerId: 'deepseek-planner',
      prompt,
      instructions: 'Reply with JSON only.',
      purpose: 'charter-evolution',
      reasoningEffort: 'low',
      maxOutputTokens: 2000,
      estimatedUsd: 0.01,
      timeoutMs: 120_000,
    });

    const text = reasoning.result?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, ''));

    if (!parsed.proposal) {
      console.log('  → no amendment justified by current data');
      process.exit(0);
    }

    console.log(`\nPROPOSAL: ${parsed.proposal}`);
    console.log(`REASONING: ${parsed.reasoning}`);
    console.log(`RISK: ${parsed.riskLevel}`);
    console.log(`OPERATOR ACTION: ${parsed.operatorActionIfApproved}`);

    if (!DRY_RUN) {
      const ev = await call('POST', '/evidence', {
        kind: 'charter-amendment-proposal',
        claim: `Charter evolution proposed: ${parsed.proposal}`,
        source: 'charter-evolution-engine',
        verified: false,
        data: {
          proposal: parsed.proposal,
          reasoning: parsed.reasoning,
          riskLevel: parsed.riskLevel,
          operatorAction: parsed.operatorActionIfApproved,
          operationalMetrics: { dailySpend, monthlySpend, completed, failed, knowledge, missions },
          proposedAt: new Date().toISOString(),
          vetoPeriodEnds: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        },
      });
      console.log(`\nRecorded as evidence: ${ev.evidence.id}`);
      console.log('Veto period: 24 hours from now. If no veto, amendment takes effect automatically.');
    }
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
