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

export function planView(graph, { comments = [], skills = [], language = 'en' } = {}) {
  const words = STATUS[language] || STATUS.en;
  const nodes = (graph.nodes || []).map(n => ({
    key: n.key, title: n.title, objective: n.objective, status: n.status, statusText: words[n.status] || n.status,
    dependencies: n.dependencies || [], missionId: n.nova_mission_id || null, failure: n.failure_reason || null,
    needs: needsFor(`${n.title}\n${n.objective}`, { skills, language }),
    comments: comments.filter(c => c.nodeKey === n.key),
  }));
  const done = nodes.filter(n => n.status === 'VERIFIED').length;
  const active = nodes.filter(n => !['SUPERSEDED', 'CANCELLED'].includes(n.status));
  return {
    id: graph.id, title: graph.title, objective: graph.objective, status: graph.status,
    progress: { done, total: active.length },
    needsApproval: [...new Map(nodes.flatMap(n => n.needs.filter(x => x.approval)).map(x => [x.kind, x])).values()],
    nodes,
    changes: (graph.replans || []).map(r => ({ at: Number.isFinite(r.created_at) ? new Date(r.created_at * 1000).toISOString() : null, reason: r.reason || null, replaced: r.failed_node_key || null, replacement: r.replacement_node_key || null })),
    comments: comments.filter(c => !c.nodeKey),
  };
}
