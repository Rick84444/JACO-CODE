// Presentation-only selection over canonical CognitiveLive events.
// This module never runs a tool, grants authority, or treats a read as proof of delivery.
const safeProjectPath = value => typeof value === 'string' && value.length <= 400 &&
  !/^(?:\/|[a-z]:|\\\\)/i.test(value) && !/(^|[\\/])\.\.?([\\/]|$)/.test(value) &&
  !/[\x00-\x1f]/.test(value);

export function auraMaterialKind(event) {
  const evidence = event?.evidence;
  if (!evidence || evidence.outcome !== 'verified' || !safeProjectPath(evidence.path)) return null;
  if (/\.html?$/i.test(evidence.path)) return 'html';
  // Image bytes require a separately authenticated capture/attachment API.
  // A filename is not image proof and is never inserted as an arbitrary URL.
  if (/\.(?:png|jpe?g|webp)$/i.test(evidence.path)) return 'image-reference';
  return null;
}

export function auraStageCandidate(events = []) {
  if (!Array.isArray(events)) return null;
  // Prefer the newest meaningful evidence, not the largest pile of tool reads.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || !event.id || !event.evidence) continue;
    const material = auraMaterialKind(event);
    if (material) return { event, material };
    if (event.category === 'blocked' || event.evidence.outcome === 'failed' ||
        event.evidence.outcome === 'unknown') return { event, material: null };
    if (event.category === 'goal') return { event, material: null };
    if (['result','verification'].includes(event.category) &&
        event.evidence.outcome === 'verified') {
      // Verified test/code/deployment results deserve attention; repetitive
      // repository reads and preflight receipts do not replace visual material.
      const routine = /läser en fil|undersöker projektets filer|jaco_preflight|repo-read|read-file/i.test(event.text || '');
      if (!routine || event.evidence.commit || event.evidence.url) return { event, material: null };
    }
  }
  return null;
}

export function auraStageHistory(events = [], limit = 7) {
  if (!Array.isArray(events)) return [];
  const grouped = new Map();
  for (const event of events.slice(-100)) {
    if (!event?.id || !['action','result','verification','blocked','goal','observation'].includes(event.category)) continue;
    const key = [event.missionId || '',event.category,event.text,event.evidence?.outcome || ''].join('::');
    const previous = grouped.get(key);
    if (previous) grouped.set(key, {event, count: previous.count + 1});
    else grouped.set(key, {event, count: 1});
  }
  return [...grouped.values()].reverse().slice(0, Math.max(1,Math.min(20,limit)));
}

export function stageFileAllowed(path) { return safeProjectPath(path); }
