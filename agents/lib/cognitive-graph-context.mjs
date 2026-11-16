// Bounded, read-only projection of canonical Continuum knowledge into an Aura
// mission's next model turn. This never creates authority, memory or a graph.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const clip = (value, max) => String(value ?? '').slice(0, max);
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'och', 'att', 'som', 'för', 'med', 'det', 'den', 'ska', 'kan', 'ett', 'en', 'jag', 'you', 'have']);

export async function readCognitiveGraphContext(goal, {
  runtimeUrl, token = '', fetchImpl = globalThis.fetch, timeoutMs = 1800,
  maxMatches = 4, maxChars = 1300,
} = {}) {
  if (!runtimeUrl || typeof fetchImpl !== 'function') return null;
  const terms = [...new Set((clip(goal, 1200).toLowerCase().match(/[\p{L}\p{N}_.-]+/gu) || [])
    .filter(term => term.length >= 3 && !STOP.has(term)))].slice(0, 8);
  if (!terms.length) return null;
  try {
    const url = new URL('/api/continuum/cognition/graph/search', runtimeUrl);
    if (!LOOPBACK.has(url.hostname) || url.protocol !== 'http:') return null;
    url.searchParams.set('q', terms.join(' '));
    url.searchParams.set('limit', String(Math.max(1, Math.min(12, Math.trunc(maxMatches) || 4))));
    const headers = token ? { authorization: 'Bearer ' + token } : {};
    const response = await fetchImpl(url, { method: 'GET', headers,
      signal: AbortSignal.timeout(Math.max(100, Math.min(5000, Number(timeoutMs) || 1800))) });
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.success !== true || body.result?.schema !== 'jaco.cognitive-graph.search.v1') return null;
    const source = Array.isArray(body.result.matches) ? body.result.matches : [];
    const matches = source.filter(row => row && (
      (row.node?.type === 'KNOWLEDGE' && row.node.verificationStatus === 'VERIFIED') ||
      (row.node?.type === 'FILE' && row.node.verificationStatus === 'OBSERVED')
    )).slice(0, Math.max(1, Math.min(8, Math.trunc(maxMatches) || 4))).map(row => ({
      id: clip(row.node.id, 180), type: row.node.type,
      label: clip(row.node.label, 160), verification: row.node.verificationStatus,
      score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
    }));
    if (!matches.length) return null;
    const projection = {
      source: 'canonical_continuum_graph', authority: 'read_only_context',
      graphHash: clip(body.result.graphHash, 100) || null,
      repositorySnapshotHash: clip(body.result.repositorySnapshotHash, 100) || null,
      partial: body.result.partial === true,
      matches,
    };
    const budget = Math.max(320, Math.min(2500, Number(maxChars) || 1300));
    while (projection.matches.length && JSON.stringify(projection).length > budget) projection.matches.pop();
    return projection.matches.length ? projection : null;
  } catch {
    // A missing or unhealthy cognitive service must not block an otherwise valid mission.
    return null;
  }
}
