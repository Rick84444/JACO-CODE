// Operator-supplied Google AI Studio per-model quota snapshot (2026-10-31).
// NOT a live Google API response, NOT a pricing table, and NOT free-tier proof.
// Google quotas apply per project rather than per API key; daily reset is Pacific midnight.
// TPM means INPUT tokens per minute. 28-day peak usage is deliberately NOT imported.
export const AI_STUDIO_QUOTA_SOURCE = Object.freeze({
  kind: 'operator-ai-studio-snapshot',
  observedAt: '2026-10-31',
  upstream: 'https://aistudio.google.com/usage?tab=rate-limit',
  projectAssociationVerified: false,
  providerUsageIncluded: false,
  notes: 'Only JACO traffic is tracked locally; other clients/project keys are invisible.',
});
export const AI_STUDIO_GEMINI_LIMITS = Object.freeze({
  "gemini-2.5-flash": { label: "Gemini 2.5 Flash", category: "text", rpm: 2000, tpm: 3000000, rpd: 100000 },
  "gemini-2.5-pro-tts": { label: "Gemini 2.5 Pro TTS", category: "audio", rpm: 250, tpm: 25000, rpd: 2500 },
  "gemini-robotics-er-2-preview": { label: "Gemini Robotics ER 2 Preview", category: "other", rpm: 2000, tpm: 3000000, rpd: 100000 },
  "gemini-2.5-flash-lite": { label: "Gemini 2.5 Flash Lite", category: "text", rpm: 10000, tpm: 10000000, rpd: null },
  "antigravity": { label: "Antigravity", category: "agent", rpm: 200, tpm: 300000, rpd: 10000 },
  "deep-research-pro-preview": { label: "Deep Research Pro Preview", category: "agent", rpm: 10, tpm: 10000000, rpd: 14400 },
  "gemini-2-flash": { label: "Gemini 2 Flash", category: "text", rpm: 10000, tpm: 10000000, rpd: null },
  "gemini-2-flash-lite": { label: "Gemini 2 Flash Lite", category: "text", rpm: 20000, tpm: 10000000, rpd: null },
  "computer-use-preview": { label: "Computer Use Preview", category: "other", rpm: 1000, tpm: 5000000, rpd: 50000 },
  "gemini-2.5-flash-preview-image": { label: "Nano Banana (Gemini 2.5 Flash Preview Image)", category: "image", rpm: 2000, tpm: 1500000, rpd: 50000 },
  "gemini-2.5-flash-tts": { label: "Gemini 2.5 Flash TTS", category: "audio", rpm: 1000, tpm: 100000, rpd: 10000 },
  "gemini-2.5-pro": { label: "Gemini 2.5 Pro", category: "text", rpm: 1000, tpm: 5000000, rpd: 50000 },
  "gemini-3-flash": { label: "Gemini 3 Flash", category: "text", rpm: 2000, tpm: 3000000, rpd: 100000 },
  "gemini-3-pro-image": { label: "Nano Banana Pro (Gemini 3 Pro Image)", category: "image", rpm: 500, tpm: 500000, rpd: 15000 },
  "gemini-3.1-pro": { label: "Gemini 3.1 Pro", category: "text", rpm: 1000, tpm: 5000000, rpd: 50000 },
  "gemini-3.1-flash-image": { label: "Nano Banana 2 (Gemini 3.1 Flash Image)", category: "image", rpm: 500, tpm: 1000000, rpd: 10000 },
  "gemini-3.1-flash-lite": { label: "Gemini 3.1 Flash Lite", category: "text", rpm: 10000, tpm: 10000000, rpd: 350000 },
  "gemini-3.1-flash-lite-image": { label: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)", category: "image", rpm: 500, tpm: 500000, rpd: 15000 },
  "gemini-3.1-flash-tts": { label: "Gemini 3.1 Flash TTS", category: "audio", rpm: 1000, tpm: 100000, rpd: 10000 },
  "gemini-3.6-flash": { label: "Gemini 3.6 Flash", category: "text", rpm: 2000, tpm: 3000000, rpd: 100000 },
  "gemini-3.5-flash-lite": { label: "Gemini 3.5 Flash Lite", category: "text", rpm: 10000, tpm: 10000000, rpd: 350000 },
  "gemini-3.5-transcribe": { label: "Gemini 3.5 Transcribe", category: "live", rpm: 1000, tpm: 100000, rpd: 10000 },
  "gemini-3.8-flash": { label: "Gemini 3.8 Flash", category: "text", rpm: 2000, tpm: 3000000, rpd: 100000 },
  "gemini-3.8-flash-lite-tts": { label: "Gemini 3.8 Flash Lite TTS", category: "audio", rpm: 1000, tpm: 100000, rpd: 10000 },
  "gemini-3.8-flash-tts": { label: "Gemini 3.8 Flash TTS", category: "audio", rpm: 1000, tpm: 100000, rpd: 10000 },
  "gemini-4-argon": { label: "Gemini 4 Argon", category: "text", rpm: 2000, tpm: 8000000, rpd: null },
  "gemini-embedding-1": { label: "Gemini Embedding 1", category: "embedding", rpm: 5000, tpm: 5000000, rpd: null },
  "gemini-embedding-2": { label: "Gemini Embedding 2", category: "embedding", rpm: 5000, tpm: 5000000, rpd: null },
  "gemini-nano-banana-2.1": { label: "Gemini Nano Banana 2.1", category: "image", rpm: 500, tpm: 1000000, rpd: 10000 },
  "gemini-omni-1.1-flash": { label: "Gemini Omni 1.1 Flash", category: "multimodal", rpm: 8, tpm: null, rpd: 100 },
  "gemma-4-26b": { label: "Gemma 4 26B", category: "other", rpm: 30, tpm: 16000, rpd: 14400 },
  "gemma-4-31b": { label: "Gemma 4 31B", category: "other", rpm: 30, tpm: 16000, rpd: 14400 },
  "lyria-3-clip": { label: "Lyria 3 Clip", category: "audio", rpm: 500, tpm: 10000000, rpd: 10000 },
  "lyria-3-pro": { label: "Lyria 3 Pro", category: "audio", rpm: 500, tpm: 10000000, rpd: 10000 },
  "veo-3-fast-generate": { label: "Veo 3 Fast Generate", category: "video", rpm: 4, tpm: null, rpd: 50 },
  "veo-3-generate": { label: "Veo 3 Generate", category: "video", rpm: 4, tpm: null, rpd: 50 },
  "veo-3-lite-generate": { label: "Veo 3 Lite Generate", category: "video", rpm: 4, tpm: null, rpd: 50 },
  "gemini-2.5-flash-native-audio-dialog": { label: "Gemini 2.5 Flash Native Audio Dialog", category: "live", rpm: null, tpm: 10000000, rpd: null },
  "gemini-3-flash-live": { label: "Gemini 3 Flash Live", category: "live", rpm: null, tpm: 400000, rpd: null },
  "gemini-3.5-live-translate": { label: "Gemini 3.5 Live Translate", category: "live", rpm: null, tpm: 300000, rpd: null },
  "gemini-3.5-transcribe-live": { label: "Gemini 3.5 Transcribe Live", category: "live", rpm: null, tpm: 300000, rpd: null },
  "gemini-3.8-live": { label: "Gemini 3.8 Live", category: "live", rpm: null, tpm: 400000, rpd: null },
  "gemini-3.8-live-extended-thinking": { label: "Gemini 3.8 Live Extended Thinking", category: "live", rpm: null, tpm: 600000, rpd: null },
});

