// Operator 2026-10-09: "viktigast i hela ide att man alltid kan få svar och hjälp".
import test from 'node:test';
import assert from 'node:assert/strict';
import { auraAlwaysAnswers, answerInOrder, auraStatusReply, auraStatusHints, answerWithin, auraChatDeadlines } from '../../agents/lib/aura-always-answers.mjs';

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
  assert.match(r.reply, /^No AI model could answer right now/);
  assert.match(r.reply, /The DeepSeek account is empty/);
  assert.match(r.reply, /SEER is not answering/);
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
  assert.ok(hints.some(h => /cloud budget for today is used up\. Headroom today: 0\.16 USD/.test(h)));
  assert.ok(hints.some(h => /free quota/.test(h)));
  assert.ok(hints.some(h => /gemma3:4b-cpu/.test(h)));
  assert.deepEqual(auraStatusHints(['x: odd']), ['Try again in a moment. The failure causes below show what happened.']);
});

test('a model that never answers ends in a timeout the status answer can explain', async () => {
  await assert.rejects(answerWithin(new Promise(() => {}), 20), /AURA_MODEL_TIMEOUT/);
  assert.equal(await answerWithin(Promise.resolve('ok'), 1000), 'ok');
  assert.ok(auraStatusHints(['SEER: AURA_MODEL_TIMEOUT after 90 s']).some(h => /Chat settings/.test(h)));
  assert.ok(auraStatusHints(['deepseek/x: AURA_CLOUD_DENIED:CLOUD_DISABLED_BY_POLICY']).some(h => /Allow cloud models/.test(h)));
});

test('chat deadlines have defaults and ignore invalid overrides', () => {
  assert.deepEqual(auraChatDeadlines({}), { chosenMs: 120000, defaultMs: 90000, fallbackMs: 45000, localMs: 150000 });
  assert.equal(auraChatDeadlines({ JACO_AURA_CHAT_DEFAULT_MS: '5000' }).defaultMs, 5000);
  assert.equal(auraChatDeadlines({ JACO_AURA_CHAT_DEFAULT_MS: 'soon' }).defaultMs, 90000);
});

test('a cloud provider that is out of balance does not hide the local model: every fallback is tried in order', async () => {
  const asked = [];
  const r = await answerInOrder(
    [{ choice: { providerId: 'deepseek', model: 'flash' }, ms: 1000 }, { choice: { providerId: 'ollama', model: 'gemma3:4b' }, ms: 1000 }],
    async c => { asked.push(c.providerId); if (c.providerId === 'deepseek') throw new Error('PROVIDER_HTTP_402: Insufficient Balance'); return reply('lokalt svar', 'ollama'); },
    new Error('SEER_BRAIN_HTTP_503'),
  );
  assert.equal(r.reply, 'lokalt svar');
  assert.deepEqual(asked, ['deepseek', 'ollama']);
});

test('when every fallback fails, the error keeps all failures so the status answer can explain each one', async () => {
  await assert.rejects(
    answerInOrder([{ choice: { providerId: 'deepseek', model: 'flash' }, ms: 1000 }, { choice: { providerId: 'ollama', model: 'gemma3:4b' }, ms: 1000 }],
      async c => { throw new Error(c.providerId === 'deepseek' ? 'PROVIDER_HTTP_402' : 'fetch failed'); }, new Error('SEER_BRAIN_HTTP_503')),
    /SEER_BRAIN_HTTP_503 \| deepseek\/flash: PROVIDER_HTTP_402 \| ollama\/gemma3:4b: fetch failed/);
});

test('a fallback that hangs is dropped at its deadline so the next one still answers', async () => {
  const r = await answerInOrder(
    [{ choice: { providerId: 'slow', model: 'm' }, ms: 1000 }, { choice: { providerId: 'ollama', model: 'g' }, ms: 1000 }],
    c => c.providerId === 'slow' ? new Promise(() => {}) : Promise.resolve(reply('klart', 'ollama')));
  assert.equal(r.reply, 'klart');
});
