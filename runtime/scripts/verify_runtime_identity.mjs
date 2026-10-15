import fs from 'node:fs';

const release = JSON.parse(fs.readFileSync(new URL('../CURRENT_RELEASE.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT || release.primaryPort || 3000);
const host = process.env.JACO_RUNTIME_HOST || '127.0.0.1';
const base = `http://${host}:${port}`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 2500);
try {
  const response = await fetch(`${base}/api/runtime/identity`, { signal: controller.signal });
  if (!response.ok) throw new Error(`identity endpoint returned HTTP ${response.status}`);
  const payload = await response.json();
  const identity = payload.identity || payload;
  const checks = [
    ['releaseId', identity.releaseId === release.releaseId, identity.releaseId],
    ['canonicalGui', identity.canonicalGui === release.canonicalGui, identity.canonicalGui],
    ['primaryPort', Number(identity.primaryPort) === port, identity.primaryPort],
    ['seerLiveWorkstream', identity.seerLiveWorkstream === true, identity.seerLiveWorkstream],
    // Surfaces are reported truthfully (Android only with a configured Native Engine), so the check is
    // that the list is non-empty and names only known surfaces, not that a fixed set is claimed.
    ['truthfulSurfaces', Array.isArray(identity.surfaces) && identity.surfaces.length > 0 && identity.surfaces.every(s => ['ANDROID', 'WINDOWS_UI_AUTOMATION', 'BROWSER_CDP'].includes(s)), identity.surfaces],
  ];
  for (const [name, passed, observed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} runtime.${name} [${JSON.stringify(observed)}]`);
  const failed = checks.filter(([, passed]) => !passed);
  console.log(`runtime-identity: ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length}) @ ${base}`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error(`runtime-identity: FAIL @ ${base}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally { clearTimeout(timer); }
