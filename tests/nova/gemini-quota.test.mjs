import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EconomicGovernor } from '../../runtime/src/server/continuum/economicGovernor.mjs';
import {
  AI_STUDIO_GEMINI_LIMITS, AI_STUDIO_QUOTA_SOURCE, normalizedGeminiModel,
  pacificQuotaDay, defaultGeminiQuotaProfile, inspectGeminiQuota,
  recordGeminiQuotaReservation, reconcileGeminiQuotaUsage, markGeminiQuotaBackoff,
  geminiQuotaSnapshot,
} from '../../runtime/src/server/aura/geminiQuota.mjs';
import { createEconomicBudgetRouter } from '../../runtime/src/server/connected/economicBudget.mjs';

const create = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-gemini-rate-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const events = { list: [], append(entry) { this.list.push(entry); } };
  return { g: new EconomicGovernor(root, events), root, events };
};
const rate = (g, model = 'models/gemini-2.5-flash', input = 100, purpose = 'nova-ollama-cloud') =>
  g.authorizeCloud({ purpose, estimatedUsd: 0.01, metadata: {
    providerId: 'gemini', model,
    auraCostQuote: { maxInputTokens: input },
  }});

test('AI Studio 2026-10-31 snapshot is per model and does not import 28-day peak usage', () => {
  assert.equal(Object.keys(AI_STUDIO_GEMINI_LIMITS).length, 43);
  const flash = AI_STUDIO_GEMINI_LIMITS['gemini-2.5-flash'];
  assert.deepEqual([flash.rpm, flash.tpm, flash.rpd], [2000, 3000000, 100000]);
  const tts = AI_STUDIO_GEMINI_LIMITS['gemini-2.5-pro-tts'];
  assert.deepEqual([tts.rpm, tts.tpm, tts.rpd], [250, 25000, 2500]);
  assert.equal(AI_STUDIO_GEMINI_LIMITS['gemini-2.5-flash-lite'].rpd, null, 'Unlimited RPD is not zero');
  assert.equal(AI_STUDIO_GEMINI_LIMITS['gemini-omni-1.1-flash'].tpm, null);
  assert.equal(AI_STUDIO_QUOTA_SOURCE.projectAssociationVerified, false);
  assert.equal(AI_STUDIO_QUOTA_SOURCE.providerUsageIncluded, false);
  assert.equal(normalizedGeminiModel('models/GEMINI-2.5-FLASH'), 'gemini-2.5-flash');
  assert.equal(normalizedGeminiModel('gemini-2.0-flash'), 'gemini-2-flash');
  assert.equal(normalizedGeminiModel('gemini-2.5-pro-preview-tts'), 'gemini-2.5-pro-preview-tts',
    'unknown model version must never silently share a different model quota');
  const p = defaultGeminiQuotaProfile();
  assert.equal(geminiQuotaSnapshot({}, p).models['gemini-2.5-flash'].usedRpd, 0,
    '28-day peak is historical dashboard data, not current JACO usage');
});

test('JACO quota check is per model, per Pacific day, and persistent across runtime restart', t => {
  const { g, root } = create(t);
  const a = rate(g);
  assert.equal(a.allowed, true);
  assert.equal(rate(g, 'gemini-2.5-flash-lite').allowed, true);
  const observed = g.geminiQuotaSnapshot();
  assert.equal(observed.localOnly, true);
  assert.equal(observed.projectAssociationVerified, false);
  assert.equal(observed.models['gemini-2.5-flash'].usedRpd, 1);
  assert.equal(observed.models['gemini-2.5-flash-lite'].usedRpd, 1);
  assert.equal(observed.models['gemini-2.5-flash'].usedTpm, 100);
  assert.equal(g.snapshot().geminiQuota.models['gemini-2.5-flash'].usedRpm, 1);
  const restarted = new EconomicGovernor(root, { append() {} });
  assert.equal(restarted.geminiQuotaSnapshot().models['gemini-2.5-flash'].usedRpd, 1);
  assert.equal(restarted.geminiQuotaSnapshot().models['gemini-2.5-flash'].usedRpm, 1);
  assert.equal(rate(restarted, 'gemini-3.6-flash').allowed, true, 'other model quota is independent');
  assert.equal(pacificQuotaDay(Date.parse('2026-11-01T06:59:59Z')), '2026-10-31');
  assert.equal(pacificQuotaDay(Date.parse('2026-11-01T07:00:00Z')), '2026-11-01',
    'Daily reset uses midnight Pacific (PDT on 1 Nov 2026), not UTC');
});

