// Pulls verified acquisitions from a2acolony.com's own account API and feeds them into SEER's
// economy ledger (strategy.economy.record) so real sales on that marketplace actually count toward
// capability_performance / decision scoring, instead of being invisible to the governor loop.
// Inert (no-op) until A2ACOLONY_API_KEY is configured — never invents a sale.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function readSyncedIds(statePath) {
  if (!existsSync(statePath)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    return new Set(Array.isArray(raw?.syncedIds) ? raw.syncedIds : []);
  } catch {
    return new Set();
  }
}

function writeSyncedIds(statePath, ids) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ syncedIds: [...ids], updatedAt: new Date().toISOString() }, null, 2));
}

export function createA2AColonyRevenueSync({
  strategy,
  apiKey = process.env.A2ACOLONY_API_KEY || '',
  baseUrl = process.env.A2ACOLONY_BASE_URL || 'https://a2acolony.com',
  statePath,
  fetchImpl = fetch,
  emit = () => {},
} = {}) {
  if (!strategy?.economy?.record) throw new Error('A2ACOLONY_SYNC_REQUIRES_STRATEGY_ECONOMY');
  if (!statePath) throw new Error('A2ACOLONY_SYNC_REQUIRES_STATE_PATH');

  async function syncOnce() {
    if (!apiKey) return { skipped: 'NO_API_KEY' };

    const response = await fetchImpl(`${baseUrl}/api/v1/my/acquisitions`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
    if (!response.ok) {
      const message = `A2ACOLONY_HTTP_${response.status}`;
      emit('a2acolony.sync_error', { error: message });
      throw new Error(message);
    }
    const payload = await response.json();
    const acquisitions = Array.isArray(payload?.acquisitions) ? payload.acquisitions : [];

    const synced = readSyncedIds(statePath);
    const newlyRecorded = [];
    for (const acquisition of acquisitions) {
      const id = String(acquisition?.id || '').trim();
      if (!id || synced.has(id)) continue;
      const revenue = Math.max(0, Number(acquisition?.amount_usd ?? acquisition?.amountUsd ?? 0));
      const outcome = strategy.economy.record({
        decision_id: null,
        revenue,
        cost: 0,
        customer_external: true,
        repeat_customer: Boolean(acquisition?.repeat_customer),
        verified: true,
        metadata: { source: 'a2acolony', acquisition_id: id, skill: acquisition?.skill || acquisition?.product || null },
      });
      synced.add(id);
      newlyRecorded.push({ id, revenue, outcome_id: outcome.id });
    }
    if (newlyRecorded.length) writeSyncedIds(statePath, synced);

    emit('a2acolony.synced', { checked: acquisitions.length, recorded: newlyRecorded.length });
    return { checked: acquisitions.length, recorded: newlyRecorded };
  }

  return { syncOnce };
}
