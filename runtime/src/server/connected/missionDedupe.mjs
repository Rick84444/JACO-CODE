// Near-duplicate detection for durable missions.
// Measured 2026-09-25: of 69 open missions, most were re-phrasings of a few goals ("Skapa/Generera
// en strukturerad rapport inventory_report.md ..."), created again by chat or SEER each turn. Each
// duplicate competes for the same executor and burns model calls. A new goal that matches an
// open mission for the same executor returns that mission instead.

const STOP = new Set(['en', 'ett', 'och', 'att', 'som', 'för', 'med', 'i', 'på', 'av', 'till', 'the', 'a', 'an', 'and', 'to', 'of', 'for', 'in', 'on', 'with', 'is', 'är', 'det', 'den', 'de']);
// Verbs that only change the phrasing of the same instruction.
const SYNONYMS = new Map([['generera', 'skapa'], ['create', 'skapa'], ['generate', 'skapa'], ['make', 'skapa'], ['gör', 'skapa'], ['write', 'skriv'], ['utför', 'kör'], ['run', 'kör'], ['execute', 'kör']]);

export function goalTokens(goal) {
  const words = String(goal || '').toLowerCase()
    .replace(/mission-\d{10,}-[0-9a-f]+/g, ' ')
    .replace(/[^\p{L}\p{N}_.\-/]+/gu, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !STOP.has(word))
    .map(word => SYNONYMS.get(word) || word)
    .slice(0, 80);
  return new Set(words);
}

export function goalSimilarity(a, b) {
  const x = goalTokens(a);
  const y = goalTokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  return shared / (x.size + y.size - shared);
}

export function dedupeThreshold(env = process.env) {
  const value = Number(env.JACO_MISSION_DEDUPE_THRESHOLD ?? 0.8);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0;
}

// open: [{ id, goal, executor }]. Returns the best matching open mission or null.
const skillOf = goal => /^Skill ([a-z][a-z0-9-]{1,60}):/.exec(String(goal || ''))?.[1] || null;
export function findDuplicate(goal, executor, open, threshold = dedupeThreshold()) {
  if (!threshold) return null;
  let best = null;
  for (const mission of open) {
    if ((mission.executor || 'nova') !== executor) continue;
    // Runs of different skills are different work even when the operator's input is the same.
    if (skillOf(goal) !== skillOf(mission.goal)) continue;
    const score = goalSimilarity(goal, mission.goal);
    if (score >= threshold && (!best || score > best.score)) best = { id: mission.id, score };
  }
  return best;
}
