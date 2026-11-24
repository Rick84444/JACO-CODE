import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isJacoComputeModel, jacoComputeEndpoint, sanitizeSchema, toJacoComputeRequest, screenshotBinding,
  normalizeKeys, translateComputerAction, jacoComputeTurn, jacoComputeUsage, resetContinuations,
  DESKTOP_EXCLUDED_ACTIONS,
} from '../../agents/lib/jaco-compute.mjs';
import { budgetedNovaOllamaCall } from '../../agents/lib/nova-ollama-cost.mjs';

const MODEL = 'gemini-2.5-computer-use-preview-10-2025';
const at = new Date().toISOString();
const shot = (extra = {}) => ({ type: 'screenshot', ok: true, verified: true, at,
  result: { imageSha256: 'a'.repeat(64), perception: { inputWindow: { hwnd: 77, processId: 9, rect: { x: 100, y: 50, width: 1000, height: 800 } }, capture: { x: 100, y: 50, width: 1000, height: 800 } } }, ...extra });
const tool = name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: { x: { type: 'integer' } }, additionalProperties: true } } });
const TOOLS = ['screenshot', 'mouse-click', 'mouse-move', 'mouse-scroll', 'key-press', 'type-text', 'complete', 'blocked'].map(tool);
const args = c => JSON.parse(c.function.arguments);
const answer = (parts, usage = { promptTokenCount: 10, candidatesTokenCount: 3 }) => ({ status: 200, data: { candidates: [{ content: { parts } }], usageMetadata: usage } });

test('recognizes computer-use model ids and builds the native endpoint', () => {
  assert.equal(isJacoComputeModel(MODEL), true);
  assert.equal(isJacoComputeModel('gemini-2.5-flash'), false);
  assert.equal(jacoComputeEndpoint('models/' + MODEL), `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`);
  assert.throws(() => jacoComputeEndpoint('../x?key=1'), /JACO_COMPUTE_MODEL_ID_INVALID/);
});

