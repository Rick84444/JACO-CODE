// Aura's voice through Gemini's speech model (operator 2026-11-25: "fix her speech, try Gemini's speech engine").
// Text in, 24 kHz mono speech out, wrapped as WAV. Every call is reserved and settled through the existing
// economic governor, so it counts against the operator's cloud budget like any other model call.

export const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
// USD per million tokens (Google's published Gemini 2.5 Flash TTS rates: text in, audio out).
const PRICE = { input: 0.5, output: 10 };
const SAMPLE_RATE = 24000;

/** An upper bound before the call: about 25 audio tokens per second, Swedish speech about 12 characters a second. */
export function geminiVoiceQuote(text) {
  const chars = String(text || '').length;
  const inputTokens = Math.ceil(chars / 3) + 40, outputTokens = Math.ceil(chars * 2.6) + 100;
  return { inputTokens, outputTokens, estimatedUsd: (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1e6 };
}

/** The settled cost from Gemini's own usage report, or null when it is missing. */
export function geminiVoiceCost(usage) {
  const input = Number(usage?.promptTokenCount), output = Number(usage?.candidatesTokenCount);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (input * PRICE.input + output * PRICE.output) / 1e6;
}

/** 16-bit little-endian mono PCM to a WAV file the browser plays directly. */
export function pcmToWav(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function geminiVoiceRequest(text, { voice = 'Kore', lang = 'sv-SE' } = {}) {
  // A short direction, not spoken: how Aura sounds. The text itself is passed unchanged.
  const style = lang.startsWith('sv') ? 'Säg det här på naturlig svenska, lugnt, varmt och tydligt:' : 'Say this naturally, calm, warm and clear:';
  return {
    contents: [{ parts: [{ text: `${style}\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  };
}

/**
 * @param {string} text @param {{ apiKey: string, economic: any, voice?: string, lang?: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<Buffer>} WAV bytes
 */
export async function geminiSpeak(text, { apiKey, economic, voice, lang, fetchImpl = fetch }) {
  if (!apiKey) throw Error('GEMINI_KEY_MISSING');
  const quote = geminiVoiceQuote(text);
  const auth = economic.authorizeCloud({ estimatedUsd: quote.estimatedUsd, purpose: 'manual-aura-chat',
    metadata: { providerId: 'gemini', model: GEMINI_TTS_MODEL, purposeDetail: 'aura-voice', promptBytes: Buffer.byteLength(text), providerInvoiceVerified: false } });
  if (!auth.allowed) throw Error('GEMINI_VOICE_DENIED:' + auth.reason);
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(geminiVoiceRequest(text, { voice, lang })), signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    // Sent but no answer: the provider may have generated (and billed) it.
    economic.markCloudOutcomeUnknown(auth.reservationId, 'gemini voice request failed after dispatch');
    throw Error('GEMINI_VOICE_UNREACHABLE:' + (error?.name || 'Error'));
  }
  if (!response.ok) {
    economic.releaseReservation(auth.reservationId, `gemini voice HTTP ${response.status} without generation`);
    throw Error('GEMINI_VOICE_HTTP_' + response.status);
  }
  const data = await response.json().catch(() => null);
  const audio = data?.candidates?.[0]?.content?.parts?.find?.(p => p?.inlineData?.data)?.inlineData;
  const cost = geminiVoiceCost(data?.usageMetadata);
  if (cost == null) economic.markCloudOutcomeUnknown(auth.reservationId, 'gemini voice usage missing');
  else economic.settleCloud(auth.reservationId, cost, data.usageMetadata);
  if (!audio?.data) throw Error('GEMINI_VOICE_EMPTY');
  const rate = Number(/rate=(\d+)/.exec(String(audio.mimeType || ''))?.[1]) || SAMPLE_RATE;
  return pcmToWav(Buffer.from(audio.data, 'base64'), rate);
}
