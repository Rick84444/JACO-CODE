import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listVoices, pickAuraVoice, saveAuraVoice, readAuraVoice, placeCall, callCeiling, blandConfigured } from '../../agents/lib/bland.mjs';

const KEY = 'org_testkey_not_real_0123456789';
const envFor = (extra = {}) => ({ BLAND_API_KEY: KEY, JACO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'bland-')), ...extra });
const reply = (status, json) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => json });
const spy = (status, json) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return reply(status, json)(); }; f.calls = calls; return f; };
const VOICES = { voices: [
  { id: 'a', name: 'Helga', tags: ['Swedish', 'Female', 'cloned'], public: true, average_rating: 1, total_ratings: 1 },
  { id: 'b', name: 'Sven', tags: ['Swedish', 'Male'], public: true, average_rating: 5, total_ratings: 9 },
  { id: 'c', name: 'Helga 2', tags: ['Swedish', 'Female'], public: true, average_rating: 3, total_ratings: 2 },
  { id: 'd', name: 'Josh', tags: ['English', 'Male'], public: true, average_rating: 4, total_ratings: 7 },
] };

test('voices are listed with the key as the authorization header and filtered by language', async () => {
  const f = spy(200, VOICES);
  const sv = await listVoices({ language: 'Swedish', env: envFor(), fetchImpl: f });
  assert.deepEqual(sv.map(v => v.id).sort(), ['a', 'b', 'c']);
  assert.equal(f.calls[0].url, 'https://api.bland.ai/v1/voices');
  assert.equal(f.calls[0].init.headers.authorization, KEY);
  assert.equal((await listVoices({ env: envFor(), fetchImpl: spy(200, VOICES) })).length, 4);
});

test("Aura's voice is the language, then a female voice, then the best rated; none fits gives null", async () => {
  const voices = await listVoices({ env: envFor(), fetchImpl: spy(200, VOICES) });
  assert.equal(pickAuraVoice(voices).id, 'c');
  assert.equal(pickAuraVoice(voices, { gender: 'male' }).id, 'b');
  assert.equal(pickAuraVoice(voices, { language: 'Finnish' }), null);
});

test('the chosen voice is kept privately and read back', () => {
  const env = envFor();
  assert.equal(readAuraVoice(env), null);
  const saved = saveAuraVoice({ id: 'c', name: 'Helga 2' }, { language: 'Swedish', env });
  assert.equal(readAuraVoice(env).id, 'c');
  assert.equal(saved.provider, 'bland');
  assert.equal(fs.statSync(path.join(env.JACO_STATE_DIR, 'aura-voice.json')).mode & 0o777, 0o600);
  assert.throws(() => saveAuraVoice({}, { env }), /VOICE_REQUIRED/);
});

test('a missing, rejected or unreachable key is told apart and never printed', async () => {
  await assert.rejects(listVoices({ env: { JACO_STATE_DIR: envFor().JACO_STATE_DIR }, fetchImpl: spy(200, VOICES) }), /BLAND_KEY_MISSING/);
  assert.equal(blandConfigured({ JACO_STATE_DIR: envFor().JACO_STATE_DIR }), false);
  await assert.rejects(listVoices({ env: envFor(), fetchImpl: spy(401, {}) }), /BLAND_KEY_REJECTED/);
  await assert.rejects(listVoices({ env: envFor(), fetchImpl: async () => { throw new Error(`boom ${KEY}`); } }), error => /BLAND_UNREACHABLE/.test(error.message) && !error.message.includes(KEY));
});

test('a call needs the confirmed number, a valid length and a cost ceiling, and sends nothing otherwise', async () => {
  const f = spy(200, { call_id: 'c1', status: 'success' });
  const base = { to: '+46701234567', confirmTo: '+46701234567', task: 'Boka en tid', env: envFor(), fetchImpl: f };
  await assert.rejects(placeCall({ ...base, confirmTo: '' }), /OPERATOR_CONFIRMATION_REQUIRED/);
  await assert.rejects(placeCall({ ...base, confirmTo: '+46700000000' }), /OPERATOR_CONFIRMATION_REQUIRED/);
  await assert.rejects(placeCall({ ...base, to: '0701234567', confirmTo: '0701234567' }), /E164/);
  await assert.rejects(placeCall({ ...base, task: ' ' }), /CALL_TASK_REQUIRED/);
  await assert.rejects(placeCall({ ...base, maxMinutes: 30 }), /CALL_LENGTH_LIMIT/);
  await assert.rejects(placeCall({ ...base, maxMinutes: 5, env: envFor({ BLAND_MAX_USD_PER_CALL: '0.30' }) }), /CALL_COST_CEILING/);
  assert.equal(f.calls.length, 0, 'every refusal happened before any request');
  const ok = await placeCall({ ...base, maxMinutes: 2 });
  assert.equal(ok.callId, 'c1');
  assert.deepEqual(ok.ceiling, callCeiling({ maxMinutes: 2 }));
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.phone_number, '+46701234567');
  assert.equal(body.max_duration, 2);
  assert.equal(body.record, false);
});

test("a call uses Aura's saved voice unless one is given", async () => {
  const env = envFor();
  saveAuraVoice({ id: 'voice-c', name: 'Helga 2' }, { env });
  const f = spy(200, { call_id: 'c2' });
  await placeCall({ to: '+46701234567', confirmTo: '+46701234567', task: 't', env, fetchImpl: f });
  assert.equal(JSON.parse(f.calls[0].init.body).voice, 'voice-c');
});
