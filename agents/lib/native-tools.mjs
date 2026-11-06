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

// With everything switched on there are ~90 connector tools whose schemas are 35 000 characters, paid on every planning
// call (it pushed one call over the per-task budget). Past this size the connector tools are searched for, not listed:
// the model asks for the ones it needs with tool_search and they are added to its list for the rest of the run.
export const DEFER_MCP_SCHEMA_CHARS = 14_000;

// Tools whose name or description match the words of a query, best first. "select:a,b" names tools exactly.
export function searchDeferredTools(deferred, query, active = new Set(), limit = 8) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return [];
  const exact = text.startsWith('select:') ? new Set(text.slice(7).split(',').map(x => x.trim()).filter(Boolean)) : null;
  const words = exact ? [] : text.split(/[^a-z0-9]+/).filter(w => w.length > 1);
  return deferred
    .filter(d => !active.has(d.name))
    .map(d => {
      const haystack = `${d.name} ${d.server} ${d.tool} ${d.description}`.toLowerCase();
      const score = exact
        ? (exact.has(d.name.toLowerCase()) || exact.has(d.tool.toLowerCase()) ? 100 : 0)
        : words.reduce((n, w) => n + (d.tool.toLowerCase().includes(w) ? 3 : haystack.includes(w) ? 1 : 0), 0);
      return { d, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.d);
}

// One plain sentence for the operator, written by the model with each call: what it is doing and why. Gemini returns tool
// calls without any text, so the sentence has to be a parameter to be reliable.
const SAY = { type: 'string', description: 'Plain words for the operator, in their language, no tool names or jargon. On your FIRST call: your plan in two or three short sentences (what you will do, in what order, and what the end result will be). On later calls: one sentence on what you are doing now and why.' };
// What the last result showed. Together with SAY it makes the chat read like a colleague talking, not a command log.
const LEARNED = { type: 'string', description: 'One short sentence: what the previous result showed and how it changes your plan. Leave empty on the first call or when nothing notable came back.' };

export function plannerTools(allowedTasks = [], mcpTools = [], taskNotes = {}, allowReplan = true, { deferAfterChars = DEFER_MCP_SCHEMA_CHARS } = {}) {
  const targets = new Map();
  const tools = [];
  const mcpDefinitions = [];
  const mcpAllowed = allowedTasks.includes('mcp-call') || allowedTasks.includes('mcp-write');
  for (const type of allowedTasks) {
    if (!Object.hasOwn(TASK_FIELDS, type) || (['mcp-call', 'mcp-write'].includes(type) && mcpAllowed && mcpTools.length)) continue;
    const fields = TASK_FIELDS[type];
    tools.push(fn(type, taskNotes[type] ? `Learned: ${taskNotes[type]}` : null, {
      ...taskContract(type),
      properties: { ...taskContract(type).properties, expectedOutcome: { type: 'string' }, say: SAY, learned: LEARNED },
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
      const description = String(t.description || '').replace(/\s+/g, ' ').slice(0, 150);
      const def = fn(name, `${t.server} MCP${t.readOnly !== true ? ' (changes something)' : ''}: ${description}${t.note ? ` Learned: ${t.note}` : ''}`,
        { ...schema, type: 'object', properties: { ...(schema.properties || {}), expectedOutcome: { type: 'string' }, say: SAY, learned: LEARNED } });
      mcpDefinitions.push({ name, server: t.server, tool: t.name, description, def });
      // A tool that changes something runs as an mcp-write step: never batched or repeated after an interruption.
      targets.set(name, { kind: 'mcp', server: t.server, tool: t.name, write: t.readOnly !== true });
    }
  }
  const deferMcp = mcpDefinitions.reduce((n, d) => n + JSON.stringify(d.def).length, 0) > deferAfterChars;
  const deferred = deferMcp ? mcpDefinitions : [];
  if (!deferMcp) for (const d of mcpDefinitions) tools.push(d.def);
  else {
    const servers = [...new Set(mcpDefinitions.map(d => d.server))].join(', ');
    tools.push(fn('tool_search', `${mcpDefinitions.length} more tools from connected servers (${servers}) are not listed to save cost. Search by a few words (for example "git log", "list directory", "wordpress page") and the matching tools become callable. Use "select:name" for an exact tool.`,
      { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }));
    targets.set('tool_search', { kind: 'search' });
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
  return { tools, deferred, resolve: name => targets.get(name) || null };
}

// The structured fallback planner is single-turn: it cannot execute tool_search and
// activate deferred schemas. When a catalog is large, use the *existing* generic
// MCP task instead of sending every schema (or advertising an unusable search).
// The mission's allowed tasks and the runtime's MCP access checks remain authoritative.
export function structuredPlannerTools(allowedTasks = [], mcpTools = [], taskNotes = {}, allowReplan = true) {
  const catalog = plannerTools(allowedTasks, mcpTools, taskNotes, allowReplan);
  if (!catalog.deferred.length) return catalog;

  // Bounded, data-only identifiers; descriptions from an MCP server are not instructions.
  const notes = { ...taskNotes };
  for (const [type, write] of [['mcp-call', false], ['mcp-write', true]]) {
    if (!allowedTasks.includes(type)) continue;
    const items = catalog.deferred.filter(d => Boolean(catalog.resolve(d.name)?.write) === write);
    let names = '';
    let shown = 0;
    for (const d of items) {
      const safe = [d.server, d.tool].map(s => String(s || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64)).join('.');
      const next = (names ? ', ' : '') + safe;
      if (names.length + next.length > 900) break;
      names += next;
      shown++;
    }
    const kind = write ? 'write' : 'read';
    const summary = `Authorized connected MCP ${kind} tools (server.tool, names only): ${names || '(none)'}${items.length > shown ? ` (+${items.length - shown} more; tools are checked at runtime)` : ''}. Call using server, tool, arguments.`;
    notes[type] = [String(taskNotes[type] || '').slice(0, 300), summary].filter(Boolean).join(' ').slice(0, 1450);
  }
  // Empty catalog yields native generic mcp-call/mcp-write schemas with mandatory
  // server+tool and no tool_search. Does not grant access to any additional tool.
  return plannerTools(allowedTasks, [], notes, allowReplan);
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
