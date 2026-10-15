// Voice channel: agents reach the operator on WhatsApp with a short message and a spoken voice note
// (operator 2026-10-11: "agents call the user", the way OpenClaw links WhatsApp; free, no new service).
//
// How it works: the operator links a WhatsApp account once (a QR code, as a linked device, through Baileys, the
// open-source WhatsApp Web client) and names their own number. The channel can send to that one number and nowhere
// else. This uses WhatsApp's unofficial web protocol: use a separate number for the agent, not your main account.
// A voice note is a locally synthesised voice (Windows speech, macOS say, espeak-ng or Piper), converted with
// ffmpeg when it is installed; without ffmpeg the text message still goes out and the reason is reported.
//
// State lives in <stateDir>/voice (config.json, auth/ for the WhatsApp session, usage.json, notified.json).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LIMITS = { dailyLimit: 20, minGapMs: 5000, maxSpokenChars: 600, maxTextChars: 1200, replyLimit: 200 };

// International format only: "+46 70 123 45 67" or "0046701234567". Returns the digits, or null.
export function normalizeNumber(input) {
  const raw = String(input ?? '').trim();
  if (!/^(\+|00)/.test(raw)) return null;
  const digits = raw.replace(/^(\+|00)/, '').replace(/[\s\-().]/g, '');
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

export const maskNumber = digits => (digits ? `+${String(digits).slice(0, 2)}${'*'.repeat(Math.max(0, String(digits).length - 5))}${String(digits).slice(-3)}` : null);

// Secrets must never be read out or sent: long token-like strings and common key shapes.
export function redact(text) {
  return String(text ?? '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [hemlig]')
    .replace(/\b(sk|pk|rk|hf|gh[pousr]|xox[abp]|jdev|jide)[-_][A-Za-z0-9_-]{12,}/g, '[hemlig]')
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[hemlig]');
}

// What is spoken: no links, no code, no markdown marks, clipped.
export function speakable(text, max = LIMITS.maxSpokenChars) {
  const plain = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[`*_#>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trim()}.` : plain;
}

const defaultRun = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 45_000, ...options });

export function hasFfmpeg(run = defaultRun) {
  try { return run('ffmpeg', ['-version']).status === 0; } catch { return false; }
}

const WINDOWS_SPEECH = [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq $env:JACO_TTS_LANG } | Select-Object -First 1',
  'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }',
  '$s.SetOutputToWaveFile($env:JACO_TTS_OUT)',
  '$s.Speak($env:JACO_TTS_TEXT)',
  '$s.Dispose()',
].join('; ');

const EDGE_VOICES = { sv: 'sv-SE-SofieNeural', en: 'en-US-AriaNeural', nb: 'nb-NO-PernilleNeural', da: 'da-DK-ChristelNeural', de: 'de-DE-KatjaNeural' };
export const edgeVoiceName = (lang = 'sv-SE', env = process.env) => env.JACO_VOICE_NAME || EDGE_VOICES[String(lang).split('-')[0].toLowerCase()] || EDGE_VOICES.en;

// Returns { raw, engine } or null when edge-tts is not usable (the caller then uses the local engine).
function edgeVoice(spoken, { env, run, base, lang }) {
  const textFile = `${base}.txt`; const raw = `${base}.mp3`;
  try {
    fs.writeFileSync(textFile, spoken, 'utf8');
    const python = env.JACO_VOICE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const r = run(python, ['-m', 'edge_tts', '--voice', edgeVoiceName(lang, env), '--file', textFile, '--write-media', raw]);
    if (r.status === 0 && fs.existsSync(raw) && fs.statSync(raw).size >= 200) return { raw, engine: 'edge-tts' };
  } catch { /* fall through to the local engine */ }
  finally { fs.rmSync(textFile, { force: true }); }
  fs.rmSync(raw, { force: true });
  return null;
}

