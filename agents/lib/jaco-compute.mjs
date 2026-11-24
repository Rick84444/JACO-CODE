// JACO Compute: Aura's screen-control planner (operator 2026-11-23; named JACO Compute 2026-11-24).
// It is backed by Google's Gemini computer-use models; the provider stays "gemini" and Google's
// model IDs and endpoint are used unchanged, because the API requires them.
//
// The Gemini computer-use models only speak the native generateContent protocol with the
// `computerUse` tool and answer with predefined UI actions (click_at, type_text_at, ...) in
// coordinates normalized to 0-999 over the screenshot. This adapter is the translation layer
// between that protocol and Nova's existing native agent loop:
//
// - the loop's OpenAI-style conversation and tools become Gemini contents and declarations;
// - each predefined action becomes an EXISTING JACO input task (mouse-click, type-text, ...)
//   bound to the window of the mission's latest verified screenshot.
//
// Nothing here grants authority. Every translated task still passes observedInputBinding, the
// runtime's begin/finish gates, ModelRelay and the shared budget reservation. A Gemini safety
// decision that asks for confirmation is never confirmed here: it stops as `blocked` for the
// operator. Screenshot bytes are only sent when permittedFrameMessages allowed them.

export const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const isJacoComputeModel = model => /(^|[-_/.])computer-use([-_/.]|$)/i.test(String(model || ''));

// Browser-only actions have no desktop equivalent in the input bridge; dragging and waiting
// have no JACO task. Excluding them keeps the model inside what can actually be executed.
export const DESKTOP_EXCLUDED_ACTIONS = Object.freeze(['open_web_browser', 'navigate', 'go_back', 'go_forward', 'search', 'drag_and_drop', 'wait_5_seconds']);
const PREDEFINED = new Set(['click_at', 'hover_at', 'type_text_at', 'key_combination', 'scroll_at', 'scroll_document', ...DESKTOP_EXCLUDED_ACTIONS]);

export function jacoComputeEndpoint(model, base = GEMINI_NATIVE_BASE) {
  const id = String(model || '').replace(/^models\//, '');
  if (!/^[\w.-]{1,120}$/.test(id)) throw new Error('JACO_COMPUTE_MODEL_ID_INVALID');
  return `${base.replace(/\/$/, '')}/models/${id}:generateContent`;
}

// Gemini function declarations accept an OpenAPI subset; unknown keys such as
// additionalProperties are rejected with HTTP 400.
const SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'nullable', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength']);
export function sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeSchema(v)]));
    else if (key === 'items') out.items = sanitizeSchema(value);
    else out[key] = value;
  }
  return out;
}

const dataUrlPart = url => {
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(url || ''));
  return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
};
const userParts = content => {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap(part => {
    if (part?.type === 'text' && part.text) return [{ text: String(part.text) }];
    if (part?.type === 'image_url') { const inline = dataUrlPart(part.image_url?.url); return inline ? [inline] : []; }
    return [];
  });
};
const parseArgs = raw => { try { const v = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };

// OpenAI-style conversation -> Gemini request. Consecutive turns of one role are merged,
// because the native API expects alternating user/model content.
export function toJacoComputeRequest({ messages = [], tools = [], excluded = DESKTOP_EXCLUDED_ACTIONS, maxOutputTokens = 8192 } = {}) {
  const system = [];
  const contents = [];
  const names = new Map();
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  };
  for (const message of messages) {
    if (message?.role === 'system') { const text = userParts(message.content).map(p => p.text).filter(Boolean).join('\n'); if (text) system.push(text); continue; }
    if (message?.role === 'assistant') {
      const parts = [];
      if (typeof message.content === 'string' && message.content.trim()) parts.push({ text: message.content });
      for (const call of message.tool_calls || []) {
        const name = String(call?.function?.name || '');
        if (!name) continue;
        names.set(call.id, name);
        parts.push({ functionCall: { name, args: parseArgs(call.function.arguments) }, ...(call.gemini_thought_signature ? { thoughtSignature: call.gemini_thought_signature } : {}) });
      }
      push('model', parts);
      continue;
    }
    if (message?.role === 'tool') {
      const name = names.get(message.tool_call_id) || 'tool';
      const result = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? null);
      push('user', [{ functionResponse: { name, response: { result } } }]);
      continue;
    }
    push('user', userParts(message?.content));
  }
  const declarations = tools
    .map(tool => tool?.function)
    .filter(fn => fn?.name && !PREDEFINED.has(fn.name))
    .map(fn => ({ name: fn.name, ...(fn.description ? { description: String(fn.description) } : {}), ...(fn.parameters ? { parameters: sanitizeSchema(fn.parameters) } : {}) }));
  return {
    ...(system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
    contents,
    tools: [
      { computerUse: { environment: 'ENVIRONMENT_BROWSER', excludedPredefinedFunctions: [...excluded] } },
      ...(declarations.length ? [{ functionDeclarations: declarations }] : []),
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens },
  };
}

