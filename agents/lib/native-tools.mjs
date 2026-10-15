// Native tool calling for Nova's planner (operator 2026-10-03: take over what Claude does better).
// Instead of writing its next step as JSON in text, the model calls functions with schemas: one per
// allowed task, one per read-only MCP tool (with the server's real input schema), plus complete and
// blocked. Several calls in one answer become a batched plan ({tasks:[...]}). Everything the calls
// produce still goes through the same plan validation, mission begin checks and receipts.
import { TASK_FIELDS, taskContract } from './task-fields.mjs';

const NAME = /[^A-Za-z0-9_-]/g;
const DROP_KEYS = new Set(['description', 'title', '$schema', 'examples', 'default']);

// Schema without prose: the descriptions are in the tool description and the system prompt, and every
// token of a tool list is paid on every planning call.
export function compactSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 6) return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DROP_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compactSchema(v, depth + 1)]));
    } else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = compactSchema(value, depth + 1);
    else out[key] = value;
  }
  return out;
}

const fn = (name, description, parameters) => ({ type: 'function', function: { name, ...(description ? { description } : {}), parameters } });

export function plannerTools(allowedTasks = [], mcpTools = [], taskNotes = {}, allowReplan = true) {
  const targets = new Map();
  const tools = [];
  const mcpAllowed = allowedTasks.includes('mcp-call') || allowedTasks.includes('mcp-write');
  for (const type of allowedTasks) {
    if (!Object.hasOwn(TASK_FIELDS, type) || (['mcp-call', 'mcp-write'].includes(type) && mcpAllowed && mcpTools.length)) continue;
    const fields = TASK_FIELDS[type];
    tools.push(fn(type, taskNotes[type] ? `Learned: ${taskNotes[type]}` : null, {
      ...taskContract(type),
      properties: { ...taskContract(type).properties, expectedOutcome: { type: 'string' } },
      required: fields, additionalProperties: true,
    }));
    targets.set(type, { kind: 'task', type });
  }
  if (mcpAllowed) {
    // Not offered as a function when the MCP tools are, but the prompt still names the mcp-call task:
    // gpt-oss on Ollama Cloud called it directly (PLAN_TOOL_UNKNOWN:mcp-call, 2026-10-04). Such a call
    // becomes an ordinary mcp-call task and is validated like one (server, tool, read-only).
    for (const alias of ['mcp-call', 'mcp_call']) targets.set(alias, { kind: 'task', type: 'mcp-call' });
    if (allowedTasks.includes('mcp-write')) for (const alias of ['mcp-write', 'mcp_write']) targets.set(alias, { kind: 'task', type: 'mcp-write' });
    for (const t of mcpTools) {
      // Tool catalog caches may outlive an earlier, more privileged mission.
      // Only readOnly===true is a positive read-only attestation; missing/unknown
      // metadata must require the stronger mcp-write mission capability.
      if (t.readOnly !== true && !allowedTasks.includes('mcp-write')) continue;
      const name = `mcp__${t.server}__${t.name}`.replace(NAME, '_').slice(0, 64);
      if (targets.has(name)) continue;
      const schema = compactSchema(t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : {});
      tools.push(fn(name, `${t.server} MCP${t.readOnly !== true ? ' (changes something)' : ''}: ${String(t.description).replace(/\s+/g, ' ').slice(0, 150)}${t.note ? ` Learned: ${t.note}` : ''}`,
        { ...schema, type: 'object', properties: { ...(schema.properties || {}), expectedOutcome: { type: 'string' } } }));
      // A tool that changes something runs as an mcp-write step: never batched or repeated after an interruption.
      targets.set(name, { kind: 'mcp', server: t.server, tool: t.name, write: t.readOnly !== true });
    }
  }
  tools.push(fn('complete', 'The goal is satisfied; reason is the answer to the operator with the evidence (cite steps as [#n]).',
    { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] }));
  tools.push(fn('blocked', 'No allowed tool can make progress; reason says which capability is missing.',
    { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] }));
  targets.set('complete', { kind: 'complete' });
  targets.set('blocked', { kind: 'blocked' });
  if (allowReplan) tools.push(fn('request_replan', 'Ask SEER to refine this graph node into smaller sequential subgoals. Preserve the original goal, authority and verification. This pauses execution; it does not complete the mission.', {
    type: 'object', properties: { reason: { type: 'string' }, subgoals: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', properties: { title: { type: 'string' }, objective: { type: 'string' } }, required: ['title','objective'], additionalProperties: false } } }, required: ['reason','subgoals'], additionalProperties: false,
  }));
  if (allowReplan) targets.set('request_replan', { kind: 'replan' });
  return { tools, resolve: name => targets.get(name) || null };
}

