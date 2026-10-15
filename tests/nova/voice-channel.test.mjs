// Voice channel (operator 2026-10-11): the operator's own WhatsApp, owner-only, limited, secrets redacted.
// WhatsApp itself is replaced by a fake socket; the live link needs a real QR scan and is not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerVoiceMessageThroughAura, createVoiceChannel, createMissionNotifier, normalizeNumber, maskNumber, redact, speakable, synthesize, edgeVoiceName, inboundFromOwner } from '../../runtime/src/server/connected/voiceChannel.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-voice-test-'));

function fakeBaileys() {
  const sockets = [];
  const makeSocket = () => {
    const sock = { ev: new EventEmitter(), sent: [], loggedOut: false, ended: false };
    sock.sendMessage = async (jid, content) => { sock.sent.push({ jid, content }); };
    sock.logout = async () => { sock.loggedOut = true; };
    sock.end = () => { sock.ended = true; };
    sockets.push(sock);
    return sock;
  };
  return { sockets, module: { default: makeSocket, useMultiFileAuthState: async dir => { fs.mkdirSync(dir, { recursive: true }); return { state: {}, saveCreds: async () => fs.writeFileSync(path.join(dir, 'creds.json'), '{}') }; }, DisconnectReason: { loggedOut: 401 } } };
}

const open = sock => sock.ev.emit('connection.update', { connection: 'open' });
const fakeSynth = async () => { const file = path.join(tmp(), 'v.ogg'); fs.writeFileSync(file, Buffer.alloc(300)); return { file, engine: 'fake', mimetype: 'audio/ogg; codecs=opus', ptt: true }; };

test('numbers: international form only, masked when shown', () => {
  assert.equal(normalizeNumber('+46 70 123 45 67'), '46701234567');
  assert.equal(normalizeNumber('0046701234567'), '46701234567');
  for (const bad of ['0701234567', '46701234567', '+0123', '+46abc', '', null, '+1234567890123456789']) assert.equal(normalizeNumber(bad), null, String(bad));
  assert.equal(maskNumber('46701234567'), '+46******567');
});

test('what is sent is cleaned: secrets redacted, links and code are not read aloud', () => {
  const text = 'Key sk-abcdefghijklmnop1234 and Bearer abc.def.ghi and ' + 'A'.repeat(40) + ' see https://example.com/x `code`';
  const clean = redact(text);
  assert.ok(!clean.includes('abcdefghijklmnop') && !clean.includes('abc.def.ghi') && !clean.includes('A'.repeat(40)));
  assert.equal(speakable('Klart https://x.y/z ```js\nsecret()\n``` **bra**'), 'Klart bra');
  assert.ok(speakable('ord '.repeat(400)).length <= 600);
});

test('nothing goes out until a number is named and the account is linked', async () => {
  const { module } = fakeBaileys();
  const channel = createVoiceChannel({ dir: tmp(), importBaileys: async () => module, synth: fakeSynth });
  assert.equal((await channel.send({ text: 'hej' })).reason, 'VOICE_NOT_CONFIGURED');
  channel.setOwner('+46701234567');
  assert.equal((await channel.send({ text: 'hej' })).reason, 'VOICE_NOT_LINKED');
  assert.throws(() => channel.setOwner('0701234567'), /VOICE_NUMBER_INVALID/);
  assert.equal(channel.status().owner, '+46******567');
  await channel.start();
  assert.equal(channel.status().connection, 'closed', 'a reconnect without a saved session never opens a QR by itself');
});

