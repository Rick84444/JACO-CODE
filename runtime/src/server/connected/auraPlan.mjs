// The plan as the operator sees it: the final goal, each step with what it needs and how it is going, what was
// changed when a step did not lead toward the goal, and the operator's own comments. Aura's mission graph stays the
// owner of the plan; this only reads it and keeps the comments, which reach each step as direction.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { needsFor } from '../../../../agents/lib/capability-needs.mjs';

export function createPlanComments({ file, now = () => new Date() }) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { comments: [] }; } };
  const write = state => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n'); fs.renameSync(tmp, file); };
  return {
    list(graphId) { return read().comments.filter(c => !graphId || c.graphId === graphId); },
    add({ graphId, nodeKey = null, text, author = 'operator' }) {
      const t = String(text || '').trim();
      if (!graphId || typeof graphId !== 'string') throw new Error('PLAN_COMMENT_GRAPH_REQUIRED');
      if (t.length < 2 || t.length > 2000) throw new Error('PLAN_COMMENT_TEXT_INVALID');
      const state = read();
      const comment = { id: `c-${crypto.randomBytes(4).toString('hex')}`, graphId, nodeKey: nodeKey ? String(nodeKey).slice(0, 120) : null, text: t, author: author === 'aura' ? 'aura' : 'operator', at: now().toISOString() };
      state.comments.push(comment);
      state.comments = state.comments.slice(-500);
      write(state); return comment;
    },
  };
}

const STATUS = {
  sv: { BLOCKED: 'Väntar', READY: 'Redo', DISPATCHED: 'Startad', RUNNING: 'Pågår', VERIFIED: 'Klart', FAILED: 'Misslyckades', SUPERSEDED: 'Ersatt', CANCELLED: 'Avbruten' },
  en: { BLOCKED: 'Waiting', READY: 'Ready', DISPATCHED: 'Started', RUNNING: 'In progress', VERIFIED: 'Done', FAILED: 'Failed', SUPERSEDED: 'Replaced', CANCELLED: 'Cancelled' },
};

// Which of a step's needs Aura already has. `available` is what this installation can do right now: the tasks the
// operator has switched on, the installed skills, and whether a payment connection exists. Unknown means "ask".
export function needStatus(need, available = {}) {
  const tasks = available.tasks || new Set();
  const on = t => tasks.has(t);
  switch (need.kind) {
    case 'research': return on('web-fetch') ? 'have' : 'missing';
    case 'browser': return on('browser-click') || on('browser-survey-site') ? 'have' : 'missing';
    case 'code': return on('repo-write') || on('repo-edit') ? 'have' : 'missing';
    // A registered helper or an enabled task switch is not a verified helper execution.
    case 'helpers': return available.helpersVerified === true ? 'have' : 'missing';
    case 'skill': return (available.skills || new Set()).has(need.id) ? 'have' : 'missing';
    case 'payment': return available.payments ? 'approval' : 'missing';
    // A service connection is "had" only when an MCP tool for it is observed answering (reachable or verified);
    // one observed failing is missing even if it is registered. Nothing is read from the goal's wording.
    case 'api': {
      const view = available.observed;
      if (!view) return 'missing';
      const match = key => key.startsWith('mcp:') && (!need.id || key.toLowerCase().includes(String(need.id).toLowerCase()));
      if ((view.blocked || []).some(b => match(String(b.tool)))) return 'missing';
      return (view.usable || []).some(match) ? 'have' : 'missing';
    }
    case 'account': case 'publish': return 'approval';
    default: return 'missing';
  }
}

const GAP_TEXT = {
  sv: {
    research: 'att söka på webben (slå på webbsökning under Anslutningar)', browser: 'att styra webbläsaren (starta Chrome med JACO)',
    code: 'att skriva filer i projektet (slå på filskrivning)', skill: id => `en färdig metod (skill) för "${id}": med ditt godkännande kan jag skriva den utifrån det jag hittar på webben`,
    payment: 'en betalkoppling (till exempel Stripe), som bara du kan koppla in', api: 'en koppling till tjänsten steget nämner: säg vilken, så föreslår jag hur den kopplas in',
    helpers: 'en verifierad körväg för hjälpagenten (en registrering eller påslagen funktion räcker inte)',
  },
  en: {
    research: 'to search the web (turn on web search under Connections)', browser: 'to drive the browser (start Chrome with JACO)',
    code: 'to write files in the project (turn on file writing)', skill: id => `a ready method (skill) for "${id}": with your approval I can write it from what I find on the web`,
    payment: 'a payment connection (for example Stripe), which only you can connect', api: 'a connection to the service the step names: tell me which, and I suggest how to connect it',
    helpers: 'a verified helper execution path (registration or an enabled switch is not enough)',
  },
};

