// Operator 2026-10-09: "viktigast i hela ide att man alltid kan få svar och hjälp".
import test from 'node:test';
import assert from 'node:assert/strict';
import { auraAlwaysAnswers, auraStatusReply, auraStatusHints } from '../../agents/lib/aura-always-answers.mjs';

const reply = (text, provider = 'groq') => ({ success: true, reply: text, text, provider, model: 'm' });
const status = failures => auraStatusReply(failures);

test('the chosen provider answers when it can', async () => {
  const asked = [];
  const r = await auraAlwaysAnswers({ choice: { providerId: 'deepseek', model: 'deepseek-flash' }, ask: async c => { asked.push(c); return reply('svar', 'deepseek'); }, status });
  assert.equal(r.reply, 'svar');
  assert.equal(r.fallback, undefined);
  assert.equal(asked.length, 1);
});

test('a blocked, empty or broken provider falls back to SEER, and the answer says which failed and why', async () => {
  for (const failure of [new Error('PROVIDER_HTTP_402: Insufficient Balance'), new Error('AURA_CLOUD_DENIED:DAILY_BUDGET_LIMIT'), new Error('something unexpected'), null]) {
    const seen = [];
    const r = await auraAlwaysAnswers({
      choice: { providerId: 'deepseek', model: 'deepseek-flash' },
      ask: async c => { if (c) { if (failure) throw failure; return reply('  '); } return reply('via seer'); },
      status, onFallback: f => seen.push(f),
    });
    assert.equal(r.reply, 'via seer');
    assert.equal(r.fallback.from, 'deepseek/deepseek-flash');
    assert.equal(r.fallback.reason, failure ? failure.message : 'AURA_EMPTY_REPLY');
    assert.equal(seen.length, 1);
  }
});

test('when no model can answer, Aura answers itself, says so, and tells the operator what to do', async () => {
  const noModel = [];
  const r = await auraAlwaysAnswers({
    choice: { providerId: 'deepseek', model: 'deepseek-flash' },
    ask: async c => { throw new Error(c ? 'PROVIDER_HTTP_402: {"error":{"message":"Insufficient Balance"}}' : 'SEER_BRAIN_HTTP_503 [groq:PROVIDER_HTTP_ERROR:429]'); },
    status, onNoModel: f => noModel.push(f),
  });
  assert.equal(r.success, true);
  assert.equal(r.degraded, true);
  assert.deepEqual([r.provider, r.model], ['aura', 'status'], 'never presented as a model answer');
  assert.match(r.reply, /^Ingen AI-modell kunde svara just nu/);
  assert.match(r.reply, /DeepSeek-kontot är tomt/);
  assert.match(r.reply, /SEER svarar inte/);
  assert.match(r.reply, /- deepseek\/deepseek-flash: PROVIDER_HTTP_402/);
  assert.equal(noModel[0].length, 2);
});

test('without a chosen provider SEER is asked once; an empty SEER answer still ends in Aura\'s status answer', async () => {
  let calls = 0;
  const r = await auraAlwaysAnswers({ choice: null, ask: async () => { calls++; return reply(''); }, status });
  assert.equal(calls, 1);
  assert.equal(r.degraded, true);
  assert.match(r.reply, /SEER: AURA_EMPTY_REPLY/);
});

test('status hints: budget with headroom, used-up quota, local models, and a generic hint when nothing matches', () => {
  const hints = auraStatusHints(['groq: AURA_CLOUD_DENIED:DAILY_BUDGET_LIMIT', 'ollama-cloud: PROVIDER_HTTP_429 You reached the Free usage limit'], { headroomUsd: 0.16, localModels: ['gemma3:4b-cpu'] });
  assert.ok(hints.some(h => /molnbudget för i dag är slut\. Kvar i dag: 0\.16 USD/.test(h)));
  assert.ok(hints.some(h => /Gratiskvoten/.test(h)));
  assert.ok(hints.some(h => /gemma3:4b-cpu/.test(h)));
  assert.deepEqual(auraStatusHints(['x: odd']), ['Försök igen om en stund. Felorsakerna nedan visar vad som hände.']);
});