// Known API naming aliases. Never collapse TTS, image and text variants into each other.
const API_ALIASES = Object.freeze({
  'gemini-2.0-flash': 'gemini-2-flash',
  'gemini-2.0-flash-lite': 'gemini-2-flash-lite',
  'gemini-3-flash-preview': 'gemini-3-flash',
  'gemini-3.1-pro-preview': 'gemini-3.1-pro',
});
export function normalizedGeminiModel(model) {
  const id = String(model || '').toLowerCase().trim().replace(/^models\//, '');
  return API_ALIASES[id] || id;
}

// A single canonical quota namespace must be shared by AI Studio imports and runtime
// dispatch. Refuse aliases that collide in one import rather than allowing property
// insertion order to silently override the more restrictive quota.
export function canonicalGeminiQuotaModels(models) {
  if (!models || typeof models !== 'object' || Array.isArray(models))
    throw new Error('GEMINI_QUOTA_PROFILE_INVALID');
  const canonical = Object.create(null);
  for (const [inputId, limits] of Object.entries(models)) {
    const id = normalizedGeminiModel(inputId);
    if (Object.hasOwn(canonical, id)) throw new Error('GEMINI_QUOTA_MODEL_ALIAS_CONFLICT:' + id);
    canonical[id] = limits;
  }
  return canonical;
}

export function pacificQuotaDay(at = Date.now()) {
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(at));
  const value = Object.fromEntries(fields.map(part => [part.type, part.value]));
  return [value.year, value.month, value.day].join('-');
}