test('RPM TPM and RPD refuse reservations before provider dispatch, including unknown models', t => {
  const { g } = create(t);
  g.updateGeminiQuotaProfile({ models: {
    'gemini-2.5-flash': { rpm: 3, tpm: 100, rpd: 5, label: 'Gemini 2.5 Flash', category: 'text' },
  }, observedAt: '2026-10-31' });
  assert.equal(rate(g, 'gemini-2.5-flash', 60).allowed, true);
  assert.equal(rate(g, 'gemini-2.5-flash', 40).reason, 'GEMINI_PROJECT_TPM_LIMIT', '90% local token safety margin');
  // Settled input usage reduces the conservative minute reservation, never the request counts.
  const res = Object.entries(g.state.reservations).find(([, r]) => r.metadata?.model === 'gemini-2.5-flash')[0];
  g.settleCloud(res, 0.001, { prompt_tokens: 10, completion_tokens: 1 });
  assert.equal(rate(g, 'gemini-2.5-flash', 40).allowed, true);
  assert.equal(rate(g, 'gemini-2.5-flash', 10).reason, 'GEMINI_PROJECT_RPM_LIMIT', 'two calls reach 90%-rounded 2 RPM');
  assert.equal(rate(g, 'models/gemini-2.5-pro-preview-tts').reason, 'GEMINI_QUOTA_MODEL_UNCONFIGURED');
  assert.equal(rate(g, 'gemini-2.5-flash', 0).reason, 'GEMINI_QUOTA_INPUT_REQUIRED');
  assert.equal(g.state.geminiQuota.days[pacificQuotaDay()][ 'gemini-2.5-flash'], 2);
});

test('RPD resets at Pacific midnight and cannot be reset by restarting or rotating keys', () => {
  const state = {}, profile = defaultGeminiQuotaProfile();
  profile.models['gemini-2.5-flash'] = {rpm:100, tpm:100000, rpd:2};
  const before = Date.parse('2026-11-01T06:59:59.000Z');
  const after = Date.parse('2026-11-01T07:00:00.001Z');
  let q = inspectGeminiQuota(state, profile, { model:'gemini-2.5-flash', inputTokenBudget:100, at:before });
  assert.equal(q.allowed, true);
  recordGeminiQuotaReservation(state, q, 'first', before);
  assert.equal(inspectGeminiQuota(state, profile, {model:'gemini-2.5-flash',inputTokenBudget:100,at:before}).reason,
    'GEMINI_PROJECT_RPD_LIMIT', '90% of two requests rounds down to one');
  q = inspectGeminiQuota(state, profile, { model:'gemini-2.5-flash', inputTokenBudget:100, at:after });
  assert.equal(q.allowed, true);
  recordGeminiQuotaReservation(state, q, 'second', after);
  assert.equal(geminiQuotaSnapshot(state,profile,after).models['gemini-2.5-flash'].usedRpd, 1);
});

test('429 pauses the model and retains the quota request even if money is released', t => {
  const { g, root } = create(t);
  const a = rate(g);
  assert.equal(a.allowed, true);
  g.releaseReservation(a.reservationId, 'provider returned HTTP 429 without generating');
  const denied = rate(g);
  assert.equal(denied.reason, 'GEMINI_PROVIDER_BACKOFF');
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 60000);
  assert.equal(g.geminiQuotaSnapshot().models['gemini-2.5-flash'].usedRpd, 1);
  assert.equal(new EconomicGovernor(root, { append() {} }).geminiQuotaSnapshot().models['gemini-2.5-flash'].usedRpd, 1);
  assert.equal(rate(g, 'gemini-2.5-flash-lite').allowed, true, 'independent model remains routable');
});