// The window and captured region of the mission's latest verified screenshot: the only
// target a translated pointer action may use (observedInputBinding re-checks it at execution).
export function screenshotBinding(mission) {
  const receipts = Array.isArray(mission?.receipts) ? mission.receipts : [];
  const receipt = receipts.findLast(r => r?.type === 'screenshot');
  if (!receipt?.ok || !receipt.verified) return null;
  const perception = receipt.result?.perception || {};
  const win = perception.inputWindow;
  const capture = perception.capture || receipt.result?.capture;
  const ints = r => r && [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) && r.width > 0 && r.height > 0;
  if (!win || !Number.isSafeInteger(win.hwnd) || win.hwnd <= 0 || !ints(capture)) return null;
  return { hwnd: win.hwnd, capture: { ...capture } };
}

// Gemini key names -> the input bridge's key table (agents/input-bridge.ps1).
const KEY_ALIASES = { control: 'ctrl', ctl: 'ctrl', meta: 'win', command: 'win', cmd: 'win', super: 'win', option: 'alt', escape: 'esc', return: 'enter',
  pagedown: 'pgdn', pageup: 'pgup', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', del: 'delete', ' ': 'space', spacebar: 'space' };
export function normalizeKeys(keys) {
  const parts = String(keys || '').split('+').map(k => k.trim().toLowerCase()).filter(Boolean).map(k => KEY_ALIASES[k] || k);
  if (!parts.length || parts.length > 4) throw new Error('COMPUTER_USE_KEYS_INVALID');
  return parts.join('+');
}

const point = (nx, ny, capture) => {
  const n = Number(nx), m = Number(ny);
  if (!Number.isFinite(n) || !Number.isFinite(m) || n < 0 || m < 0 || n > 999 || m > 999) throw new Error('COMPUTER_USE_COORDINATES_INVALID');
  return {
    x: capture.x + Math.min(capture.width - 1, Math.floor((n / 1000) * capture.width)),
    y: capture.y + Math.min(capture.height - 1, Math.floor((m / 1000) * capture.height)),
  };
};
const notches = magnitude => Math.max(1, Math.min(15, Math.round((Number.isFinite(Number(magnitude)) ? Number(magnitude) : 800) / 200)));
const scrollDelta = (direction, magnitude) => {
  const d = String(direction || '').toLowerCase();
  if (d === 'up') return notches(magnitude);
  if (d === 'down') return -notches(magnitude);
  throw new Error('COMPUTER_USE_SCROLL_DIRECTION_UNSUPPORTED:' + d.slice(0, 20));
};

// One predefined action -> the first JACO task now, plus tasks that need a fresh observation
// before each of them (typing after a click). A confirmation request is never translated.
export function translateComputerAction(name, args = {}, binding) {
  const decision = args?.safety_decision;
  if (decision && String(decision.decision || '') !== 'proceed' && String(decision.decision || '') !== 'regular') {
    return { confirmation: String(decision.explanation || 'Gemini asked for operator confirmation').slice(0, 600) };
  }
  if (!binding) throw new Error('COMPUTER_USE_WINDOW_BOUND_SCREENSHOT_REQUIRED');
  const expectedHwnd = binding.hwnd;
  switch (name) {
    case 'click_at': return { tasks: [{ type: 'mouse-click', data: { ...point(args.x, args.y, binding.capture), expectedHwnd } }] };
    case 'hover_at': return { tasks: [{ type: 'mouse-move', data: { ...point(args.x, args.y, binding.capture), expectedHwnd } }] };
    case 'type_text_at': {
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text) throw new Error('COMPUTER_USE_TEXT_REQUIRED');
      const later = [
        ...(args.clear_before_typing === false ? [] : [{ type: 'key-press', data: { keys: 'ctrl+a' } }]),
        { type: 'type-text', data: { text } },
        ...(args.press_enter === true ? [{ type: 'key-press', data: { keys: 'enter' } }] : []),
      ];
      return { tasks: [{ type: 'mouse-click', data: { ...point(args.x, args.y, binding.capture), expectedHwnd } }], later };
    }
    case 'key_combination': return { tasks: [{ type: 'key-press', data: { keys: normalizeKeys(args.keys), expectedHwnd } }] };
    case 'scroll_at': return { tasks: [{ type: 'mouse-scroll', data: { ...point(args.x, args.y, binding.capture), delta: scrollDelta(args.direction, args.magnitude), expectedHwnd } }] };
    case 'scroll_document': return { tasks: [{ type: 'mouse-scroll', data: { ...point(500, 500, binding.capture), delta: scrollDelta(args.direction, 1000), expectedHwnd } }] };
    default: throw new Error('COMPUTER_USE_ACTION_UNSUPPORTED:' + String(name).slice(0, 40));
  }
}

// Per mission, in this process only: tasks that wait for a fresh observation. Losing this on a
// restart is safe: the model sees the last receipt and plans again.
const continuations = new Map();
export function resetContinuations() { continuations.clear(); }

