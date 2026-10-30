import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';
import {
  mountLegacyPlanRoutes, LEGACY_PLAN_WRITE_PATHS,
  retiredLegacyPlanMutation,
} from '../../runtime/src/server/plan/legacyPlanRoutes.mjs';

const root = process.cwd();
const serverSource = () => readFileSync(path.join(root, 'runtime/server.ts'), 'utf8');

async function fixture(t) {
  let mutations = 0;
  const plan = Object.freeze({ id: 'legacy-1', status: 'pending', subgoals: [], source: 'historical' });
  const app = express();
  app.use(express.json());
  mountLegacyPlanRoutes(app, {
    listPlans: () => [plan],
    getPlan: id => id === plan.id ? plan : null,
    getNextStep: () => null,
    needsReplanning: () => false,
  });
  app.post('/api/market-watch/inject-context', retiredLegacyPlanMutation);
  app.use((_req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    plan, mutations: () => mutations,
  };
}

test('historical plan reads remain available and never synthesize execution proof', async t => {
  const f = await fixture(t);
  const list = await fetch(f.url + '/api/plans');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  const body = await list.json();
  assert.deepEqual(body.plans, [f.plan]);
  const detail = await fetch(f.url + '/api/plans/legacy-1');
  assert.equal(detail.status, 200);
  const j = await detail.json();
  assert.deepEqual(j.plan, f.plan);
  assert.equal(j.nextStep, null);
  assert.equal(j.needsReplanning, false);
  assert.equal((await fetch(f.url + '/api/plans/unknown')).status, 404);
});

test('every historical plan writer and execution endpoint returns 410, does not mutate history', async t => {
  const f = await fixture(t);
  assert.equal(LEGACY_PLAN_WRITE_PATHS.length, 10);
  assert.equal(new Set(LEGACY_PLAN_WRITE_PATHS).size, 10);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-retired-shell-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'shell-was-executed.txt');
  const command = `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'UNAUTHORIZED')"`;
  const payload = {
    command, stepId: 'step1', success: true, result: 'fake success',
    goalDescription: 'fake', description: 'fake', blockerId: 'fake',
    planId: 'legacy-1', customNote: 'fake',
  };
  for (const route of LEGACY_PLAN_WRITE_PATHS) {
    const url = f.url + route.replace(':id', 'legacy-1');
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 410, route);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const j = await response.json();
    assert.deepEqual(j, {
      success: false, error: 'LEGACY_PLAN_EXECUTION_RETIRED',
      historicalPlansRetained: true, migrated: false,
      next: '/api/aura/workbench/start-goal', nextMethod: 'POST',
    });
  }
  const heartbeat = await fetch(f.url + '/api/plans/heartbeat/status');
  assert.equal(heartbeat.status, 410);
  const injection = await fetch(f.url + '/api/market-watch/inject-context', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(injection.status, 410);
  assert.equal(existsSync(marker), false, 'Old API must never run shell commands');
  const reread = await (await fetch(f.url + '/api/plans/legacy-1')).json();
  assert.equal(reread.plan.status, 'pending');
  assert.equal(f.mutations(), 0);
});

test('canonical server has no direct legacy shell execution or write-through bypass', () => {
  const server = serverSource();
  assert.match(server, /mountLegacyPlanRoutes\(app, \{ listPlans, getPlan, getNextStep, needsReplanning \}\)/);
  assert.match(server, /app\.post\("\/api\/market-watch\/inject-context", retiredLegacyPlanMutation\)/);
  for (const forbidden of [
    'execAsync(cmdToRun', 'updatePlanOutcome(', 'abandonSubgoalInPlan(',
    'addSubgoalToPlan(', 'savePlan(', 'decideNextStep(', 'generateComprehensiveBlueprint(',
  ]) {
    assert.equal(server.includes(forbidden), false, `Legacy write bypass retained: ${forbidden}`);
  }
  // Canonical mission entry still exists, including its local operator gate.
  assert.match(server, /app\.post\('\/api\/aura\/workbench\/start-goal', requireLocalUi/);
});