test('linked: text and a voice note go to the one owner number, never anywhere else', async () => {
  const { module, sockets } = fakeBaileys();
  const dir = tmp();
  const qrs = [];
  const channel = createVoiceChannel({ dir, importBaileys: async () => module, synth: fakeSynth, onQr: q => qrs.push(q) });
  channel.setOwner('+46 70 123 45 67');
  await channel.link();
  sockets[0].ev.emit('connection.update', { qr: 'QR-DATA' });
  assert.deepEqual([qrs, channel.status().qr], [['QR-DATA'], 'QR-DATA']);
  open(sockets[0]);
  assert.equal(channel.status().qr, null);
  const result = await channel.send({ text: 'Klart: lägg till mul. Nyckel sk-abcdefghijklmnop1234' });
  assert.deepEqual([result.ok, result.sentText, result.sentVoice, result.voiceNote], [true, true, true, true]);
  const sent = sockets[0].sent;
  assert.equal(sent.length, 2);
  assert.ok(sent.every(m => m.jid === '46701234567@s.whatsapp.net'));
  assert.ok(!sent[0].content.text.includes('abcdefghijklmnop'));
  assert.deepEqual([sent[1].content.ptt, sent[1].content.mimetype], [true, 'audio/ogg; codecs=opus']);
  assert.equal(fs.existsSync(path.join(dir, 'auth', 'creds.json')), false, 'creds are saved only when WhatsApp updates them');
});

test('limits: too soon, daily cap, and a failing voice engine still delivers the text', async () => {
  const { module, sockets } = fakeBaileys();
  let t = 1_000_000;
  const channel = createVoiceChannel({ dir: tmp(), importBaileys: async () => module, synth: async () => { throw new Error('TTS_UNAVAILABLE:no engine'); }, now: () => t, limits: { dailyLimit: 2, minGapMs: 5000 } });
  channel.setOwner('+46701234567'); await channel.link(); open(sockets[0]);
  const first = await channel.send({ text: 'ett' });
  assert.deepEqual([first.ok, first.sentVoice, first.voiceSkipped], [true, false, 'TTS_UNAVAILABLE:no engine']);
  assert.equal((await channel.send({ text: 'två' })).reason, 'VOICE_TOO_SOON');
  t += 6000; assert.equal((await channel.send({ text: 'två' })).ok, true);
  t += 6000; assert.equal((await channel.send({ text: 'tre' })).reason, 'VOICE_DAILY_LIMIT');
  t += 86_400_000; assert.equal((await channel.send({ text: 'ny dag' })).ok, true);
  assert.equal(sockets[0].sent.filter(m => m.content.audio).length, 0);
});

test('unlink signs the device out and removes the saved session', async () => {
  const { module, sockets } = fakeBaileys();
  const dir = tmp();
  const channel = createVoiceChannel({ dir, importBaileys: async () => module, synth: fakeSynth });
  channel.setOwner('+46701234567'); await channel.link(); open(sockets[0]);
  fs.writeFileSync(path.join(dir, 'auth', 'creds.json'), '{}');
  await channel.unlink();
  assert.equal(sockets[0].loggedOut, true);
  assert.equal(fs.existsSync(path.join(dir, 'auth')), false);
  assert.equal(channel.status().connection, 'closed');
});

test('missions are reported once, after the status has settled, and old news is never repeated', async () => {
  const sends = [];
  const channel = { send: async m => { sends.push(m.text); return { ok: true }; } };
  let t = 0; const dir = tmp(); const file = path.join(dir, 'notified.json');
  let missions = [{ id: 'm0', status: 'DONE', goal: 'gammalt' }];
  const make = () => createMissionNotifier({ channel, file, now: () => t, listMissions: () => missions, settleMs: 60_000 });
  let notifier = make();
  await notifier.tick();
  assert.deepEqual(sends, [], 'the first pass only records what exists');
  missions = [{ id: 'm1', status: 'AWAITING_VERIFICATION', goal: 'Lägg till mul' }, { id: 'm0', status: 'DONE', goal: 'gammalt' }];
  await notifier.tick(); t += 30_000; await notifier.tick();
  assert.deepEqual(sends, [], 'a status must hold before it is sent');
  missions = [{ id: 'm1', status: 'DONE', goal: 'Lägg till mul' }];
  t += 40_000; await notifier.tick();
  assert.deepEqual(sends, [], 'a mission that moved on is not reported for the status it left');
  t += 61_000; await notifier.tick(); await notifier.tick();
  assert.deepEqual(sends, ['Aura här. Klart: Lägg till mul.']);
  notifier = make(); await notifier.tick(); t += 120_000; await notifier.tick();
  assert.equal(sends.length, 1, 'a restart does not repeat it');
});

