// The view of one Nova mission that the live build view streams (GET /api/aura/missions/:id/stream):
// each step as it lands, what Nova is doing right now, and its answer. Bounded so a long mission or a
// large tool result never turns one event into megabytes.
const TEXT_FIELDS = ['diff', 'stdout', 'text', 'content', 'output', 'stderr'];
const MAX_TEXT = 4000;
const MAX_STEPS = 40;

const clip = (value, max = MAX_TEXT) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
};

// The first readable text of a tool result: a diff, command output or fetched text.
export function resultText(result) {
  if (result == null) return null;
  if (typeof result === 'string') return clip(result);
  if (typeof result !== 'object') return clip(result);
  for (const key of TEXT_FIELDS) if (typeof result[key] === 'string' && result[key].trim()) return clip(result[key]);
  const content = Array.isArray(result.content) ? result.content.find(c => typeof c?.text === 'string') : null;
  if (content) return clip(content.text);
  if (result.result != null && result.result !== result) return resultText(result.result);
  return null;
}

export function liveMissionView(mission, answer = null) {
  const receipts = Array.isArray(mission?.receipts) ? mission.receipts : [];
  const offset = Math.max(0, receipts.length - MAX_STEPS);
  return {
    id: mission.id,
    goal: clip(mission.goal, 2000),
    status: mission.status,
    phase: mission.phase || null,
    updatedAt: mission.updatedAt || null,
    activeTask: mission.activeTask ? { type: mission.activeTask.type, data: mission.activeTask.data || {} } : null,
    steps: receipts.slice(offset).map((r, i) => ({
      n: offset + i + 1,
      type: r.type,
      input: r.input || {},
      ok: r.ok === true,
      verified: r.verified === true,
      error: r.error ? clip(r.error, 500) : null,
      at: r.at || null,
      text: resultText(r.result),
      url: typeof r.result?.url === 'string' && /^https?:\/\//.test(r.result.url) ? r.result.url : null,
    })),
    answer: answer ? clip(answer) : null,
  };
}
