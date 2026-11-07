// Operator-facing, read-only projection of JACO's *existing local* Continuum knowledge store.
// Do not create a parallel memory database or invent raw model chain-of-thought.
// Only persisted knowledge.created/knowledge.updated events may trigger a "saved" indicator.
import { safeCognitiveText } from '../../lib/cognitiveEvents.mjs';

const ID = /^[a-zA-Z0-9_.-]{1,180}$/;
const WRITE_TYPES = new Set(['knowledge.created', 'knowledge.updated']);
const bounded = (s, max) => safeCognitiveText(String(s || ''), max);
const listOf = (items, max) => (Array.isArray(items) ? items : []).slice(0, max).map(v => bounded(v, 240));

export function localMemoryActivity(runtime, { limit = 20 } = {}) {
  if (!runtime?.knowledge?.get || !runtime?.events?.list) throw new Error('LOCAL_CONTINUUM_MEMORY_UNAVAILABLE');
  const cap = Math.max(1, Math.min(Number(limit) || 20, 50));
  const events = runtime.events.list({ stream: 'knowledge', limit: 500 })
    .filter(e => WRITE_TYPES.has(e.type) && typeof e.entityId === 'string' && ID.test(e.entityId));
  const recent = events.slice(-200).reverse();
  const ids = [...new Set(recent.map(e => e.entityId))].slice(0, cap);
  // When an earlier store was imported without a visible write event, show persisted entries
  // but never animate a save that was not observed in the local event ledger.
  if (!ids.length) {
    for (const obj of runtime.knowledge.list({ limit: cap }).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
      if (ID.test(String(obj.id)) && !ids.includes(obj.id)) ids.push(obj.id);
      if (ids.length >= cap) break;
    }
  }
  const memories = ids.flatMap(id => {
    let item;
    try { item = runtime.knowledge.get(id); } catch { return []; }
    return [{
      id: item.id, kind: bounded(item.kind, 80), title: bounded(item.purpose, 240),
      status: bounded(item.verificationStatus || 'UNVERIFIED', 30),
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
      updatedAt: item.updatedAt || null,
      decisionSummary: bounded(item.reasoningSummary, 2500),
      evidenceRefs: listOf(item.evidenceRefs, 30),
      dependencies: listOf(item.dependencies, 20),
      failureModes: listOf(item.failureModes, 15),
      missionIds: listOf(item.usedIn, 20),
      source: 'jaco.continuum.local-knowledge',
    }];
  });
  const byId = new Map(memories.map(x => [x.id, x]));
  const changes = recent.filter(e => byId.has(e.entityId)).slice(0, 20).map(e => ({
    eventId: e.id, sequence: e.sequence, id: e.entityId, type: e.type,
    at: e.timestamp, title: byId.get(e.entityId).title,
  }));
  return {
    schema: 'jaco.local-memory-activity/v1', source: 'local-continuum',
    entries: memories, changes, latestWriteSequence: changes[0]?.sequence || 0,
    observedAt: new Date().toISOString(),
    explanation: 'Decision summaries and evidence from local persisted knowledge; not hidden model chain-of-thought.',
  };
}