test('a missing link is retried later, not lost', async () => {
  let linked = false; const sends = [];
  const channel = { send: async m => linked ? (sends.push(m.text), { ok: true }) : { ok: false, reason: 'VOICE_NOT_LINKED' } };
  let t = 0; const file = path.join(tmp(), 'n.json');
  let missions = [];
  const notifier = createMissionNotifier({ channel, file, now: () => t, listMissions: () => missions, settleMs: 0 });
  await notifier.tick();
  missions = [{ id: 'a', status: 'BLOCKED', goal: 'x' }];
  await notifier.tick(); assert.deepEqual(sends, []);
  linked = true; t += 1000; await notifier.tick();
  assert.deepEqual(sends, ['Aura här. Fastnade: x. Öppna JACO för att se varför.']);
});

test('speech: Windows voice goes through the environment, ffmpeg makes a voice note, no ffmpeg means an audio file', async () => {
  const dir = tmp(); const calls = [];
  const run = (cmd, args, options = {}) => {
    calls.push({ cmd, args, env: options.env });
    if (cmd === 'powershell.exe') fs.writeFileSync(options.env.JACO_TTS_OUT, Buffer.alloc(400));
    if (cmd === 'ffmpeg' && args[0] !== '-version') fs.writeFileSync(args.at(-1), Buffer.alloc(400));
    return { status: 0, stderr: '' };
  };
  const voiceNote = await synthesize('Hej `rm -rf` från JACO', { platform: 'win32', env: { JACO_VOICE_ENGINE: 'local', JACO_VOICE_LANG: 'sv-SE' }, run, ffmpeg: true, tmp: dir });
  assert.deepEqual([voiceNote.ptt, voiceNote.mimetype, voiceNote.engine], [true, 'audio/ogg; codecs=opus', 'windows-speech']);
  const ps = calls.find(c => c.cmd === 'powershell.exe');
  assert.equal(ps.env.JACO_TTS_TEXT, 'Hej rm -rf från JACO', 'the text travels in the environment, never inside the script');
  assert.ok(!ps.args.join(' ').includes('rm -rf'));
  const audio = await synthesize('Hej', { platform: 'win32', env: { JACO_VOICE_ENGINE: 'local' }, run, ffmpeg: false, tmp: dir });
  assert.deepEqual([audio.ptt, audio.mimetype], [false, 'audio/wav']);
  await assert.rejects(synthesize('Hej', { platform: 'win32', env: { JACO_VOICE_ENGINE: 'local' }, run: () => ({ status: 1, stderr: 'boom' }), ffmpeg: false, tmp: dir }), /TTS_UNAVAILABLE/);
  await assert.rejects(synthesize('   ', { platform: 'win32', env: {}, run, tmp: dir }), /nothing to say/);
});

