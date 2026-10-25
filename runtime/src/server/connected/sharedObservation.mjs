// Coalesce concurrent read-only observations. Invalidation prevents an older
// observation from repopulating the cache after configuration changes.
export function sharedObservation(read, { ttlMs = 2500, now = Date.now } = {}) {
  let cached, expires = 0, pending = null, generation = 0;
  const get = () => {
    if (cached !== undefined && now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    const version = generation;
    const request = Promise.resolve().then(read).then(value => {
      if (version === generation) { cached = value; expires = now() + ttlMs; }
      return value;
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  };
  get.invalidate = () => { generation++; cached = undefined; expires = 0; pending = null; };
  return get;
}