test('request keeps system, tool history, images and only supported schema keys', () => {
  const req = toJacoComputeRequest({
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'user', content: [{ type: 'text', text: 'goal' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'mouse-click', arguments: '{"x":1}' }, gemini_thought_signature: 'sig' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      { role: 'user', content: 'next' },
    ],
    tools: [...TOOLS, tool('click_at')],
  });
  assert.equal(req.systemInstruction.parts[0].text, 'rules');
  assert.deepEqual(req.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.deepEqual(req.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
  assert.equal(req.contents[1].parts[0].thoughtSignature, 'sig');
  assert.equal(req.contents[2].parts[0].functionResponse.name, 'mouse-click');
  assert.equal(req.contents[2].parts[1].text, 'next');
  assert.deepEqual(req.tools[0].computerUse.excludedPredefinedFunctions, [...DESKTOP_EXCLUDED_ACTIONS]);
  const names = req.tools[1].functionDeclarations.map(d => d.name);
  assert.ok(names.includes('mouse-click') && !names.includes('click_at'));
  assert.equal(req.tools[1].functionDeclarations[0].parameters.additionalProperties, undefined);
  assert.deepEqual(sanitizeSchema({ type: 'object', $schema: 'x', properties: { a: { type: 'string', additionalProperties: false } } }), { type: 'object', properties: { a: { type: 'string' } } });
});

test('translates normalized coordinates into the bound captured window', () => {
  const binding = screenshotBinding({ receipts: [shot()] });
  assert.deepEqual(binding, { hwnd: 77, capture: { x: 100, y: 50, width: 1000, height: 800 } });
  assert.deepEqual(translateComputerAction('click_at', { x: 500, y: 250 }, binding).tasks[0], { type: 'mouse-click', data: { x: 600, y: 250, expectedHwnd: 77 } });
  assert.deepEqual(translateComputerAction('click_at', { x: 999, y: 999 }, binding).tasks[0].data, { x: 1099, y: 849, expectedHwnd: 77 });
  assert.throws(() => translateComputerAction('click_at', { x: 1000, y: 1 }, binding), /COORDINATES_INVALID/);
  assert.equal(translateComputerAction('scroll_at', { x: 1, y: 1, direction: 'down', magnitude: 800 }, binding).tasks[0].data.delta, -4);
  assert.throws(() => translateComputerAction('scroll_at', { x: 1, y: 1, direction: 'left' }, binding), /SCROLL_DIRECTION_UNSUPPORTED/);
  assert.throws(() => translateComputerAction('navigate', { url: 'x' }, binding), /ACTION_UNSUPPORTED/);
  assert.throws(() => translateComputerAction('click_at', { x: 1, y: 1 }, null), /WINDOW_BOUND_SCREENSHOT_REQUIRED/);
  assert.equal(normalizeKeys('Control+Shift+ArrowDown'), 'ctrl+shift+down');
  assert.equal(normalizeKeys('Meta+Escape'), 'win+esc');
  const typed = translateComputerAction('type_text_at', { x: 0, y: 0, text: 'hej', press_enter: true }, binding);
  assert.deepEqual(typed.later.map(t => t.type), ['key-press', 'type-text', 'key-press']);
  assert.equal(screenshotBinding({ receipts: [shot({ ok: false })] }), null);
});

test('a confirmation request is never executed; it blocks for the operator', async () => {
  resetContinuations();
  const result = await jacoComputeTurn({
    messages: [{ role: 'user', content: 'goal' }], tools: TOOLS, mission: { id: 'm1', receipts: [shot()] }, frame: { url: 'x' },
    send: async () => answer([{ functionCall: { name: 'click_at', args: { x: 1, y: 1, safety_decision: { decision: 'require_confirmation', explanation: 'Accept cookies?' } } } }]),
  });
  assert.equal(result.reply.tool_calls.length, 1);
  assert.equal(result.reply.tool_calls[0].function.name, 'blocked');
  assert.match(args(result.reply.tool_calls[0]).reason, /Accept cookies/);
});

test('type_text_at clicks, observes and types without extra model calls', async () => {
  resetContinuations();
  let calls = 0;
  const send = async () => { calls++; return answer([{ text: 'Typing the name.' }, { functionCall: { name: 'type_text_at', args: { x: 500, y: 500, text: 'Aura', clear_before_typing: false } } }]); };
  const receipts = [shot()];
  const mission = { id: 'm2', receipts };
  const first = await jacoComputeTurn({ messages: [], tools: TOOLS, mission, frame: { url: 'x' }, send });
  assert.equal(first.reply.tool_calls[0].function.name, 'mouse-click');
  assert.equal(args(first.reply.tool_calls[0]).expectedHwnd, 77);
  receipts.push({ type: 'mouse-click', ok: true, verified: true, at });
  const look = await jacoComputeTurn({ messages: [], tools: TOOLS, mission, frame: null, send });
  assert.equal(look.local, true);
  assert.deepEqual(args(look.reply.tool_calls[0]).hwnd, 77);
  receipts.push(shot());
  const type = await jacoComputeTurn({ messages: [], tools: TOOLS, mission, frame: { url: 'x' }, send });
  assert.equal(type.reply.tool_calls[0].function.name, 'type-text');
  assert.equal(args(type.reply.tool_calls[0]).text, 'Aura');
  assert.equal(calls, 1);
});

test('a failed continuation step is dropped and the model plans again', async () => {
  resetContinuations();
  let calls = 0;
  const send = async () => { calls++; return answer([{ functionCall: { name: 'type_text_at', args: { x: 1, y: 1, text: 'x' } } }]); };
  const receipts = [shot()];
  const mission = { id: 'm3', receipts };
  await jacoComputeTurn({ messages: [], tools: TOOLS, mission, frame: { url: 'x' }, send });
  receipts.push({ type: 'mouse-click', ok: false, verified: false, at }, shot());
  const next = await jacoComputeTurn({ messages: [], tools: TOOLS, mission, frame: { url: 'x' }, send });
  assert.equal(calls, 2);
  assert.equal(next.reply.tool_calls[0].function.name, 'mouse-click');
});

test('an unexecutable action is explained to the model once, custom calls pass through', async () => {
  resetContinuations();
  const sent = [];
  const replies = [
    answer([{ functionCall: { name: 'scroll_at', args: { x: 1, y: 1, direction: 'left' } } }]),
    answer([{ functionCall: { name: 'complete', args: { reason: 'done' } } }]),
  ];
  const result = await jacoComputeTurn({ messages: [{ role: 'user', content: 'g' }], tools: TOOLS, mission: { id: 'm4', receipts: [shot()] }, frame: { url: 'x' },
    send: async body => { sent.push(structuredClone(body)); return replies.shift(); } });
  assert.equal(result.reply.tool_calls[0].function.name, 'complete');
  assert.match(JSON.stringify(sent[1].contents.at(-1)), /SCROLL_DIRECTION_UNSUPPORTED/);
});

test('HTTP failures are returned to the caller, not swallowed', async () => {
  resetContinuations();
  const result = await jacoComputeTurn({ messages: [], tools: TOOLS, mission: { id: 'm5', receipts: [] }, frame: null, send: async () => ({ status: 429, raw: 'quota' }) });
  assert.equal(result.http.status, 429);
});

test('native Gemini usage settles the shared reservation with Gemini headers', async () => {
  assert.deepEqual(jacoComputeUsage({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 3 } }), { prompt_tokens: 5, completion_tokens: 5 });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    if (url.endsWith('/reserve')) return new Response(JSON.stringify({ success: true, reservationId: 'r1' }));
    if (url.endsWith('/settle')) return new Response(JSON.stringify({ success: true }));
    return new Response(JSON.stringify({ candidates: [], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 1 } }));
  };
  const body = toJacoComputeRequest({ messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 321 });
  await budgetedNovaOllamaCall({ provider: { name: 'gemini', model: MODEL, url: 'https://g/models/m:generateContent', key: 'k' }, requestBody: body,
    runtimeUrl: 'http://127.0.0.1:3000', token: 't', fetchImpl, headers: { 'x-goog-api-key': 'k' }, maxTokens: 321, usageOf: jacoComputeUsage });
  assert.equal(seen[0].body.maxTokens, 321);
  assert.equal(seen[1].init.headers['x-goog-api-key'], 'k');
  assert.equal(seen[1].init.headers.Authorization, undefined);
  assert.deepEqual(seen[2].body.usage, { prompt_tokens: 7, completion_tokens: 1 });
});