// The plan expressed by an answer's tool calls, or null when it made none. A call to an unknown
// function or with unparsable arguments is a bad plan from this model (PLAN_ prefix: the next provider
// is told why).
export function planFromToolCalls(message, resolve) {
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (!calls.length) return null;
  const tasks = [];
  let finish = null;
  for (const call of calls) {
    const name = String(call?.function?.name || '');
    const target = resolve(name);
    if (!target) throw new Error(`PLAN_TOOL_UNKNOWN:${name.slice(0, 60)}`);
    let args;
    try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : (call.function.arguments || {}); }
    catch { throw new Error(`PLAN_TOOL_ARGUMENTS_INVALID:${name.slice(0, 60)}`); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(`PLAN_TOOL_ARGUMENTS_INVALID:${name.slice(0, 60)}`);
    const { expectedOutcome, ...data } = args;
    const expected = typeof expectedOutcome === 'string' && expectedOutcome.trim() ? { expectedOutcome: expectedOutcome.slice(0, 300) } : {};
    if (target.kind === 'task') tasks.push({ type: target.type, data, ...expected });
    else if (target.kind === 'mcp') tasks.push({ type: target.write ? 'mcp-write' : 'mcp-call', data: { server: target.server, tool: target.tool, arguments: data }, ...expected });
    else finish ||= { [target.kind]: true, reason: String(args.reason || '').slice(0, 4000), ...(target.kind === 'replan' ? { subgoals: args.subgoals } : {}) };
  }
  // Steps win over a finish in the same answer: completion is proposed after their receipts are seen.
  if (tasks.length) return tasks.length === 1 ? { task: tasks[0] } : { tasks };
  return finish;
}

// A JSON schema for a whole planner answer (operator 2026-10-04: the JACO shell locks the model inside
// its contract). Local models get it as a decoding constraint (Ollama response_format json_schema), so
// they can only answer with an allowed task and its required fields, a batch of them, or complete or
// blocked with a reason. Runtime validation still applies to every task.
export function planSchema(allowedTasks = [], allowReplan = true) {
  const tasks = allowedTasks.filter(t => Object.hasOwn(TASK_FIELDS, t));
  const taskSchema = {
    anyOf: tasks.map(type => ({
      type: 'object',
      properties: {
        type: { type: 'string', const: type },
        // Optional fields (e.g. mcp-call arguments, browser-click expect) stay allowed.
        data: taskContract(type),
        expectedOutcome: { type: 'string' },
      },
      required: ['type', 'data', 'expectedOutcome'],
    })),
  };
  const continuity = { type: 'object' };
  return {
    anyOf: [
      { type: 'object', properties: { task: taskSchema, continuity }, required: ['task'] },
      { type: 'object', properties: { tasks: { type: 'array', items: taskSchema, minItems: 1, maxItems: 4 }, continuity }, required: ['tasks'] },
      { type: 'object', properties: { complete: { type: 'boolean', const: true }, reason: { type: 'string' } }, required: ['complete', 'reason'] },
      { type: 'object', properties: { blocked: { type: 'boolean', const: true }, reason: { type: 'string' } }, required: ['blocked', 'reason'] },
      ...(allowReplan ? [{ type: 'object', properties: { replan: { type: 'boolean', const: true }, reason: { type: 'string' }, subgoals: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', properties: { title: { type: 'string' }, objective: { type: 'string' } }, required: ['title','objective'], additionalProperties: false } } }, required: ['replan','reason','subgoals'] }] : []),
    ],
  };
}