test('no voice until one is chosen; edge is the neural voice and never falls back to the computer voice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-voice-edge-'));
  const calls = [];
  const okRun = (cmd, args, options = {}) => {
    calls.push({ cmd, args });
    if (args?.includes('edge_tts')) fs.writeFileSync(args[args.indexOf('--write-media') + 1], Buffer.alloc(400));
    if (cmd === 'ffmpeg' && args[0] !== '-version') fs.writeFileSync(args.at(-1), Buffer.alloc(400));
    if (cmd === 'powershell.exe') fs.writeFileSync(options.env.JACO_TTS_OUT, Buffer.alloc(400));
    return { status: 0, stderr: '' };
  };
  const neural = await synthesize('Hej från Aura', { platform: 'win32', env: { JACO_VOICE_ENGINE: 'edge', JACO_VOICE_LANG: 'sv-SE' }, run: okRun, ffmpeg: true, tmp: dir });
  assert.deepEqual([neural.engine, neural.ptt], ['edge-tts', true]);
  const edgeCall = calls.find(c => c.args.includes('edge_tts'));
  assert.equal(edgeCall.args[edgeCall.args.indexOf('--voice') + 1], 'sv-SE-SofieNeural', 'a female Swedish neural voice by default');
  assert.ok(!edgeCall.args.includes('Hej från Aura'), 'the text goes through a file, not the argument list');
  assert.equal(edgeVoiceName('en-US', {}), 'en-US-AriaNeural');
  assert.equal(edgeVoiceName('sv-SE', { JACO_VOICE_NAME: 'sv-SE-MattiasNeural' }), 'sv-SE-MattiasNeural');

  const failing = (cmd, args, options = {}) => {
    if (args?.includes('edge_tts')) return { status: 1, stderr: 'offline' };
    return okRun(cmd, args, options);
  };
  await assert.rejects(synthesize('Hej', { platform: 'win32', env: { JACO_VOICE_ENGINE: 'edge' }, run: failing, ffmpeg: true, tmp: dir }), /TTS_UNAVAILABLE:the neural voice could not be reached/);
  await assert.rejects(synthesize('Hej', { platform: 'win32', env: {}, run: okRun, ffmpeg: true, tmp: dir }), /TTS_UNAVAILABLE:no voice chosen/, 'no robotic voice by default');
  const local = await synthesize('Hej', { platform: 'win32', env: { JACO_VOICE_ENGINE: 'local' }, run: okRun, ffmpeg: true, tmp: dir });
  assert.equal(local.engine, 'windows-speech', 'the computer voice only when chosen');
});

const upsert = (messages, type = 'notify') => ({ type, messages });
const fromOwner = (id, text, extra = {}) => ({ key: { id, remoteJid: '46701234567@s.whatsapp.net', fromMe: false, ...extra.key }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: text }, ...extra.rest });

test('inbound: only the operator\'s own number is accepted, never groups, own messages, strangers or old news', () => {
  const owner = '46701234567';
  const ok = inboundFromOwner(upsert([fromOwner('A1', ' hej Aura ')]), owner);
  assert.deepEqual(ok, [{ id: 'A1', kind: 'text', text: 'hej Aura' }]);
  const lid = inboundFromOwner(upsert([{ key: { id: 'L1', remoteJid: '1234@lid', remoteJidAlt: '46701234567@s.whatsapp.net' }, messageTimestamp: Math.floor(Date.now() / 1000), message: { extendedTextMessage: { text: 'via lid' } } }]), owner);
  assert.deepEqual(lid.map(m => m.text), ['via lid']);
  const dropped = inboundFromOwner(upsert([
    fromOwner('G', 'group', { key: { remoteJid: '120363@g.us', participant: '46701234567@s.whatsapp.net' } }),
    fromOwner('S', 'stranger', { key: { remoteJid: '46709999999@s.whatsapp.net' } }),
    fromOwner('M', 'mine', { key: { fromMe: true } }),
    { ...fromOwner('O', 'old'), messageTimestamp: 1000 },
  ]), owner);
  assert.deepEqual(dropped, []);
  assert.deepEqual(inboundFromOwner(upsert([fromOwner('X', 'history')], 'append'), owner), [], 'history sync is not a live message');
  assert.deepEqual(inboundFromOwner(upsert([fromOwner('X', 'no owner')]), null), []);
  const audio = inboundFromOwner(upsert([{ key: { id: 'V', remoteJid: '46701234567@s.whatsapp.net' }, messageTimestamp: Math.floor(Date.now() / 1000), message: { audioMessage: { ptt: true } } }]), owner);
  assert.deepEqual(audio, [{ id: 'V', kind: 'audio', text: '' }]);
});

