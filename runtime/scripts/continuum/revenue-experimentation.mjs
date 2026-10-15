#!/usr/bin/env node
// Revenue experimentation loop: propose and test new revenue hypotheses.
//
// Every cycle, JACO analyzes research findings (knowledge nodes) to:
// 1. Identify untested revenue opportunities
// 2. Propose a small, reversible experiment
// 3. Run it (research-only, no commitment)
// 4. Report results
//
// Example: Research finds "HuggingFace Spaces get 10K views/month for free demos"
// → Propose: "Create demo on HuggingFace, measure inbound traffic for 48h"
// → Run: Research mission experiments with demo flow
// → Report: "Demo gets X views, Y qualified leads" → can now decide on full mission shift

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

const EXPERIMENT_INSTRUCTIONS = `You are JACO's revenue experimentation engine. Your job: propose ONE small, reversible revenue experiment based on research findings.

RECENT RESEARCH FINDINGS (from knowledge nodes, last 10):
{recentFindings}

YOUR TASK: Propose ONE experiment that:
1. Is backed by a specific research finding
2. Is research-only (no code, no implementation)
3. Takes < 1 hour of model reasoning to execute
4. Tests a revenue hypothesis without commitment
5. Can be run completely independently

VALID EXPERIMENTS:
- "Test HuggingFace demo hypothesis: create a 500-word comparison of JACO vs competitors, measure download/fork rate"
- "Test A2A marketplace hypothesis: write a service card for one A2A directory, analyze what buyers ask for"
- "Test pricing hypothesis: research 10 similar services, compile price-point analysis by feature tier"

INVALID EXPERIMENTS:
- "Implement a full marketplace integration" (not research-only)
- "Deploy code to production" (irreversible)
- "Run paid advertising" (costs money)

Reply with JSON only:
{
  "hypothesis": "what revenue opportunity this tests",
  "experiment": "exact research task to run",
  "successMetric": "how we know if this works",
  "estimatedEffort": "model reasoning time in minutes",
  "nextActionIfSuccessful": "what divergence to propose if results are positive"
}

If no experiment is justified by recent research, reply:
{ "experiment": null, "reason": "need more research before experimentation" }`;

(async () => {
  try {
    const k = await call('GET', '/knowledge?limit=100');
    const knowledge = (k.knowledge || []).slice(-10);

    if (!knowledge.length) {
      console.log('NO EXPERIMENTS: waiting for more research findings');
      process.exit(0);
    }

    const findings = knowledge.map((k) => `- ${k.claim} [${k.outcome}]`).join('\n');
    const prompt = EXPERIMENT_INSTRUCTIONS.replace('{recentFindings}', findings);

    console.log('REVENUE EXPERIMENTATION: analyzing research findings');
    console.log(`  found ${knowledge.length} recent knowledge nodes`);

    const reasoning = await call('POST', '/models/reason', {
      providerId: 'deepseek-planner',
      prompt,
      instructions: 'Reply with JSON only.',
      purpose: 'revenue-experimentation',
      reasoningEffort: 'low',
      maxOutputTokens: 1500,
      estimatedUsd: 0.01,
      timeoutMs: 120_000,
    });

    const text = reasoning.result?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, ''));

    if (!parsed.experiment) {
      console.log(`  → ${parsed.reason || 'no experiment ready'}`);
      process.exit(0);
    }

    console.log(`\nHYPOTHESIS: ${parsed.hypothesis}`);
    console.log(`EXPERIMENT: ${parsed.experiment}`);
    console.log(`SUCCESS METRIC: ${parsed.successMetric}`);
    console.log(`EFFORT: ~${parsed.estimatedEffort} min reasoning`);
    console.log(`IF SUCCESSFUL: ${parsed.nextActionIfSuccessful}`);

    if (!DRY_RUN) {
      const missions = (await call('GET', '/missions')).missions || [];
      const research = missions.find((m) => m.tags?.includes('research'));

      if (!research) {
        console.log('WARNING: no research mission found to run experiment');
        process.exit(0);
      }

      const ev = await call('POST', '/evidence', {
        kind: 'revenue-experiment-proposed',
        claim: `Revenue experiment proposed: ${parsed.hypothesis}`,
        source: 'revenue-experimentation-engine',
        verified: false,
        data: {
          hypothesis: parsed.hypothesis,
          experiment: parsed.experiment,
          successMetric: parsed.successMetric,
          effort: parsed.estimatedEffort,
          nextAction: parsed.nextActionIfSuccessful,
          proposedFor: research.id,
          proposedAt: new Date().toISOString(),
        },
      });

      console.log(`\nRecorded as evidence: ${ev.evidence.id}`);
      console.log('Next cycle will run this experiment within research mission.');
    }
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
