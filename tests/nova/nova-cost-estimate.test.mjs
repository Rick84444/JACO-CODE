// Regression: Nova reserves cost with the byte size of its request; the runtime must convert bytes to tokens
// before pricing, or every planner call is estimated several times too high and refused (TASK_COST_LIMIT).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { estimatedInputTokens, novaProviderCostUsd, PROMPT_BYTES_PER_TOKEN } from '../../runtime/src/server/connected/auraOllamaChat.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('bytes become a conservative token count', () => {
  assert.equal(PROMPT_BYTES_PER_TOKEN, 3);
  assert.equal(estimatedInputTokens(0), 0);
  assert.equal(estimatedInputTokens(1), 1);
  assert.equal(estimatedInputTokens(60_000), 20_000);
  assert.equal(estimatedInputTokens('bad'), 0);
});

test('an 80 kB planner request fits the default 0.25 USD per-task cap only when priced on tokens', () => {
  const cap = 0.25;
  const asBytes = novaProviderCostUsd('deepseek', 'deepseek-v4-pro', 80_000, 4096);
  const asTokens = novaProviderCostUsd('deepseek', 'deepseek-v4-pro', estimatedInputTokens(80_000), 4096);
  assert.ok(asBytes > cap, `bytes-as-tokens estimate ${asBytes} should exceed the cap`);
  assert.ok(asTokens < cap, `token estimate ${asTokens} should fit the cap`);
});

test('the reserve route converts promptBytes before pricing', () => {
  const server = readFileSync(resolve(root, 'runtime/server.ts'), 'utf8');
  assert.match(server, /novaProviderCostUsd\(providerId, model, estimatedInputTokens\(promptBytes\), maxTokens/);
  assert.doesNotMatch(server, /novaProviderCostUsd\(providerId, model, promptBytes,/);
});
