// JACO Lite chat router: no SEER process is bundled with Lite.
// Discover model IDs from the actual /models response; never confuse a
// provider catalog entry or a saved default with a working model.
const isLoopback = baseUrl => {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname); }
  catch { return false; }
};

const safeReason = error => String(error?.message || error || 'UNKNOWN')
  .replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/g, '$1…')
  .replace(/(Bearer\s+)[^\s]+/gi, '$1[redacted]')
  .replace(/\s+/g, ' ').slice(0, 180);

const validReply = value => typeof value?.reply === 'string' && value.reply.trim().length > 0;

export async function discoverLiteLocalCandidates(providers, { maxProviders = 12, maxCandidates = 4 } = {}) {
  const all = providers.list()
    .filter(p => isLoopback(p.baseUrl))
    .sort((a,b) => {
      const ranks = ['litert','llamacpp','ollama','lmstudio'];
      const rank = p => { const i = ranks.indexOf(p.id); return i >= 0 ? i : ranks.length; };
      return rank(a)-rank(b);
    })
    .slice(0, maxProviders);
  const found = await Promise.all(all.map(async p => {
    try {
      const result = await providers.probe(p.id);
      if (!result.ok) return { id: p.id, models: [], error: 'UNREACHABLE' + (result.status ? '_HTTP_' + result.status : '') + (result.error ? ': ' + safeReason(result.error) : '') };
      const models = [...new Set((result.models || []).filter(m =>
        typeof m === 'string' && m.trim() && !/embed|rerank|whisper|tts|image|moderation/i.test(m)))];
      if (!models.length) return { id: p.id, models: [], error: 'NO_CHAT_MODELS_IMPORTED' };
      const ordered = p.defaultModel && models.includes(p.defaultModel)
        ? [p.defaultModel, ...models.filter(m => m !== p.defaultModel)] : models;
      return { id: p.id, models: ordered, error: null };
    } catch (error) { return { id: p.id, models: [], error: safeReason(error) }; }
  }));
  return {
    candidates: found.flatMap(entry => entry.models.map(model => ({providerId:entry.id,model}))).slice(0,maxCandidates),
    observations: found.map(entry => ({ provider: entry.id, models: entry.models.length, error: entry.error })),
  };
}

// Attempts preserve explicit operator choice, then local-first discovery, then
// an optional authorized cloud fallback. A bad chosen cloud cannot prevent a
// healthy LiteRT model from answering. No SEER request occurs on this path.
export async function liteChatAnswer({ providers, choice = null, ask, cloudChoice = () => null, onFallback = (_fallback) => {} }) {
  const failures = [];
  const attempted = new Set();
  const local = await discoverLiteLocalCandidates(providers);
  const cloud = cloudChoice();
  const candidates = [
    ...(choice ? [choice] : []),
    ...local.candidates,
    ...(cloud ? [cloud] : []),
  ];
  for (const candidate of candidates) {
    const id = String(candidate?.providerId || '').trim();
    const model = String(candidate?.model || '').trim();
    if (!id || !model || id === 'seer') continue;
    const key = id + '/' + model;
    if (attempted.has(key)) continue;
    attempted.add(key);
    try {
      const answer = await ask({ providerId:id, model });
      if (!validReply(answer)) throw new Error('AURA_EMPTY_REPLY');
      if (failures.length) {
        onFallback({ failures:[...failures], provider:id, model });
        return { ...answer, fallback: { from: failures[0].split(': ')[0], reason:failures[0].split(': ').slice(1).join(': ') } };
      }
      return answer;
    } catch (error) { failures.push(`${key}: ${safeReason(error)}`); }
  }
  if (failures.length === 0) failures.push('LITE_NO_AVAILABLE_MODELS: Ingen registrerad lokal modell eller tillåten molnleverantör kunde väljas');
  for (const observation of local.observations.filter(o => o.error))
    failures.push(`${observation.provider}: ${observation.error}`);
  return { degraded: true, failures, candidateCount:attempted.size };
}
