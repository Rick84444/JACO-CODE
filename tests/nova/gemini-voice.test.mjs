// 2026-11-25: Aura's speech through Gemini's speech model, budgeted; and no web addresses read aloud.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiSpeak, geminiVoiceQuote, geminiVoiceCost, pcmToWav, GEMINI_TTS_MODEL } from '../../runtime/src/server/connected/geminiVoice.mjs';
import { speechParts } from '../../runtime/src/lib/speechParts.mjs';

function governor(allowed = true) {
  const log = [];
  return { log, authorizeCloud: a => { log.push(['reserve', a]); return allowed ? { allowed: true, reservationId: 'r1' } : { allowed: false, reason: 'DAILY_BUDGET_LIMIT' }; },
    settleCloud: (id, usd) => log.push(['settle', id, usd]), releaseReservation: (id, why) => log.push(['release', id, why]),
    markCloudOutcomeUnknown: (id, why) => log.push(['unknown', id, why]) };
}
const pcm = Buffer.alloc(4800, 1);
const ok = async (url, init) => ({ ok: true, json: async () => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }],
  usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 250 }, _url: url, _init: init }) });

test('Gemini speech is reserved first, settled from usage, and returned as playable WAV', async () => {
  const economic = governor(); let sent;
  const wav = await geminiSpeak('Hej, jag heter Aura.', { apiKey: 'k', economic, fetchImpl: async (url, init) => { sent = { url, init }; return ok(url, init); } });
  assert.match(sent.url, new RegExp(`/models/${GEMINI_TTS_MODEL}:generateContent$`));
  assert.equal(sent.init.headers['x-goog-api-key'], 'k');
  const body = JSON.parse(sent.init.body);
  assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
  assert.match(body.contents[0].parts[0].text, /Hej, jag heter Aura\.$/);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF'); assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.length, 44 + pcm.length);
  assert.equal(economic.log[0][0], 'reserve'); assert.equal(economic.log[0][1].metadata.providerId, 'gemini');
  assert.deepEqual(economic.log[1], ['settle', 'r1', geminiVoiceCost({ promptTokenCount: 30, candidatesTokenCount: 250 })]);
});

test('no call when the budget says no, and no billing claim on a refused request', async () => {
  let called = false;
  await assert.rejects(geminiSpeak('x', { apiKey: 'k', economic: governor(false), fetchImpl: async () => { called = true; } }), /GEMINI_VOICE_DENIED:DAILY_BUDGET_LIMIT/);
  assert.equal(called, false);
  const economic = governor();
  await assert.rejects(geminiSpeak('x', { apiKey: 'k', economic, fetchImpl: async () => ({ ok: false, status: 429 }) }), /GEMINI_VOICE_HTTP_429/);
  assert.equal(economic.log[1][0], 'release');
  const lost = governor();
  await assert.rejects(geminiSpeak('x', { apiKey: 'k', economic: lost, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /UNREACHABLE/);
  assert.equal(lost.log[1][0], 'unknown', 'a dispatched call without an answer may have been billed');
  await assert.rejects(geminiSpeak('x', { apiKey: '', economic: governor() }), /GEMINI_KEY_MISSING/);
});

test('the quote is an upper bound for a typical sentence', () => {
  const q = geminiVoiceQuote('Jag har sökt på Kiruna åt dig och första träffen var kommunens webbplats.');
  assert.ok(q.estimatedUsd > 0 && q.estimatedUsd < 0.01);
  assert.equal(pcmToWav(Buffer.alloc(2)).length, 46);
});

test('web addresses, link targets and source notes are not read aloud', () => {
  const parts = speechParts('Trend ett är agenter **i företag** (Källa: https://cloud.google.com/x). Läs [rapporten](https://example.com/r) eller www.salesforce.com/blog idag.');
  const spoken = parts.join(' ');
  assert.doesNotMatch(spoken, /https?:|www\.|\*\*/);
  assert.match(spoken, /Trend ett är agenter i företag\./);
  assert.match(spoken, /Läs rapporten eller idag\./);
});