export function gapSummary(nodes, language = 'en') {
  const t = GAP_TEXT[language] || GAP_TEXT.en;
  const missing = new Map();
  for (const n of nodes) for (const need of n.needs) if (need.state === 'missing') {
    const key = need.kind === 'skill' ? `skill:${need.id}` : need.kind;
    if (!missing.has(key)) missing.set(key, typeof t[need.kind] === 'function' ? t[need.kind](need.id) : t[need.kind] || need.label);
  }
  if (!missing.size) return { missing: [], text: language === 'sv' ? 'Planens funktioner är aktiverade enligt inställningarna, men deras tillgänglighet verifieras vid körning. Jag frågar om ditt godkännande när det behövs.' : 'The plan features are enabled in settings, but availability is verified during execution. I ask for your approval when needed.' };
  const list = [...missing.values()];
  return { missing: list, text: (language === 'sv' ? 'Jag har gått igenom målet och mina förmågor. Det här saknar jag än: ' : 'I have studied the goal and my abilities. This is what I still lack: ') + list.join('; ') + '.' };
}

// Aura is the agent the operator sees; planning and execution are her capabilities. Plan text written while the
// internal services still had their own names says Aura instead, so the Gameboard never shows SEER or Nova.
export function productNames(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\b(?:SEER|Nova|ModelRelay)(?:'s)?\b(?:, (?:SEER|Nova|ModelRelay)\b)*/g, m => m.endsWith("'s") ? "Aura's" : 'Aura')
    .replace(/\bAura(, Aura)+\b/g, 'Aura').replace(/\bAura's (?:representation|presence) in Aura\b/g, "Aura's own state");
}

export function planView(graph, { comments = [], skills = [], language = 'en', available = null } = {}) {
  const words = STATUS[language] || STATUS.en;
  const intuition = typeof graph?.policy?.intuition_statement === 'string' && graph.policy.intuition_statement.trim()
    ? graph.policy.intuition_statement.slice(0, 1500)
    : graph.objective;
  const nodes = (graph.nodes || []).map(n => ({
    key: n.key, title: productNames(n.title), objective: productNames(n.objective), status: n.status, statusText: words[n.status] || n.status,
    dependencies: n.dependencies || [], missionId: n.nova_mission_id || null, failure: productNames(n.failure_reason || null),
    // Evidence comes from Aura's persisted mission graph node record. It is never inferred
    // from text, capability registration, simulation, or an asserted status.
    evidenceRefs: Array.isArray(n.evidence_refs) ? n.evidence_refs.filter(x => typeof x === 'string').slice(0, 40) : [],
    updatedAt: n.updated_at ?? null,
    needs: needsFor(`${n.title}\n${n.objective}`, { skills, language }).map(need => ({ ...need, state: available ? needStatus(need, available) : null })),
    comments: comments.filter(c => c.nodeKey === n.key),
  }));
  const open = nodes.filter(n => !['VERIFIED', 'SUPERSEDED', 'CANCELLED'].includes(n.status));
  const done = nodes.filter(n => n.status === 'VERIFIED').length;
  const active = nodes.filter(n => !['SUPERSEDED', 'CANCELLED'].includes(n.status));
  return {
    id: graph.id, title: productNames(graph.title), objective: productNames(graph.objective),
    intuition: productNames(intuition), intuitionId: graph?.policy?.intuition_id || null,
    status: graph.status,
    progress: { done, total: active.length },
    needsApproval: [...new Map(nodes.flatMap(n => n.needs.filter(x => x.approval)).map(x => [x.kind, x])).values()],
    nodes,
    changes: (graph.replans || []).map(r => ({ at: Number.isFinite(r.created_at) ? new Date(r.created_at * 1000).toISOString() : null, reason: r.reason || null, replaced: r.failed_node_key || null, replacement: r.replacement_node_key || null })),
    comments: comments.filter(c => !c.nodeKey),
    // What Aura lacks for the steps still ahead, in her own words. Only computed when availability is known.
    abilities: available ? gapSummary(open, language) : null,
  };
}
