// Real prepaid balances, read from the provider and cached briefly. Providers without a balance endpoint are not
// listed: nothing here is guessed. Never throws; a failure is reported as a failure, not as zero.
export function createBalanceFetcher({ env = process.env, fetchImpl = fetch, now = Date.now, ttlMs = 30_000 } = {}) {
  let cached = null;
  async function deepseek() {
    const key = env.DEEPSEEK_API_KEY;
    if (!key) return { ok: false, error: 'DEEPSEEK_API_KEY_MISSING' };
    try {
      const response = await fetchImpl('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { ok: false, error: `HTTP_${response.status}` };
      const data = await response.json();
      const info = (data.balance_infos || []).find(i => i.currency === 'USD') || (data.balance_infos || [])[0];
      const usd = Number(info?.total_balance);
      if (!Number.isFinite(usd)) return { ok: false, error: 'BALANCE_UNREADABLE' };
      return { ok: true, usd, currency: info.currency || 'USD', available: data.is_available !== false };
    } catch (error) { return { ok: false, error: String(error?.message || error).slice(0, 120) }; }
  }
  return async function getBalances() {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    const value = { deepseek: { ...(await deepseek()), checkedAt: new Date(now()).toISOString() } };
    cached = { at: now(), value };
    return value;
  };
}
