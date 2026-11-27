// Coalesce concurrent read-only observations. Invalidation prevents an older
// observation from repopulating the cache after configuration changes.
// With staleMs, an observation that expired less than that long ago is answered at once and refreshed behind the
// answer, so a poller never waits for a slow probe. The value is a real earlier observation, at most staleMs old.
export function sharedObservation(read, { ttlMs = 2500, staleMs = 0, now = Date.now } = {}) {
  let cached, expires = 0, pending = null, generation = 0;
  const refresh = () => {
    if (pending) return pending;
    const version = generation;
    const request = Promise.resolve().then(read).then(value => {
      if (version === generation) { cached = value; expires = now() + ttlMs; }
      return value;
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  };
  const get = () => {
    if (cached !== undefined) {
      const age = now() - expires;
      if (age < 0) return Promise.resolve(cached);
      if (age < staleMs) {
        // A failed refresh keeps the last observation until it is too old; then the failure reaches the caller.
        refresh().catch(() => {});
        return Promise.resolve(cached);
      }
    }
    return refresh();
  };
  get.invalidate = () => { generation++; cached = undefined; expires = 0; pending = null; };
  return get;
}
