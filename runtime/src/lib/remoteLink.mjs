// The remote client is the same JACO runtime, not a second cloud agent.
// Only the configured HTTPS IDE login may be used as a pairing destination.
export function remoteLoginUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/ide-login') return null;
    url.searchParams.set('next', 'remote');
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
