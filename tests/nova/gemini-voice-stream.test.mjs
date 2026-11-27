// Aura starts speaking while the speech is still being generated. Fixtures only; nothing here reaches Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { geminiSpeakStream, geminiStreamPrice, GEMINI_TTS_STREAM_MODEL } from '../../runtime/src/server/connected/geminiVoice.mjs';
import { pcmSamples } from '../../runtime/src/lib/speechParts.mjs';

const events = list => new Response(list.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n');
const audio = bytes => ({ event_type: 'step.delta', delta: { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000, data: Buffer.from(bytes).toString('base64') } });
const completed = { event_type: 'interaction.completed', interaction: { usage: { total_input_tokens: 10, total_output_tokens: 100 } } };
function governor(allowed = true) {
  const log = [];
  return { log, authorizeCloud: q => { log.push(['reserve', q.estimatedUsd > 0]); return allowed ? { allowed, reservationId: 'r1' } : { allowed, reason: 'DAILY_BUDGET_LIMIT' }; },
    settleCloud: (id, usd) => log.push(['settle', usd]), releaseReservation: () => log.push(['release']), markCloudOutcomeUnknown: () => log.push(['unknown']) };
}
const options = (fetchImpl, economic, onChunk) => ({ apiKey: 'k', economic, lang: 'sv-SE', fetchImpl, onChunk, now: () => Date.parse('2026-11-27') });

test('sound is handed on piece by piece and the reported usage is settled', async () => {
  const economic = governor(), got = [];
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body), headers: init.headers }; return events([audio([1, 0, 2, 0]), audio([3, 0]), completed]); };
  await geminiSpeakStream('Hej', options(fetchImpl, economic, c => got.push([...c])));
  assert.deepEqual(got, [[1, 0, 2, 0], [3, 0]]);
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(sent.body.model, GEMINI_TTS_STREAM_MODEL);
  assert.equal(sent.body.stream, true);
  assert.equal(sent.headers['x-goog-api-key'], 'k');
  assert.deepEqual(economic.log, [['reserve', true], ['settle', (10 * 0.5 + 100 * 9) / 1e6]]);
});

test('the price follows Google\'s announced change on 2027-01-01', () => {
  assert.deepEqual(geminiStreamPrice(Date.parse('2026-12-31T23:00:00Z')), { input: 0.5, output: 9 });
  assert.deepEqual(geminiStreamPrice(Date.parse('2027-01-01T00:00:00Z')), { input: 1, output: 18 });
});

test('a refused budget, an HTTP error and a broken stream never look like speech', async () => {
  await assert.rejects(geminiSpeakStream('Hej', options(async () => { throw Error('must not be called'); }, governor(false), () => {})), /GEMINI_VOICE_DENIED/);
  const http = governor();
  await assert.rejects(geminiSpeakStream('Hej', options(async () => new Response('no', { status: 429 }), http, () => {})), /GEMINI_VOICE_HTTP_429/);
  assert.deepEqual(http.log.at(-1), ['release']);
  const silent = governor();
  await assert.rejects(geminiSpeakStream('Hej', options(async () => events([completed]), silent, () => {})), /GEMINI_VOICE_EMPTY/);
  const cut = governor();
  await assert.rejects(geminiSpeakStream('Hej', options(async () => events([audio([1, 0])]), cut, () => {})), /GEMINI_VOICE_INCOMPLETE/);
  assert.deepEqual(cut.log.at(-1), ['unknown']);
});

test('samples survive a piece that ends in the middle of one', () => {
  const first = pcmSamples(null, new Uint8Array([0x00, 0x40, 0x00]));
  assert.deepEqual([...first.samples], [0.5]);
  const second = pcmSamples(first.carry, new Uint8Array([0xc0]));
  assert.deepEqual([...second.samples], [-0.5]);
  assert.equal(second.carry, null);
});

test('the runtime offers the stream and the stage falls back to a whole file', () => {
  const server = fs.readFileSync(new URL('../../runtime/server.ts', import.meta.url), 'utf8');
  assert.match(server, /app\.post\('\/api\/aura\/voice\/stream', requireLocalUiSameOrigin/);
  const stage = fs.readFileSync(new URL('../../runtime/operator-stage/stage.js', import.meta.url), 'utf8');
  assert.match(stage, /\/api\/aura\/voice\/stream/);
  assert.match(stage, /\/api\/aura\/voice\/speak/);
});
