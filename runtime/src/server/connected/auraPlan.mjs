// The plan as the operator sees it: the final goal, each step with what it needs and how it is going, what was
// changed when a step did not lead toward the goal, and the operator's own comments. SEER's mission graph stays the
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
    add({ graphId, nodeKey = null, text }) {
      const t = String(text || '').trim();
      if (!graphId || typeof graphId !== 'string') throw new Error('PLAN_COMMENT_GRAPH_REQUIRED');
      if (t.length < 2 || t.length > 2000) throw new Error('PLAN_COMMENT_TEXT_INVALID');
      const state = read();
      const comment = { id: `c-${crypto.randomBytes(4).toString('hex')}`, graphId, nodeKey: nodeKey ? String(nodeKey).slice(0, 120) : null, text: t, at: now().toISOString() };
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
    case 'helpers': return 'have';
    case 'skill': return (available.skills || new Set()).has(need.id) ? 'have' : 'missing';
    case 'payment': return available.payments ? 'approval' : 'missing';
    case 'api': return 'missing';
    case 'account': case 'publish': return 'approval';
    default: return 'missing';
  }
}

const GAP_TEXT = {
  sv: {
    research: 'att söka på webben (slå på webbsökning under Anslutningar)', browser: 'att styra webbläsaren (starta Chrome med JACO)',
    code: 'att skriva filer i projektet (slå på filskrivning)', skill: id => `en färdig metod (skill) för "${id}": med ditt godkännande kan jag skriva den utifrån det jag hittar på webben`,
    payment: 'en betalkoppling (till exempel Stripe), som bara du kan koppla in', api: 'en koppling till tjänsten steget nämner: säg vilken, så föreslår jag hur den kopplas in',
  },
  en: {
    research: 'to search the web (turn on web search under Connections)', browser: 'to drive the browser (start Chrome with JACO)',
    code: 'to write files in the project (turn on file writing)', skill: id => `a ready method (skill) for "${id}": with your approval I can write it from what I find on the web`,
    payment: 'a payment connection (for example Stripe), which only you can connect', api: 'a connection to the service the step names: tell me which, and I suggest how to connect it',
  },
};

export function gapSummary(nodes, language = 'en') {
  const t = GAP_TEXT[language] || GAP_TEXT.en;
  const missing = new Map();
  for (const n of nodes) for (const need of n.needs) if (need.state === 'missing') {
    const key = need.kind === 'skill' ? `skill:${need.id}` : need.kind;
    if (!missing.has(key)) missing.set(key, typeof t[need.kind] === 'function' ? t[need.kind](need.id) : t[need.kind] || need.label);
  }
  if (!missing.size) return { missing: [], text: language === 'sv' ? 'Jag har det som planen behöver. Det som kräver ditt godkännande frågar jag om när det blir aktuellt.' : 'I have what the plan needs. What needs your approval I will ask about when the time comes.' };
  const list = [...missing.values()];
  return { missing: list, text: (language === 'sv' ? 'Jag har gått igenom målet och mina förmågor. Det här saknar jag än: ' : 'I have studied the goal and my abilities. This is what I still lack: ') + list.join('; ') + '.' };
}

export function planView(graph, { comments = [], skills = [], language = 'en', available = null } = {}) {
  const words = STATUS[language] || STATUS.en;
  const nodes = (graph.nodes || []).map(n => ({
    key: n.key, title: n.title, objective: n.objective, status: n.status, statusText: words[n.status] || n.status,
    dependencies: n.dependencies || [], missionId: n.nova_mission_id || null, failure: n.failure_reason || null,
    needs: needsFor(`${n.title}\n${n.objective}`, { skills, language }).map(need => ({ ...need, state: available ? needStatus(need, available) : null })),
    comments: comments.filter(c => c.nodeKey === n.key),
  }));
  const open = nodes.filter(n => !['VERIFIED', 'SUPERSEDED', 'CANCELLED'].includes(n.status));
  const done = nodes.filter(n => n.status === 'VERIFIED').length;
  const active = nodes.filter(n => !['SUPERSEDED', 'CANCELLED'].includes(n.status));
  return {
    id: graph.id, title: graph.title, objective: graph.objective, status: graph.status,
    progress: { done, total: active.length },
    needsApproval: [...new Map(nodes.flatMap(n => n.needs.filter(x => x.approval)).map(x => [x.kind, x])).values()],
    nodes,
    changes: (graph.replans || []).map(r => ({ at: Number.isFinite(r.created_at) ? new Date(r.created_at * 1000).toISOString() : null, reason: r.reason || null, replaced: r.failed_node_key || null, replacement: r.replacement_node_key || null })),
    comments: comments.filter(c => !c.nodeKey),
    // What Aura lacks for the steps still ahead, in her own words. Only computed when availability is known.
    abilities: available ? gapSummary(open, language) : null,
  };
}