test('two-way: a message from the operator is answered to the operator only, once, with text and voice', async () => {
  const { module, sockets } = fakeBaileys();
  const dir = tmp();
  const asked = [];
  const channel = createVoiceChannel({ dir, importBaileys: async () => module, synth: fakeSynth, onMessage: async ({ text }) => { asked.push(text); return `Svar: ${text}`; } });
  channel.setOwner('+46 70 123 45 67');
  await channel.link();
  open(sockets[0]);
  assert.equal(channel.status().twoWay, true);
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  sockets[0].ev.emit('messages.upsert', upsert([fromOwner('M1', 'vad är status?')]));
  sockets[0].ev.emit('messages.upsert', upsert([fromOwner('M1', 'vad är status?')]));
  sockets[0].ev.emit('messages.upsert', upsert([fromOwner('S1', 'från någon annan', { key: { remoteJid: '46700000000@s.whatsapp.net' } })]));
  await settle();
  assert.deepEqual(asked, ['vad är status?'], 'asked once; the stranger is never asked');
  const out = sockets[0].sent.filter(m => m.content.text || m.content.audio);
  assert.ok(out.every(m => m.jid === '46701234567@s.whatsapp.net'));
  assert.equal(out[0].content.text, 'Svar: vad är status?');
  assert.deepEqual([out.length, Boolean(out[1]?.content.ptt)], [2, true]);
  const replies = JSON.parse(fs.readFileSync(path.join(dir, 'replies.json'), 'utf8'));
  assert.equal(replies.count, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).owner, '46701234567');
});

test('two-way: WhatsApp uses Aura durable history and marks the exchange for canonical session persistence', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/session')) return new Response(JSON.stringify({ success: true, messages: [
      { role: 'system', content: 'hidden setup' },
      { role: 'user', content: 'tidigare fråga' },
      { role: 'assistant', content: 'tidigare svar' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ success: true, reply: 'Aura svarar' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const answer = await answerVoiceMessageThroughAura({ text: 'ny fråga', id: 'wamid.A/B', baseUrl: 'http://127.0.0.1:3000/', fetchImpl });
  assert.equal(answer, 'Aura svarar');
  assert.deepEqual(calls.map(call => call.url), [
    'http://127.0.0.1:3000/api/aura/chat/session',
    'http://127.0.0.1:3000/api/aura/chat',
  ]);
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body.messagesHistory, [
    { role: 'user', content: 'tidigare fråga' },
    { role: 'model', content: 'tidigare svar' },
  ]);
  assert.deepEqual(body.connectedSession, { id: 'whatsapp:wamid_A_B', source: 'WhatsApp' });
  assert.equal(body.interactionMode, 'question');
});

test('two-way: a voice note or a phone call gets a clear text answer, the call is declined, failures are told', async () => {
  const { module, sockets } = fakeBaileys();
  const rejected = [];
  const channel = createVoiceChannel({ dir: tmp(), importBaileys: async () => module, synth: fakeSynth, onMessage: async () => { throw new Error('boom'); } });
  channel.setOwner('+46 70 123 45 67');
  await channel.link();
  sockets[0].rejectCall = async (id, from) => { rejected.push([id, from]); };
  open(sockets[0]);
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  sockets[0].ev.emit('messages.upsert', upsert([{ key: { id: 'V', remoteJid: '46701234567@s.whatsapp.net' }, messageTimestamp: Math.floor(Date.now() / 1000), message: { audioMessage: {} } }]));
  sockets[0].ev.emit('call', [{ id: 'C1', from: '46701234567@s.whatsapp.net', status: 'offer' }, { id: 'C2', from: '46709999999@s.whatsapp.net', status: 'offer' }]);
  sockets[0].ev.emit('messages.upsert', upsert([fromOwner('T', 'hej')]));
  await settle();
  assert.deepEqual(rejected, [['C1', '46701234567@s.whatsapp.net']], 'only the operator\'s call is answered');
  const texts = sockets[0].sent.filter(m => m.content.text).map(m => m.content.text);
  assert.ok(texts.some(t => /röstmeddelanden/.test(t)));
  assert.ok(texts.some(t => /inte ta samtal/.test(t)));
  assert.ok(texts.some(t => /kunde inte svara/.test(t) && /boom/.test(t)));
  assert.equal(sockets[0].sent.filter(m => m.content.audio).length, 1, 'only the failed-answer note is also spoken');
});
