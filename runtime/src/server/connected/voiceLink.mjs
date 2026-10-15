// Links the voice channel to WhatsApp from a terminal (JACO Lite: `node start.mjs --whatsapp +46701234567`).
//   node voiceLink.mjs <number>   name your own number, show the QR code, wait for the scan, send a test message
//   node voiceLink.mjs --check    check that WhatsApp support loads and which voice engine is available (sends nothing)
import os from 'node:os';
import path from 'node:path';
import { createVoiceChannel, hasFfmpeg, normalizeNumber, synthesize } from './voiceChannel.mjs';

const dir = path.join(path.resolve(process.env.JACO_STATE_DIR || path.join(os.homedir(), '.jaco')), 'voice');
const arg = process.argv[2];

async function check() {
  let ok = true;
  try {
    const baileys = await import('@whiskeysockets/baileys');
    console.log(`WhatsApp support: loads (${typeof baileys.default === 'function' ? 'ok' : 'unexpected shape'})`);
    if (typeof baileys.default !== 'function') ok = false;
  } catch (error) { ok = false; console.log(`WhatsApp support: does not load (${String(error?.message || error).slice(0, 160)})`); }
  const ffmpeg = hasFfmpeg();
  console.log(`ffmpeg: ${ffmpeg ? 'found (voice notes)' : 'not found (the text goes out; install ffmpeg for voice notes)'}`);
  try {
    const sound = await synthesize('JACO kan prata.');
    console.log(`voice: ${sound.engine}, ${sound.ptt ? 'voice note' : 'audio file'}`);
    (await import('node:fs')).rmSync(sound.file, { force: true });
  } catch (error) { console.log(`voice: ${String(error?.message || error)}`); }
  process.exit(ok ? 0 : 1);
}

async function link(number) {
  if (!normalizeNumber(number)) { console.error('Write your number in international form, for example --whatsapp +46701234567'); process.exit(2); }
  const qrcode = (await import('qrcode-terminal')).default;
  const channel = createVoiceChannel({ dir, onQr: qr => { console.log('\nOpen WhatsApp on the phone of the number the agent will use: Settings > Linked devices > Link a device, and scan:\n'); qrcode.generate(qr, { small: true }); } });
  console.log(`The agent will message ${channel.setOwner(number)} and no one else. This uses WhatsApp's unofficial web protocol: use a separate number for the agent, not your main account.`);
  try {
    await channel.link({ waitMs: 180_000 });
    const result = await channel.send({ text: 'Aura är kopplad. Jag skriver här när ett uppdrag är klart eller behöver dig.' });
    console.log(result.ok ? `Linked. Test message sent${result.sentVoice ? ' with voice' : ` (no voice: ${result.voiceSkipped})`}.` : `Linked, but the test message did not go out: ${result.reason}`);
    channel.close();
    process.exit(0);
  } catch (error) { console.error(`Linking did not finish: ${String(error?.message || error)}`); process.exit(1); }
}

if (arg === '--check') await check();
else if (arg) await link(arg);
else { console.error('usage: voiceLink.mjs <number in international form> | --check'); process.exit(2); }
