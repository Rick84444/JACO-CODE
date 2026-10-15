// JACO's phone voice on Bland AI (operator 2026-10-13: "we are creating a phone part; connect the key and
// create Aura's voice"). The key is read like every other credential (environment, else the encrypted
// store as BLAND_API_KEY) and never returned or put in an error. Listing voices and choosing Aura's voice
// are read/local actions. Placing a call is not: it reaches a real person and costs money, so it needs the
// operator's confirmation of the exact number plus a duration and cost ceiling, and nothing in JACO's
// agent tooling calls it on its own.
import fs from 'node:fs';
import path from 'node:path';
import { credential, stateDir } from './secret-store.mjs';

export const BLAND_KEY_NAME = 'BLAND_API_KEY';
const API = 'https://api.bland.ai/v1';
const E164 = /^\+[1-9]\d{6,14}$/;

const keyOf = env => credential(BLAND_KEY_NAME, { env });
export const blandConfigured = (env = process.env) => Boolean(keyOf(env));

async function bland(route, { method = 'GET', body, env = process.env, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const key = keyOf(env);
  if (!key) throw new Error('BLAND_KEY_MISSING');
  const res = await fetchImpl(`${API}${route}`, {
    method, headers: { authorization: key, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs),
  }).catch(error => { throw new Error(`BLAND_UNREACHABLE: ${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}`); });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('BLAND_KEY_REJECTED');
  if (!res.ok) throw new Error(`BLAND_HTTP_${res.status}`);
  return data;
}

const tagsOf = v => (Array.isArray(v.tags) ? v.tags : []).map(String);

/** Public voices with the fields worth choosing by; `language` keeps those tagged with it ("Swedish"). */
export async function listVoices({ language = '', env, fetchImpl } = {}) {
  const data = await bland('/voices', { env, fetchImpl });
  const all = (Array.isArray(data.voices) ? data.voices : []).map(v => ({
    id: String(v.id), name: String(v.name || ''), description: String(v.description || ''), tags: tagsOf(v),
    rating: Number(v.average_rating) || 0, ratings: Number(v.total_ratings) || 0, public: Boolean(v.public),
  }));
  const want = String(language).toLowerCase();
  return want ? all.filter(v => v.tags.some(t => t.toLowerCase() === want)) : all;
}

/** Best match for Aura: the language, then a female voice, then the best rated. Null when none fits. */
export function pickAuraVoice(voices, { language = 'Swedish', gender = 'female' } = {}) {
  const has = (v, tag) => v.tags.some(t => t.toLowerCase() === String(tag).toLowerCase());
  return [...voices.filter(v => has(v, language))]
    .sort((a, b) => (Number(has(b, gender)) - Number(has(a, gender))) || b.rating - a.rating || b.ratings - a.ratings)[0] || null;
}

const voiceFile = env => path.join(stateDir(env), 'aura-voice.json');
export function readAuraVoice(env = process.env) {
  try { return JSON.parse(fs.readFileSync(voiceFile(env), 'utf8')); } catch { return null; }
}
export function saveAuraVoice(voice, { language = '', env = process.env } = {}) {
  if (!voice?.id) throw new Error('VOICE_REQUIRED');
  const file = voiceFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const saved = { schema: 'jaco.aura-voice/v1', provider: 'bland', id: String(voice.id), name: String(voice.name || ''), language: String(language || ''), chosenAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  return saved;
}

/** What a call may cost at most; the rate is a conservative default the operator can set. */
export function callCeiling({ maxMinutes, env = process.env }) {
  const rate = Number(env.BLAND_RATE_USD_PER_MIN) || 0.14;
  return { maxMinutes, rateUsdPerMin: rate, ceilingUsd: Math.round(maxMinutes * rate * 100) / 100 };
}

/**
 * Place one phone call. Refused unless the operator confirmed the exact number (`confirmTo` equals `to`),
 * the number is E.164, the length is within BLAND_MAX_CALL_MINUTES (default 5) and the cost ceiling within
 * BLAND_MAX_USD_PER_CALL (default 1.00). Nothing is recorded. This path has not been run against Bland.
 */
export async function placeCall({ to, confirmTo, task, voiceId = '', maxMinutes = 3, language = '', env = process.env, fetchImpl } = {}) {
  if (!E164.test(String(to || ''))) throw new Error('PHONE_NUMBER_E164_REQUIRED');
  if (confirmTo !== to) throw new Error('OPERATOR_CONFIRMATION_REQUIRED');
  if (!String(task || '').trim()) throw new Error('CALL_TASK_REQUIRED');
  const limit = Number(env.BLAND_MAX_CALL_MINUTES) || 5;
  if (!Number.isFinite(maxMinutes) || maxMinutes < 1 || maxMinutes > limit) throw new Error(`CALL_LENGTH_LIMIT: 1-${limit} minutes`);
  const ceiling = callCeiling({ maxMinutes, env });
  const cap = Number(env.BLAND_MAX_USD_PER_CALL) || 1;
  if (ceiling.ceilingUsd > cap) throw new Error(`CALL_COST_CEILING: ${ceiling.ceilingUsd} USD > ${cap} USD`);
  const voice = voiceId || readAuraVoice(env)?.id || '';
  const data = await bland('/calls', {
    method: 'POST', env, fetchImpl,
    body: { phone_number: to, task: String(task), ...(voice ? { voice } : {}), max_duration: maxMinutes, record: false, wait_for_greeting: true, ...(language ? { language } : {}) },
  });
  return { callId: data.call_id || null, status: data.status || null, ceiling };
}
