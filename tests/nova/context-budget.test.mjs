// A model with a limited window must be given a history that fits it. The old fixed 60 000-character budget ignored the
// tool schemas and sent 24 360 tokens to a 24 064-token window (HTTP 400, mission blocked, 2026-11-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextCharsBudget, localContextTokens, CHARS_PER_TOKEN } from '../../agents/lib/context-budget.mjs';

test('a large window keeps the old default, a small one gets less', () => {
  assert.equal(contextCharsBudget({ contextTokens: 200_000, reservedChars: 20_000 }), 60_000, 'never above the default');
  const small = contextCharsBudget({ contextTokens: 24_064, reservedChars: 20_000 });
  assert.ok(small < 60_000 && small >= 12_000, String(small));
  assert.ok(contextCharsBudget({ contextTokens: 32_000, reservedChars: 20_000 }) > small, 'a bigger window allows more');
});

test('the reserved tool schemas and the output reserve are subtracted', () => {
  const plain = contextCharsBudget({ contextTokens: 24_064, reservedChars: 0 });
  const heavy = contextCharsBudget({ contextTokens: 24_064, reservedChars: 10_000 });
  assert.equal(plain - heavy, 10_000);
  // The whole prompt (history + tools + answer) fits the window with the margin.
  const tokens = (contextCharsBudget({ contextTokens: 24_064, reservedChars: 10_000 }) + 10_000) / CHARS_PER_TOKEN + 2048;
  assert.ok(tokens <= 24_064, `prompt ${Math.round(tokens)} tokens`);
});

test('an unknown or absurd window falls back to the default; a tiny budget has a floor', () => {
  for (const contextTokens of [null, undefined, NaN, 0, 1024, '8192', 8192.5]) assert.equal(contextCharsBudget({ contextTokens }), 60_000, String(contextTokens));
  assert.equal(contextCharsBudget({ contextTokens: 4096, reservedChars: 50_000 }), 12_000);
});

test('the window is read from a llama.cpp server on this computer only', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(String(url)); return { ok: true, json: async () => ({ default_generation_settings: { n_ctx: 24064 } }) }; };
  assert.equal(await localContextTokens('http://127.0.0.1:18081/v1', { fetchImpl, now: 1 }), 24064);
  assert.deepEqual(calls, ['http://127.0.0.1:18081/props']);
  assert.equal(await localContextTokens('http://127.0.0.1:18081/v1', { fetchImpl, now: 2 }), 24064, 'cached');
  assert.equal(calls.length, 1);
  assert.equal(await localContextTokens('https://api.example.test/v1', { fetchImpl }), null, 'a remote server is never asked');
  assert.equal(await localContextTokens('http://user:pw@127.0.0.1:18082/v1', { fetchImpl }), null, 'credentials in the url are refused');
  assert.equal(await localContextTokens('http://127.0.0.1:18083/v1', { fetchImpl: async () => { throw new Error('down'); }, now: 1 }), null);
  assert.equal(await localContextTokens('not a url', { fetchImpl }), null);
});

// The tool list is sent with every request. The narration guidance used to be repeated inside each of the 56 tool schemas
// (~34 000 of 48 000 characters, 2026-11-23); it lives once in the system prompt (NARRATION_RULE).
import { plannerTools } from '../../agents/lib/native-tools.mjs';

test('the tool list for a full mission stays small and does not repeat the narration guidance', () => {
  const allowed = ['detect-surfaces', 'health-check', 'browser-survey-site', 'browser-click', 'browser-type', 'web-fetch', 'desktop-windows',
    'desktop-observe', 'desktop-action', 'desktop-invoke', 'screenshot', 'get-cursor', 'shell', 'mouse-move', 'mouse-click', 'mouse-scroll',
    'key-press', 'type-text', 'repo-list', 'repo-read', 'repo-write', 'repo-edit', 'repo-test', 'git-status', 'git-diff', 'git-commit'];
  const { tools } = plannerTools(allowed, [], {}, true);
  const total = tools.reduce((n, tool) => n + JSON.stringify(tool).length, 0);
  assert.ok(tools.length >= allowed.length);
  assert.ok(total / tools.length < 600, `average ${Math.round(total / tools.length)} characters per tool`);
  for (const tool of tools.filter(t => t.function.parameters.properties?.say)) {
    assert.ok(tool.function.parameters.properties.say.description.length <= 120, tool.function.name);
    assert.ok(tool.function.parameters.properties.learned.description.length <= 120, tool.function.name);
  }
});
