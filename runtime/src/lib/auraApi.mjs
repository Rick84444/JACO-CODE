export function auraErrorMessage(value, fallback = 'API_UNAVAILABLE') {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const parts = [value.code, value.message].filter(part => typeof part === 'string' && part.trim());
    if (parts.length) return parts.join(': ');
  }
  return fallback;
}

export async function readAuraResponse(response) {
  let data;
  try { data = await response.json(); } catch { throw new Error(`API_INVALID_JSON: HTTP_${response.status}`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('API_INVALID_RESPONSE');
  if (!response.ok || data.success === false) throw new Error(auraErrorMessage(data.error, auraErrorMessage(data.detail, `HTTP_${response.status}`)));
  return data;
}

// A delayed save must not discard edits made after the submitted version.
export function acknowledgeSavedDraft(drafts, saved) {
  if (drafts[saved.path] !== saved.content) return drafts;
  const next = { ...drafts };
  delete next[saved.path];
  return next;
}

export function observedMoney(values) {
  if (!values || typeof values !== 'object') return 'Ej observerat';
  const entries = Object.entries(values);
  if (entries.some(([, amount]) => !Number.isFinite(amount))) return 'Ej observerat';
  return entries.length ? entries.map(([currency, amount]) => `${amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`).join(' · ') : '0';
}
