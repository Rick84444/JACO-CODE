import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the production service with model/measurement boundaries stubbed.
// No network, provider credentials or LLM inference is used in these tests.
async function service(modelText = '{}', modelFails = false) {
  let source = fs.readFileSync(new URL('../../runtime/src/server/agents/marketWatchService.ts', import.meta.url), 'utf8');
  source = source.replace(/import \{ generate \}[^;]+;/, `let calls=0; const generate=async()=>{ calls++; ${modelFails ? "throw new Error('offline');" : `return {text:${JSON.stringify(modelText)}};`} }; export const modelCalls=()=>calls;`)
    .replace(/import \{ recordExternalMeasurement \}[^;]+;/, 'const recordExternalMeasurement=()=>{};')
    .replace(/import \{ CompetitiveIntelligenceMemoryItem[^;]+;/, '');
  const mod = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}#${Math.random()}`);
  mod.marketWatchService.stopPeriodicScan();
  return { instance: new mod.MarketWatchService(), calls: mod.modelCalls };
}
const analysis = { observedUpdate: 'Model claim: faster execution', architecturalBreakdown: 'An interpretation, not measured.',
  compressedDigest: 'Hypothesis only', tacticalCounterStrategy: 'Run a benchmark', impactOnUpcomingPlans: 'Compare outcomes',
  sourceUrls: ['https://invented.test'], confidenceScore: 100, evidence: {status:'VERIFIED'} };

test('Market Watch starts with no invented history or seed knowledge', async () => {
  const {instance} = await service();
  const state = instance.getState();
  assert.equal(state.totalScansCompleted, 0);
  assert.equal(state.lastScanTimestamp, null);
  assert.deepEqual(state.recentIntelligence, []);
  assert.ok(state.trackedTargets.every(t => t.lastScannedAt === null && t.discoveredSignalsCount === 0));
  assert.doesNotMatch(instance.getMarketWatchReasoningContext(), /96%|99.2%|ALWAYS/);
});

test('failed retrieval creates no insight and never calls the model', async t => {
  t.mock.method(globalThis, 'fetch', async () => {throw new Error('unavailable');});
  const {instance,calls} = await service(JSON.stringify(analysis));
  const result = await instance.executeOpenClawScrape('target_cursor');
  assert.equal(result.success, false);
  assert.equal(result.item, null);
  assert.equal(calls(), 0);
  assert.deepEqual(instance.listIntelligence(), []);
});

test('invalid model JSON and provider failure cannot manufacture successful insights', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok:true,text:async()=>'<p>Retrieved source</p>'}));
  for (const [text,fails] of [['not json',false],['{}',false],['{}',true]]) {
    const {instance} = await service(text,fails);
    assert.equal((await instance.executeOpenClawScrape('target_cursor')).success, false);
    assert.deepEqual(instance.listIntelligence(), []);
  }
});

test('retrieved analysis retains provenance but cannot self-promote to verified knowledge', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok:true,text:async()=>'<p>Retrieved source</p>'}));
  const {instance} = await service(JSON.stringify(analysis));
  const result = await instance.executeOpenClawScrape('target_cursor');
  assert.equal(result.success, true);
  assert.equal(result.item.evidence.status, 'HYPOTHESIS');
  assert.match(result.item.evidence.sourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.item.sourceUrls, ['https://docs.cursor.com/agent/subgoals']);
  instance.setAutoInject(true);
  const context = instance.getMarketWatchReasoningContext();
  assert.match(context, /UNVERIFIED HYPOTHESES/);
  assert.match(context, /not independently verified/);
  assert.doesNotMatch(context, /Model claim|faster execution|Run a benchmark/);
  assert.equal(result.item.confidenceScore, 0);
  assert.doesNotMatch(context, /TASK PLANNING DIRECTIVES|invented.test/);
  instance.setAutoInject(false);
  assert.equal(instance.getMarketWatchReasoningContext(), '');
});
