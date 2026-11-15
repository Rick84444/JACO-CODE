// Ollama's OpenAI-compatible endpoint cannot set the context size and ignores `options`. With the default 4096 tokens it silently
// cut JACO's planner prompts in half, so the model never saw the goal and answered "please provide a task" (2026-11-01). Requests
// to a local Ollama therefore go through its native endpoint with an explicit context, and answer in the OpenAI shape callers expect.
const OLLAMA_PORT = '11434';

export function isLocalOllamaChat(url, env = process.env) {
  try {
    const u = new URL(String(url));
    if (u.pathname !== '/v1/chat/completions' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return false;
    const configured = env.OLLAMA_BASE_URL ? new URL(env.OLLAMA_BASE_URL).port : '';
    return u.port === OLLAMA_PORT || (configured && u.port === configured);
  } catch { return false; }
}

const numCtx = env => {
  const n = Number(env.JACO_OLLAMA_NUM_CTX);
  return Number.isInteger(n) && n >= 2048 ? n : 16384;
};
const parseArguments = value => {
  if (typeof value !== 'string') return value ?? {};
  try { return JSON.parse(value); } catch { return {}; }
};

export function toNativeRequest(body, env = process.env) {
  const messages = (body.messages || []).map(message => message.tool_calls ? { ...message,
    tool_calls: message.tool_calls.map(call => ({ function: { name: call.function?.name, arguments: parseArguments(call.function?.arguments) } })) } : message);
  return {
    model: body.model, messages, stream: false, think: false,
    ...(body.tools?.length ? { tools: body.tools } : {}),
    ...(body.response_format?.type === 'json_object' ? { format: 'json' } : {}),
    ...(body.response_format?.type === 'json_schema' && body.response_format.json_schema?.schema ? { format: body.response_format.json_schema.schema } : {}),
    options: { num_ctx: numCtx(env), ...(body.temperature != null ? { temperature: body.temperature } : {}), ...(body.max_tokens != null ? { num_predict: body.max_tokens } : {}) },
  };
}

export function fromNativeResponse(data) {
  if (data?.error) return { error: { message: typeof data.error === 'string' ? data.error : String(data.error.message || JSON.stringify(data.error)) } };
  const calls = (data?.message?.tool_calls || []).map((call, index) => ({ id: `call_${index}`, type: 'function',
    function: { name: call.function?.name, arguments: JSON.stringify(call.function?.arguments ?? {}) } }));
  return {
    model: data?.model,
    choices: [{ index: 0, finish_reason: calls.length ? 'tool_calls' : data?.done_reason === 'length' ? 'length' : 'stop',
      message: { role: 'assistant', content: data?.message?.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) } }],
    usage: { prompt_tokens: data?.prompt_eval_count ?? 0, completion_tokens: data?.eval_count ?? 0, total_tokens: (data?.prompt_eval_count ?? 0) + (data?.eval_count ?? 0) },
  };
}

// A fetch that sends local Ollama chats natively and passes every other request through untouched.
export function withLocalOllamaContext(fetchImpl = globalThis.fetch, env = process.env) {
  return async (url, init = {}) => {
    if (!isLocalOllamaChat(url, env) || typeof init.body !== 'string') return fetchImpl(url, init);
    let body;
    try { body = JSON.parse(init.body); } catch { return fetchImpl(url, init); }
    if (body.stream) return fetchImpl(url, init);
    const response = await fetchImpl(new URL('/api/chat', String(url)).href, { ...init, body: JSON.stringify(toNativeRequest(body, env)) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { return new Response(text, { status: response.status }); }
    // A caller or test double that already speaks the OpenAI shape is left alone.
    const mapped = data?.choices ? data : fromNativeResponse(data);
    return new Response(JSON.stringify(mapped), { status: response.status, headers: { 'content-type': 'application/json' } });
  };
}