const RAW_INPUT = new Set(['mouse-move', 'mouse-click', 'mouse-scroll', 'key-press', 'type-text']);
let callSeq = 0;
const call = (name, args) => ({ id: `gcu-${Date.now().toString(36)}-${++callSeq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const observe = (binding, toolNames) => toolNames.has('screenshot')
  ? call('screenshot', { hwnd: binding.hwnd, mode: 'full', say: 'I look at the screen again before the next step.' })
  : null;

// One planner turn. `send(requestBody)` performs the (budgeted) HTTP call and returns
// { status, data, raw }. Returns { reply } (OpenAI-style message) or { http: { status, raw, data } }.
export async function jacoComputeTurn({ messages, tools = [], mission, frame, send, maxOutputTokens = 8192, retries = 1 }) {
  const toolNames = new Set(tools.map(t => t?.function?.name).filter(Boolean));
  const binding = screenshotBinding(mission);
  const receipts = Array.isArray(mission?.receipts) ? mission.receipts : [];
  const last = receipts.at(-1);
  const pending = continuations.get(mission?.id);

  // Continue a multi-step action (click, then type) without another model call.
  if (pending) {
    // Every step since the action began must have succeeded; a later screenshot must not hide a failed click.
    const since = receipts.slice(pending.since);
    const intact = receipts.length >= pending.after && since.length > 0 && since.every(r => r?.ok === true && !r.outcomeUnknown);
    if (!intact || !binding || binding.hwnd !== pending.hwnd) continuations.delete(mission.id);
    else if (!frame) {
      const look = observe(binding, toolNames);
      if (look) { pending.after = receipts.length + 1; return { reply: { content: '', tool_calls: [look] }, local: true }; }
      continuations.delete(mission.id);
    } else {
      const next = pending.queue.shift();
      if (!pending.queue.length) continuations.delete(mission.id); else pending.after = receipts.length + 1;
      if (next && toolNames.has(next.type)) {
        return { reply: { content: '', tool_calls: [call(next.type, { ...next.data, expectedHwnd: binding.hwnd, say: 'I continue the same step.' })] }, local: true };
      }
      continuations.delete(mission.id);
    }
  }

  // The computer-use protocol answers every action with a new screenshot. After an input step the
  // frame is stale, so observe the same window locally instead of paying for a blind model turn.
  if (!frame && binding && last?.ok === true && !last.outcomeUnknown && RAW_INPUT.has(last.type)) {
    const look = observe(binding, toolNames);
    if (look) return { reply: { content: '', tool_calls: [look] }, local: true };
  }

  const request = toJacoComputeRequest({ messages, tools, maxOutputTokens });
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await send(request);
    if (!result || result.status < 200 || result.status >= 300) return { http: result || { status: 0 } };
    const candidate = result.data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
    const tool_calls = [];
    let failure = null;
    for (const part of parts) {
      const fc = part.functionCall;
      if (!fc?.name) continue;
      const signature = part.thoughtSignature ? { gemini_thought_signature: part.thoughtSignature } : {};
      if (!PREDEFINED.has(fc.name)) { tool_calls.push({ ...call(fc.name, fc.args || {}), ...signature }); continue; }
      try {
        const translated = translateComputerAction(fc.name, fc.args || {}, binding);
        if (translated.confirmation) {
          return { reply: { content: text, tool_calls: [call('blocked', { reason: `JACO Compute asks for the operator's confirmation before this step: ${translated.confirmation}` })] }, usage: result.data?.usageMetadata };
        }
        const [first] = translated.tasks;
        if (!toolNames.has(first.type)) throw new Error('COMPUTER_USE_TASK_NOT_ALLOWED:' + first.type);
        if (translated.later?.length && mission?.id) continuations.set(mission.id, { hwnd: binding.hwnd, queue: translated.later, after: receipts.length + 1, since: receipts.length });
        tool_calls.push({ ...call(first.type, { ...first.data, say: text.slice(0, 300) || `JACO Compute: ${fc.name}` }), ...signature });
      } catch (error) {
        failure = { name: fc.name, args: fc.args || {}, error: String(error?.message || error) };
        break;
      }
    }
    if (!failure) return { reply: { content: text, tool_calls }, usage: result.data?.usageMetadata };
    // Tell the model why its action cannot run here and let it choose another one, once.
    request.contents.push({ role: 'model', parts: [{ functionCall: { name: failure.name, args: failure.args } }] });
    request.contents.push({ role: 'user', parts: [{ functionResponse: { name: failure.name, response: { error: failure.error } } }] });
  }
  return { reply: { content: '', tool_calls: [call('blocked', { reason: 'JACO Compute proposed only actions this desktop cannot execute.' })] } };
}

// Gemini's usage block in the shape the shared cost settlement expects. Hidden thinking is
// billed as output, so it counts as completion tokens.
export function jacoComputeUsage(data) {
  const u = data?.usageMetadata;
  if (!u || !Number.isInteger(u.promptTokenCount)) return null;
  return { prompt_tokens: u.promptTokenCount, completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
}