const safePositive = n => Number.isSafeInteger(n) && n > 0;
export function validGeminiQuotaProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !profile.models ||
      typeof profile.models !== 'object' || Array.isArray(profile.models)) return false;
  const list = Object.entries(profile.models);
  if (!list.length || list.length > 100) return false;
  if (typeof profile.source !== 'string' || profile.source.length < 2 || profile.source.length > 100) return false;
  if (typeof profile.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(profile.observedAt) ||
      !Number.isFinite(Date.parse(profile.observedAt))) return false;
  return list.every(([model, q]) =>
    /^[a-z0-9][a-z0-9._/+:-]{1,127}$/.test(model) && q && typeof q === 'object' && !Array.isArray(q) &&
    ['rpm', 'tpm', 'rpd'].every(key => q[key] === null || safePositive(q[key])) &&
    ['rpm', 'tpm', 'rpd'].some(key => q[key] != null) &&
    (!('label' in q) || typeof q.label === 'string' && q.label.length <= 120) &&
    (!('category' in q) || typeof q.category === 'string' && q.category.length <= 50));
}

export function defaultGeminiQuotaProfile() {
  return {
    schema: 'jaco.aura-gemini-quota-profile/v1',
    source: AI_STUDIO_QUOTA_SOURCE.kind,
    observedAt: AI_STUDIO_QUOTA_SOURCE.observedAt,
    projectAssociationVerified: false,
    // One JACO runtime project namespace. Multiple Gemini API keys may share a project.
    // No project number was provided; quota profile is still operator-supplied, not verified.
    projectScope: 'operator-supplied-project',
    models: structuredClone(AI_STUDIO_GEMINI_LIMITS),
  };
}

function currentState(state, at) {
  if (!state.geminiQuota || typeof state.geminiQuota !== 'object')
    state.geminiQuota = { schema: 'jaco.aura-gemini-quota-usage/v1', minutes: [], days: {}, cooldowns: {} };
  const q = state.geminiQuota;
  if (!Array.isArray(q.minutes)) q.minutes = [];
  if (!q.days || typeof q.days !== 'object') q.days = {};
  if (!q.cooldowns || typeof q.cooldowns !== 'object') q.cooldowns = {};
  // Keep only a rolling 60-second window. Never reset the counters across restart.
  q.minutes = q.minutes.filter(e => e && Number.isFinite(e.at) && at - e.at < 60000 && e.at <= at);
  const today = pacificQuotaDay(at);
  for (const day of Object.keys(q.days)) if (day !== today) delete q.days[day];
  if (!q.days[today]) q.days[today] = {};
  for (const [model, until] of Object.entries(q.cooldowns))
    if (!Number.isFinite(until) || until <= at) delete q.cooldowns[model];
  return q;
}

