#!/usr/bin/env node
// Mission rebalancing: JACO can shift focus if a new opportunity is more valuable.
//
// Rules:
// 1. Can only propose ONE mission shift per cycle
// 2. Must show ROI comparison: effort invested vs. revenue/value generated
// 3. Old mission moves to "on-hold" (not deleted), new mission becomes ACTIVE
// 4. Needs operator veto period (24h) OR auto-approval if set
//
// Example: Research mission finds "RapidAPI pays 60% revenue share on 10K downloads"
// vs. Revenue mission stuck on "waiting for domain".
// → Proposal: "Shift from Revenue (blocked) to RapidAPI listing (high ROI). Move revenue to hold."
// → If approved: RapidAPI becomes primary mission, Revenue paused until domain ready

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

(async () => {
  try {
    console.log('MISSION REBALANCING: analyzing ROI');

    const m = await call('GET', '/missions');
    const missions = (m.missions || []).filter((x) => x.state === 'ACTIVE');

    if (missions.length < 2) {
      console.log('  → only one active mission; no rebalancing needed');
      process.exit(0);
    }

    // Compute ROI for each mission: committed_cloud_spend vs. expected_value
    const missionROI = [];
    for (const mission of missions) {
      const c = (await call('GET', `/commitments?missionId=${encodeURIComponent(mission.id)}`)).commitments || [];
      const runnable = c.filter((x) => String(x.execution?.kind || '').trim());
      const blocked = c.length - runnable.length;

      // Heuristic: if > 50% blocked, ROI is low. If all runnable, ROI is high.
      const blockageRatio = blocked / (c.length || 1);
      const roiScore = 1 - blockageRatio; // 1 = full ROI, 0 = fully blocked

      // Value estimate: revenue missions > research missions > resilience
      let valueMultiplier = 1;
      if (mission.tags?.includes('revenue')) valueMultiplier = 3;
      if (mission.tags?.includes('research')) valueMultiplier = 1.5;

      const estimatedROI = roiScore * valueMultiplier;

      missionROI.push({
        id: mission.id,
        name: mission.objective.split('\n')[0].slice(0, 60),
        roiScore,
        blockageRatio,
        valueMultiplier,
        estimatedROI,
        openCommitments: c.length,
        runnableCommitments: runnable.length,
        blockedCommitments: blocked,
      });

      console.log(`  ${mission.id.slice(-8)} ROI=${estimatedROI.toFixed(2)} (score=${roiScore.toFixed(2)} × value=${valueMultiplier}) | ${runnable.length}/${c.length} runnable`);
    }

    const sorted = missionROI.sort((a, b) => b.estimatedROI - a.estimatedROI);
    const bestROI = sorted[0];
    const worstROI = sorted[sorted.length - 1];

    // Only propose if best is >2x better than worst
    const roiGap = bestROI.estimatedROI / (worstROI.estimatedROI || 0.1);
    if (roiGap < 2) {
      console.log(`  → ROI gap only ${roiGap.toFixed(1)}x; no major divergence needed`);
      process.exit(0);
    }

    console.log(`\nPROPOSAL: Shift focus from "${worstROI.name}" to "${bestROI.name}"`);
    console.log(`  Gap: ${roiGap.toFixed(1)}x better ROI (${bestROI.estimatedROI.toFixed(2)} vs ${worstROI.estimatedROI.toFixed(2)})`);
    console.log(`  Worst mission: ${worstROI.blockedCommitments}/${worstROI.openCommitments} blocked (${(worstROI.blockageRatio * 100).toFixed(0)}%)`);
    console.log(`  Best mission: ${bestROI.runnableCommitments}/${bestROI.openCommitments} runnable (${(bestROI.roiScore * 100).toFixed(0)}%)`);

    if (!DRY_RUN) {
      const ev = await call('POST', '/evidence', {
        kind: 'mission-rebalance-proposed',
        claim: `Mission rebalance: deprioritize low-ROI, boost high-ROI`,
        source: 'mission-rebalance-engine',
        verified: false,
        data: {
          proposedSwitch: {
            deprioritize: { id: worstROI.id, name: worstROI.name, currentROI: worstROI.estimatedROI },
            prioritize: { id: bestROI.id, name: bestROI.name, projectedROI: bestROI.estimatedROI },
          },
          roiGap,
          reason: `${worstROI.blockedCommitments} blocked commitments blocking low-ROI mission`,
          operatorAction: `Review: should we hold "${worstROI.name}" and shift resources to "${bestROI.name}"?`,
          proposedAt: new Date().toISOString(),
          vetoPeriod: '24 hours',
        },
      });

      console.log(`\nRecorded as evidence: ${ev.evidence.id}`);
      console.log('Veto period: 24 hours. Operator can block this rebalance.');
    }
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
