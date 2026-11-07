import test from 'node:test';
import assert from 'node:assert/strict';
import { manualAuraProviderCompletion } from '../../runtime/src/server/connected/auraOllamaChat.mjs';
import { auraChatViaSeer, markTruncatedReply } from '../../agents/lib/aura-seer-chat.mjs';

// 2026-11-07: Gemini 2.5 Flash spent ~680 of 700 output tokens thinking and the operator got
// "Jag förstår att du undrar hur jag kan bidra ... och om jag" as Aura's whole answer.
function fakeProviders(seen, finishReason = 'stop') {
  return {
    list: () => [{ id: 'gemini', baseUrl: 'http://127.0.0.1:9/v1beta/openai', defaultModel: 'models/gemini-2.5-flash' }],
    chat: async args => { seen.push(args); return { content: 'Svar', model: args.model, finishReason, usage: null }; },
  };
}

test('a thinking model gets room for a full answer and low hidden thinking', async () => {
  const seen = [];
  const out = await manualAuraProviderCompletion({ providerId: 'gemini', model: 'models/gemini-2.5-flash', system: 's', user: 'u' },
    { providers: fakeProviders(seen), economic: {}, env: {} });
  assert.ok(seen[0].maxTokens >= 2048);
  assert.equal(seen[0].reasoningEffort, 'low');
  assert.equal(out.finishReason, 'stop');
});

test('a model that does not think gets no reasoning parameter', async () => {
  const seen = [];
  await manualAuraProviderCompletion({ providerId: 'gemini', model: 'gemma-3-27b-it', system: 's', user: 'u' },
    { providers: fakeProviders(seen), economic: {}, env: {} });
  assert.equal(seen[0].reasoningEffort, undefined);
});

test('an answer stopped at the token limit says so in the chosen language, never as a finished answer', async () => {
  assert.equal(markTruncatedReply('Klart.', 'stop', 'sv'), 'Klart.');
  assert.match(markTruncatedReply('och om jag', 'length', 'sv'), /^och om jag \.\.\.\n\nSvaret blev avbrutet/);
  assert.match(markTruncatedReply('and if I', 'MAX_TOKENS', 'en'), /The answer was cut off/);
  assert.doesNotMatch(markTruncatedReply('and if I', 'length', 'en'), /Svaret/);
  const reply = await auraChatViaSeer({ message: 'hej', language: 'sv',
    complete: async () => ({ text: 'Jag förstår att du undrar', finishReason: 'length', provider: 'gemini', model: 'm', local: false }) });
  assert.match(reply.reply, /Skriv "fortsätt"/);
});