// Text to a sound file in the temp folder. Returns { file, engine, mimetype, ptt } or throws TTS_UNAVAILABLE:<why>.
/** @param {string} text @param {any} [options] */
export async function synthesize(text, { platform = process.platform, env = process.env, run = defaultRun, ffmpeg = hasFfmpeg(run), tmp = os.tmpdir() } = {}) {
  const spoken = speakable(text);
  if (!spoken) throw new Error('TTS_UNAVAILABLE:nothing to say');
  const base = path.join(tmp, `jaco-voice-${process.pid}-${Date.now()}`);
  const lang = env.JACO_VOICE_LANG || 'sv-SE';
  let raw; let engine;
  // No voice until the operator chooses one. The built-in computer voices are hard to understand, so they are opt-in
  // (JACO_VOICE_ENGINE=local); JACO_VOICE_ENGINE=edge uses Microsoft's neural voices through edge-tts, and the spoken
  // text then leaves this computer. Without a working voice the message still goes out as text.
  const choice = String(env.JACO_VOICE_ENGINE || '').toLowerCase();
  const edge = choice === 'edge' ? edgeVoice(spoken, { env, run, base, lang }) : null;
  if (edge) { raw = edge.raw; engine = edge.engine; }
  else if (choice === 'edge') throw new Error('TTS_UNAVAILABLE:the neural voice could not be reached; the text was sent without voice');
  else if (choice !== 'local') throw new Error('TTS_UNAVAILABLE:no voice chosen (set JACO_VOICE_ENGINE=edge or local)');
  else if (platform === 'win32') {
    raw = `${base}.wav`; engine = 'windows-speech';
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SPEECH], { env: { ...env, JACO_TTS_TEXT: spoken, JACO_TTS_OUT: raw, JACO_TTS_LANG: lang } });
    if (r.status !== 0) throw new Error(`TTS_UNAVAILABLE:windows speech failed ${String(r.stderr || '').slice(0, 120)}`);
  } else if (platform === 'darwin') {
    raw = `${base}.aiff`; engine = 'macos-say';
    const r = run('say', ['-o', raw, spoken]);
    if (r.status !== 0) throw new Error('TTS_UNAVAILABLE:say failed');
  } else if (env.JACO_PIPER_MODEL && run('piper', ['--help']).status === 0) {
    raw = `${base}.wav`; engine = 'piper';
    const r = run('piper', ['--model', env.JACO_PIPER_MODEL, '--output_file', raw], { input: spoken });
    if (r.status !== 0) throw new Error('TTS_UNAVAILABLE:piper failed');
  } else {
    raw = `${base}.wav`; engine = 'espeak-ng';
    const r = run('espeak-ng', ['-v', lang.split('-')[0], '-w', raw, spoken]);
    if (r.status !== 0) throw new Error('TTS_UNAVAILABLE:no speech engine found (Windows speech, say, piper or espeak-ng)');
  }
  if (!fs.existsSync(raw) || fs.statSync(raw).size < 200) throw new Error('TTS_UNAVAILABLE:the engine produced no sound');
  if (ffmpeg) {
    const out = `${base}.ogg`;
    const r = run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:a', 'libopus', '-b:a', '24k', '-ac', '1', '-ar', '48000', out]);
    fs.rmSync(raw, { force: true });
    if (r.status === 0 && fs.existsSync(out)) return { file: out, engine, mimetype: 'audio/ogg; codecs=opus', ptt: true };
    throw new Error('TTS_UNAVAILABLE:ffmpeg could not convert the sound');
  }
  if (raw.endsWith('.wav')) return { file: raw, engine, mimetype: 'audio/wav', ptt: false };
  fs.rmSync(raw, { force: true });
  throw new Error('TTS_UNAVAILABLE:install ffmpeg to send this voice as a voice note');
}

const digitsOf = jid => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const unwrap = message => message?.ephemeralMessage?.message || message?.viewOnceMessage?.message || message?.documentWithCaptionMessage?.message || message || {};

// What the operator wrote to the linked number, from one messages.upsert batch. Only the operator's own number counts:
// groups, the account's own messages, other senders and anything older than maxAgeSec are dropped here.
export function inboundFromOwner(update, owner, { nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 180 } = {}) {
  const out = [];
  if (!owner || !update || update.type !== 'notify') return out;
  for (const m of update.messages || []) {
    const key = m?.key || {};
    if (key.fromMe || !key.id) continue;
    if (String(key.remoteJid || '').endsWith('@g.us') || String(key.remoteJid || '').endsWith('@broadcast')) continue;
    const senders = [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt, m.senderPn].map(digitsOf).filter(Boolean);
    if (!senders.includes(owner)) continue;
    const at = Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0);
    if (at && nowSec - at > maxAgeSec) continue;
    const body = unwrap(m.message);
    const text = body.conversation || body.extendedTextMessage?.text || body.imageMessage?.caption || '';
    if (body.audioMessage) out.push({ id: key.id, kind: 'audio', text: '' });
    else if (String(text).trim()) out.push({ id: key.id, kind: 'text', text: String(text).trim().slice(0, 2000) });
  }
  return out;
}

