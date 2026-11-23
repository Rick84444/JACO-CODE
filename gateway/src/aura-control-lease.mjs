import { randomUUID } from 'node:crypto';

// A short-lived, in-memory owner lease fences Core from SEER's fallback timer.
// Never expose lease tokens through /health, traces or the Gameboard. All
// mutations still run in the original durable graph/mission stores.
export function createAuraControlLease({ now = () => Date.now(), ttlMs = 20_000 } = {}) {
  let lease = null;
  const valid = () => Boolean(lease && now() < lease.expiresAt);
  const state = () => ({
    owner: valid() ? 'aura-core' : 'aura-fallback',
    externalActive: valid(),
    expiresAt: valid() ? new Date(lease.expiresAt).toISOString() : null,
  });
  function claim() {
    if (valid()) throw new Error('AURA_CONTROL_LEASE_HELD');
    lease = { token: randomUUID(), expiresAt: now() + ttlMs };
    return { token: lease.token, owner: 'aura-core', expiresAt: new Date(lease.expiresAt).toISOString() };
  }
  function renew(token) {
    if (!valid() || typeof token !== 'string' || token !== lease.token) {
      throw new Error('AURA_CONTROL_LEASE_INVALID');
    }
    lease.expiresAt = now() + ttlMs;
    return state();
  }
  function release(token) {
    if (!valid() || typeof token !== 'string' || token !== lease.token) {
      throw new Error('AURA_CONTROL_LEASE_INVALID');
    }
    lease = null;
    return state();
  }
  return { claim, renew, release, state, externallyOwned: valid };
}