test('local-only RPM/TPM count expires, cloud counters are not invoices', () => {
  const profile = defaultGeminiQuotaProfile();
  const state = {};
  const at = Date.parse('2026-10-31T21:00:00Z');
  const q = inspectGeminiQuota(state,profile,{model:'gemini-2.5-flash',inputTokenBudget:100,at});
  recordGeminiQuotaReservation(state,q,'x',at);
  const later=geminiQuotaSnapshot(state,profile,at+61000);
  assert.equal(later.models['gemini-2.5-flash'].usedRpm,0);
  assert.equal(later.models['gemini-2.5-flash'].usedTpm,0);
  assert.equal(later.models['gemini-2.5-flash'].usedRpd,1);
  assert.equal(later.providerUsageIncluded,false);
});

test('quota update validates data, is durable, and does not alter any USD caps', t => {
  const { g,root,events }=create(t);
  const before=g.snapshot().policy;
  for(const bad of [
    { models:{ 'gemini-2.5-flash': {rpm:-1,tpm:3,rpd:4} } },
    { models:{ 'gemini-2.5-flash': {rpm:0,tpm:3,rpd:4} } },
    { models:{ 'gemini-2.5-flash': {rpm:'2000',tpm:3000000,rpd:100000} } },
    { models:{ '../escape': {rpm:3,tpm:3,rpd:3} } },
    { models:{} },
  ]) assert.throws(()=>g.updateGeminiQuotaProfile(bad),/GEMINI_QUOTA_PROFILE_INVALID/);
  const out=g.updateGeminiQuotaProfile({ observedAt:'2026-10-31',models:{
    'gemini-2.5-flash': {label:'Gemini 2.5 Flash',category:'text',rpm:1500,tpm:1000000,rpd:50000},
  }});
  assert.equal(out.models['gemini-2.5-flash'].rpm,1500);
  assert.deepEqual(g.snapshot().policy,before);
  assert.equal(new EconomicGovernor(root,{append(){}}).geminiQuotaSnapshot().models['gemini-2.5-flash'].rpm,1500);
  assert.ok(events.list.some(e=>e.type==='gemini.quota_profile_updated'));
});

test('Aura budget router returns model quota snapshot, validates authenticated import', async t => {
  const { g }=create(t);
  const router=createEconomicBudgetRouter({economic:g,requireOperatorUi:(_req,_res,next)=>next()});
  const find = (path,method) => router.stack.find(l=>l.route?.path===path && l.route.methods[method.toLowerCase()]);
  const invoke = async (route, body) => {
    let result, status = 200;
    await route.route.stack[0].handle({body}, { json: data => {result=data;}, status: code => {status=code;return {json:data=>{result=data;}};} });
    return {result,status};
  };
  const get=await invoke(find('/gemini-quotas','GET'));
  assert.equal(get.status,200);assert.equal(get.result.quota.models['gemini-2.5-flash'].rpm,2000);
  const patch=await invoke(find('/gemini-quotas','PATCH'),{observedAt:'2026-10-31',models:{
    'gemini-2.5-flash': {rpm:100,tpm:10000,rpd:300,category:'text'},
  }});
  assert.equal(patch.status,200);assert.equal(patch.result.quota.models['gemini-2.5-flash'].rpm,100);
  const denied=await invoke(find('/gemini-quotas','PATCH'),{models:{'gemini-2.5-flash':{rpm:-3,tpm:10,rpd:10}}});
  assert.equal(denied.status,400);
});

test('a disabled Aura master cloud switch takes priority over any Gemini quota', t => {
  const {g}=create(t);
  g.updatePolicy({cloudEnabled:false,manualAuraCloudEnabled:true,novaOllamaCloudEnabled:true});
  assert.equal(rate(g).reason,'CLOUD_DISABLED_BY_POLICY');
  assert.equal(g.geminiQuotaSnapshot().models['gemini-2.5-flash'].usedRpd,0);
});
