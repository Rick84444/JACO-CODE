import assert from 'node:assert/strict';
import test from 'node:test';
import { IMAGE_COST_BYTES, costPromptBytes } from '../../agents/lib/nova-ollama-cost.mjs';

// Observed 2026-11-22 in a live desktop test: Aura took a full-screen screenshot, the next planner turn carried it
// as a base64 data URL, the reservation route saw several hundred kilobytes of "prompt" (> 200000) and answered
// NOVA_OLLAMA_COST_INPUT_INVALID. The mission stopped right after its first, successful, step.
const screenshot = 'data:image/png;base64,' + 'A'.repeat(900_000);
const turn = image => ({
  model: 'models/gemini-3.8-flash', max_tokens: 2048,
  messages: [
    { role: 'system', content: 'You are Aura.' },
    { role: 'user', content: [{ type: 'text', text: 'Laser Vision: current mission screen.' }, ...(image ? [{ type: 'image_url', image_url: { url: image } }] : [])] },
  ],
});

test('an image costs a fixed tile budget, not the length of its base64 encoding', () => {
  const withImage = costPromptBytes(turn(screenshot));
  const without = costPromptBytes(turn(null));
  assert.ok(withImage < 200_000, `a full-screen frame must fit the reservation limit, got ${withImage}`);
  assert.ok(withImage - without >= IMAGE_COST_BYTES, 'the image is still paid for, never free');
  assert.ok(withImage - without < IMAGE_COST_BYTES + 200, 'and only once, by its tile budget');
});

test('every image counts, in either provider format, and text is counted exactly as before', () => {
  const two = turn(screenshot);
  two.messages[1].content.push({ type: 'image_url', image_url: { url: screenshot } });
  assert.ok(costPromptBytes(two) - costPromptBytes(turn(screenshot)) >= IMAGE_COST_BYTES);
  const native = { contents: [{ parts: [{ text: 'hi' }, { inline_data: { mime_type: 'image/png', data: 'B'.repeat(500_000) } }, { inlineData: { mimeType: 'image/png', data: 'C'.repeat(500_000) } }] }] };
  assert.ok(costPromptBytes(native) < 30_000);
  assert.ok(costPromptBytes(native) >= 2 * IMAGE_COST_BYTES);
  // A remote image URL is not inlined data: it stays as text, unchanged.
  const remote = turn('https://example.com/a.png');
  assert.equal(costPromptBytes(remote), Buffer.byteLength(JSON.stringify(remote), 'utf8'));
  const plain = turn(null);
  assert.equal(costPromptBytes(plain), Buffer.byteLength(JSON.stringify(plain), 'utf8'));
});
