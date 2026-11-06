// After JACO is rebuilt, a page that was opened earlier still points at the old file names (RevenueView-ABC.js).
// Loading one of them fails with "Failed to fetch dynamically imported module", React drops the whole screen, and
// the operator sees an empty blue page. The fix is to load the new page: once per minute at most, so a real outage
// cannot turn into a reload loop.
const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const KEY = 'jaco:stale-build-reload';

export const isStaleBuildError = (error: unknown): boolean => STALE.test(String((error as any)?.message || error || ''));

export function reloadForNewBuild(now = Date.now(), reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(KEY) || 0);
    if (now - last < 60_000) return false;
    window.sessionStorage.setItem(KEY, String(now));
  } catch { /* without storage a single reload is still better than a blank page */ }
  reload();
  return true;
}