export function inspectGeminiQuota(state, profile, { model, inputTokenBudget, at = Date.now() } = {}) {
  const id = normalizedGeminiModel(model);
  const limits = profile?.models?.[id];
  if (!limits) return { allowed: false, reason: 'GEMINI_QUOTA_MODEL_UNCONFIGURED', model: id };
  if (!safePositive(inputTokenBudget))
    return { allowed: false, reason: 'GEMINI_QUOTA_INPUT_REQUIRED', model: id };
  const q = currentState(state, at);
  const minute = q.minutes.filter(e => e.model === id);
  const usedRpm = minute.length;
  const usedTpm = minute.reduce((n, e) => n + e.inputTokens, 0);
  const usedRpd = q.days[pacificQuotaDay(at)][id] || 0;
  const cooldownUntil = q.cooldowns[id] || null;
  if (cooldownUntil && cooldownUntil > at)
    return { allowed: false, reason: 'GEMINI_PROVIDER_BACKOFF', model: id, retryAfterMs: cooldownUntil - at };
  // Conservative local throttling below project quota; other apps using the same project are invisible.
  const cap = n => n == null ? null : Math.max(1, Math.floor(n * 0.9));
  const rpmCap = cap(limits.rpm), tpmCap = cap(limits.tpm), rpdCap = cap(limits.rpd);
  if (rpmCap != null && usedRpm + 1 > rpmCap)
    return { allowed: false, reason: 'GEMINI_PROJECT_RPM_LIMIT', model: id, limit: limits.rpm };
  if (tpmCap != null && usedTpm + inputTokenBudget > tpmCap)
    return { allowed: false, reason: 'GEMINI_PROJECT_TPM_LIMIT', model: id, limit: limits.tpm };
  if (rpdCap != null && usedRpd + 1 > rpdCap)
    return { allowed: false, reason: 'GEMINI_PROJECT_RPD_LIMIT', model: id, limit: limits.rpd };
  return { allowed: true, model: id, usedRpm, usedTpm, usedRpd, inputTokenBudget };
}

// Reserve one request once before provider dispatch. A failed HTTP request may count
// against Google's RPM/RPD; therefore release of monetary reservation does not refund quota.
export function recordGeminiQuotaReservation(state, checked, reservationId, at = Date.now()) {
  if (!checked?.allowed || !reservationId) throw new Error('GEMINI_QUOTA_RESERVATION_INVALID');
  const q = currentState(state, at);
  q.minutes.push({ model: checked.model, at, inputTokens: checked.inputTokenBudget, reservationId });
  const day = pacificQuotaDay(at);
  q.days[day][checked.model] = (q.days[day][checked.model] || 0) + 1;
}

export function reconcileGeminiQuotaUsage(state, reservationId, actualInputTokens, at = Date.now()) {
  if (!Number.isSafeInteger(actualInputTokens) || actualInputTokens < 0) return;
  const q = currentState(state, at);
  const entry = q.minutes.find(e => e.reservationId === reservationId);
  // Conservatively keep the larger of recorded budget and actual use if outside expected bounds.
  if (entry) entry.inputTokens = Math.min(entry.inputTokens, actualInputTokens);
}

export function markGeminiQuotaBackoff(state, model, { at = Date.now(), retryAfterMs = 60000 } = {}) {
  const q = currentState(state, at);
  const id = normalizedGeminiModel(model);
  const delay = Number.isFinite(retryAfterMs) ? Math.max(60000, Math.min(retryAfterMs, 3600000)) : 60000;
  q.cooldowns[id] = Math.max(q.cooldowns[id] || 0, at + delay);
}

// This shows only JACO-observed traffic, not AI Studio's global current project usage.
export function geminiQuotaSnapshot(state, profile, at = Date.now()) {
  const q = currentState(state, at);
  const day = pacificQuotaDay(at);
  return {
    schema: 'jaco.aura-gemini-quota-snapshot/v1',
    source: profile.source,
    observedAt: profile.observedAt,
    projectScope: profile.projectScope || 'operator-supplied-project',
    projectAssociationVerified: profile.projectAssociationVerified === true,
    providerUsageIncluded: false,
    localOnly: true,
    pacificDay: day,
    models: Object.fromEntries(Object.entries(profile.models).map(([model, limits]) => {
      const minute = q.minutes.filter(e => e.model === model);
      return [model, {
        ...limits, model,
        usedRpm: minute.length,
        usedTpm: minute.reduce((n, e) => n + e.inputTokens, 0),
        usedRpd: q.days[day][model] || 0,
        cooldownUntil: q.cooldowns[model] || null,
      }];
    })),
  };
}