const silentLogger = { level: 'silent', child() { return silentLogger; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
const day = ms => new Date(ms).toISOString().slice(0, 10);
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// WhatsApp is a transport for Aura, not a second chat. Read the durable Aura session, ask through
// the canonical route, and identify this delivery so the runtime can persist it idempotently.
export async function answerVoiceMessageThroughAura({ text, id, baseUrl, fetchImpl = globalThis.fetch }) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const sessionResponse = await fetchImpl(`${root}/api/aura/chat/session`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok || session?.success === false || !Array.isArray(session?.messages)) {
    throw new Error(session?.error || `AURA_SESSION_HTTP_${sessionResponse.status}`);
  }
  const messagesHistory = session.messages
    .filter(message => message?.role === 'user' || message?.role === 'assistant')
    .slice(-8)
    .map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', content: String(message.content || '') }));
  const safeId = String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  if (!safeId) throw new Error('VOICE_MESSAGE_ID_INVALID');
  const response = await fetchImpl(`${root}/api/aura/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: String(text || ''), interactionMode: 'question', messagesHistory,
      connectedSession: { id: `whatsapp:${safeId}`, source: 'WhatsApp' },
    }),
    signal: AbortSignal.timeout(110_000),
  });
  const data = await response.json().catch(() => ({}));
  const answer = String(data.reply || data.text || '').trim();
  if (!response.ok || data?.success === false || !answer) throw new Error(data.detail || data.error || `AURA_CHAT_HTTP_${response.status}`);
  return answer;
}

/** @param {any} [options] */
export function createVoiceChannel({ dir, env = process.env, importBaileys = () => import('@whiskeysockets/baileys'), synth = synthesize, now = Date.now, log = () => {}, onQr = null, onMessage = null, limits = {} } = {}) {
  if (!dir) throw new Error('VOICE_DIR_REQUIRED');
  const max = { ...LIMITS, ...limits, dailyLimit: Number(env.JACO_VOICE_DAILY_LIMIT) || limits.dailyLimit || LIMITS.dailyLimit, replyLimit: Number(env.JACO_VOICE_REPLY_LIMIT) || limits.replyLimit || LIMITS.replyLimit };
  const files = { config: path.join(dir, 'config.json'), usage: path.join(dir, 'usage.json'), replies: path.join(dir, 'replies.json'), auth: path.join(dir, 'auth') };
  let socket = null; let connection = 'closed'; let qr = null; let lastError = null; let stopped = false; let retry = 0; let opening = null;
  let lastInboundAt = null; let inbox = Promise.resolve(); const seen = new Set();

  const config = () => readJson(files.config, {});
  const hasSession = () => fs.existsSync(path.join(files.auth, 'creds.json'));
  const usage = () => { const u = readJson(files.usage, {}); return u.day === day(now()) ? u : { day: day(now()), count: 0, lastAt: u.lastAt || 0 }; };

  function setOwner(number) {
    const digits = normalizeNumber(number);
    if (!digits) throw new Error('VOICE_NUMBER_INVALID: write the number in international form, for example +46701234567');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(files.config, JSON.stringify({ owner: digits, updatedAt: new Date(now()).toISOString() }), { mode: 0o600 });
    return maskNumber(digits);
  }

  async function open({ allowQr }) {
    if (opening) return opening;
    if (!allowQr && !hasSession()) return null;
    opening = (async () => {
      const baileys = await importBaileys();
      const makeSocket = baileys.default || baileys.makeWASocket;
      fs.mkdirSync(files.auth, { recursive: true, mode: 0o700 });
      const { state, saveCreds } = await baileys.useMultiFileAuthState(files.auth);
      connection = 'connecting'; lastError = null;
      const sock = makeSocket({ auth: state, logger: silentLogger, printQRInTerminal: false, browser: ['JACO', 'Desktop', '1.0'], markOnlineOnConnect: false, syncFullHistory: false });
      socket = sock;
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('messages.upsert', update => { inbox = inbox.then(() => handleInbound(update)).catch(() => {}); });
      sock.ev.on('call', calls => { inbox = inbox.then(() => handleCalls(calls)).catch(() => {}); });
      sock.ev.on('connection.update', update => {
        if (update.qr) { qr = update.qr; if (onQr) onQr(update.qr); }
        if (update.connection === 'open') { connection = 'open'; qr = null; retry = 0; log('voice: WhatsApp linked'); }
        if (update.connection === 'close') {
          const code = update.lastDisconnect?.error?.output?.statusCode;
          connection = 'closed'; socket = null; opening = null;
          if (code === baileys.DisconnectReason?.loggedOut || code === 401) {
            lastError = 'WhatsApp signed this device out. Link it again.';
            fs.rmSync(files.auth, { recursive: true, force: true });
          } else if (!stopped && retry < 8) {
            retry += 1; setTimeout(() => { open({ allowQr: Boolean(qr) || false }).catch(e => { lastError = String(e?.message || e); }); }, Math.min(30_000, 1000 * 2 ** retry)).unref?.();
          }
        }
      });
    })().catch(error => { opening = null; connection = 'closed'; lastError = String(error?.message || error); throw error; });
    return opening;
  }

  const waitFor = (predicate, ms) => new Promise((resolve, reject) => {
    const started = now();
    const timer = setInterval(() => { if (predicate()) { clearInterval(timer); resolve(); } else if (now() - started > ms) { clearInterval(timer); reject(new Error('VOICE_TIMEOUT')); } }, 250);
    timer.unref?.();
  });

  /** @param {{ text?: string, speak?: boolean }} [message] */
  async function send({ text, speak = true } = {}) {
    const owner = config().owner;
    if (!owner) return { ok: false, reason: 'VOICE_NOT_CONFIGURED' };
    if (connection !== 'open' || !socket) return { ok: false, reason: 'VOICE_NOT_LINKED' };
    const body = redact(String(text ?? '')).trim().slice(0, max.maxTextChars);
    if (!body) return { ok: false, reason: 'VOICE_EMPTY' };
    const u = usage();
    if (u.count >= max.dailyLimit) return { ok: false, reason: 'VOICE_DAILY_LIMIT' };
    if (now() - (u.lastAt || 0) < max.minGapMs) return { ok: false, reason: 'VOICE_TOO_SOON' };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(files.usage, JSON.stringify({ day: u.day, count: u.count + 1, lastAt: now() }), { mode: 0o600 });
    return transmit(`${owner}@s.whatsapp.net`, body, speak);
  }

  // The text, then the same words as a voice note when a speech engine is available.
  async function transmit(jid, body, speak) {
    await socket.sendMessage(jid, { text: body });
    const result = { ok: true, sentText: true, sentVoice: false, voiceNote: false, voiceSkipped: null };
    if (speak) {
      let sound = null;
      try {
        sound = await synth(body);
        await socket.sendMessage(jid, { audio: { url: sound.file }, mimetype: sound.mimetype, ptt: sound.ptt });
        result.sentVoice = true; result.voiceNote = Boolean(sound.ptt); result.engine = sound.engine;
      } catch (error) { result.voiceSkipped = String(error?.message || error); }
      finally { if (sound?.file) fs.rmSync(sound.file, { force: true }); }
    }
    return result;
  }

  // An answer to something the operator wrote: it has its own daily budget and no minimum gap, so a conversation
  // is not throttled like notifications are. It can only go to the operator's number.
  async function reply({ text, speak = true } = {}) {
    const owner = config().owner;
    if (!owner) return { ok: false, reason: 'VOICE_NOT_CONFIGURED' };
    if (connection !== 'open' || !socket) return { ok: false, reason: 'VOICE_NOT_LINKED' };
    const body = redact(String(text ?? '')).trim().slice(0, max.maxTextChars);
    if (!body) return { ok: false, reason: 'VOICE_EMPTY' };
    const saved = readJson(files.replies, {});
    const used = saved.day === day(now()) ? saved : { day: day(now()), count: 0 };
    if (used.count >= max.replyLimit) return { ok: false, reason: 'VOICE_REPLY_LIMIT' };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(files.replies, JSON.stringify({ day: used.day, count: used.count + 1 }), { mode: 0o600 });
    return transmit(`${owner}@s.whatsapp.net`, body, speak);
  }

  async function handleInbound(update) {
    const owner = config().owner;
    for (const item of inboundFromOwner(update, owner, { nowSec: Math.floor(now() / 1000) })) {
      if (seen.has(item.id)) continue;
      seen.add(item.id); if (seen.size > 500) seen.delete(seen.values().next().value);
      lastInboundAt = new Date(now()).toISOString();
      try { await socket?.sendPresenceUpdate?.('composing', `${owner}@s.whatsapp.net`); } catch {}
      if (item.kind === 'audio') { await reply({ text: 'Jag kan inte lyssna på röstmeddelanden än. Skriv till mig så svarar jag med text och röst.', speak: false }); continue; }
      if (!onMessage) continue;
      let answer;
      try {
        answer = await Promise.race([Promise.resolve(onMessage({ text: item.text, id: item.id })), new Promise((_, reject) => setTimeout(() => reject(new Error('VOICE_ANSWER_TIMEOUT')), 120_000).unref?.())]);
      } catch (error) { answer = `Jag kunde inte svara just nu (${String(error?.message || error).slice(0, 80)}).`; }
      if (answer) await reply({ text: String(answer) });
    }
  }

  // A phone call to the linked number cannot be answered; say so instead of leaving it ringing.
  async function handleCalls(calls) {
    const owner = config().owner;
    for (const call of Array.isArray(calls) ? calls : []) {
      if (call?.status !== 'offer' || !call.id || seen.has(`call:${call.id}`) || digitsOf(call.from) !== owner) continue;
      seen.add(`call:${call.id}`);
      try { await socket?.rejectCall?.(call.id, call.from); } catch {}
      await reply({ text: 'Jag kan inte ta samtal än. Skriv till mig, så svarar jag med text och röst.', speak: false });
    }
  }

  return {
    setOwner,
    status() {
      const c = config(); const u = usage();
      return { configured: Boolean(c.owner), owner: maskNumber(c.owner), hasSession: hasSession(), connection, qr, lastError, sentToday: u.count, dailyLimit: max.dailyLimit, twoWay: Boolean(onMessage), lastInboundAt, replyLimit: max.replyLimit };
    },
    // Reconnects a session that already exists (never shows a QR by itself).
    async start() { if (config().owner && hasSession()) await open({ allowQr: false }); return this.status(); },
    // Starts linking: waits for the QR (read it with status().qr or through onQr), then for the scan.
    async link({ waitMs = 0 } = {}) {
      if (!config().owner) throw new Error('VOICE_NOT_CONFIGURED: set the number first');
      stopped = false; await open({ allowQr: true });
      if (waitMs) await waitFor(() => connection === 'open', waitMs);
      return this.status();
    },
    waitLinked: ms => waitFor(() => connection === 'open', ms),
    send,
    reply,
    async unlink() {
      stopped = true;
      try { await socket?.logout(); } catch {}
      try { socket?.end?.(undefined); } catch {}
      socket = null; connection = 'closed'; qr = null; opening = null;
      fs.rmSync(files.auth, { recursive: true, force: true });
      return this.status();
    },
    close() { stopped = true; try { socket?.end?.(undefined); } catch {} socket = null; connection = 'closed'; opening = null; },
  };
}

// Tells the operator when a mission needs them or has finished. The first pass only records what already exists, so a
// restart never repeats old news; a status must hold for settleMs before it is sent, which gives the automatic
// approval policy time to resolve it first (and a mission that moves on is never reported for the status it left).
/** @param {any} [options] */
export function createMissionNotifier({ channel, listMissions, file, now = Date.now, settleMs = 60_000 } = {}) {
  const notified = new Set(readJson(file, []));
  const firstSeen = new Map();
  let baseline = notified.size === 0 && !fs.existsSync(file || '');
  const WORDS = {
    DONE: m => `Aura här. Klart: ${shortGoal(m)}.`,
    AWAITING_VERIFICATION: m => `Aura här. Väntar på dig: ${shortGoal(m)}. Öppna JACO och godkänn eller avvisa.`,
    BLOCKED: m => `Aura här. Fastnade: ${shortGoal(m)}. Öppna JACO för att se varför.`,
  };
  const shortGoal = m => { const g = String(m.goal || '').replace(/\s+/g, ' ').trim(); return g.length > 90 ? `${g.slice(0, 89)}...` : g || 'ett uppdrag'; };
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify([...notified].slice(-500))); };

  return {
    async tick() {
      const sent = [];
      for (const mission of listMissions() || []) {
        const status = String(mission.status || '').toUpperCase();
        if (!WORDS[status]) continue;
        const key = `${mission.id}:${status}`;
        if (notified.has(key)) continue;
        if (baseline) { notified.add(key); continue; }
        const since = firstSeen.get(key) ?? now();
        firstSeen.set(key, since);
        if (now() - since < settleMs) continue;
        const result = await channel.send({ text: WORDS[status](mission) });
        if (result.ok || ['VOICE_DAILY_LIMIT', 'VOICE_EMPTY'].includes(result.reason)) { notified.add(key); firstSeen.delete(key); sent.push({ key, ...result }); }
        else if (result.reason === 'VOICE_TOO_SOON') break;
        else break; // not linked or not configured: try again at the next pass
      }
      if (baseline) { baseline = false; save(); } else if (sent.length) save();
      return sent;
    },
  };
}
