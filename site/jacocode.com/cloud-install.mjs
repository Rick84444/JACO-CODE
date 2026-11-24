// Public, read-only installation planning for JACO Cloud. This endpoint cannot
// install software, grant authority, or execute on a customer's device.
const HOME = 'https://jacocode.com';
const PLATFORMS = Object.freeze({
  windows: { artifact: 'windows', installer: '/install.ps1', environment: 'Windows PowerShell' },
  linux: { artifact: 'universal', installer: '/install.sh', environment: 'Linux shell' },
  macos: { artifact: 'universal', installer: '/install.sh', environment: 'macOS shell' },
  'android-chat': { artifact: null, installer: null, environment: 'ChatGPT Android app' },
});
const SHA = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const FILE = /^jaco-lite(?:-windows|-android)?\.zip$/;
const reply = (body, status = 200) => Response.json(body, {
  status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
const error = (reason, status) => reply({ schema: 'jaco.cloud-install-plan/v1', status: 'UNAVAILABLE', error: reason }, status);

export function releasePlan(manifest, platform) {
  const selected = PLATFORMS[platform];
  if (!selected || !selected.artifact) throw Error('PLATFORM_INVALID');
  if (!manifest || manifest.schema !== 'jaco.lite-latest/v1' || !VERSION.test(String(manifest.version))) {
    throw Error('RELEASE_MANIFEST_INVALID');
  }
  const entry = manifest.files?.[selected.artifact];
  if (!entry || !FILE.test(String(entry.file)) || !SHA.test(String(entry.sha256)) ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 1024) {
    throw Error('RELEASE_ARTIFACT_INVALID');
  }
  if (entry.file !== (selected.artifact === 'windows' ? 'jaco-lite-windows.zip' : 'jaco-lite.zip')) {
    throw Error('RELEASE_ARTIFACT_MISMATCH');
  }
  return {
    schema: 'jaco.cloud-install-plan/v1', status: 'PLAN_AVAILABLE',
    product: 'JACO Lite', agent: 'Aura', agentCount: 1,
    platform, environment: selected.environment,
    version: manifest.version,
    sourceCommit: /^[0-9a-f]{40}$/.test(String(manifest.sourceCommit)) ? manifest.sourceCommit : null,
    artifact: {
      url: HOME + '/download/' + entry.file, bytes: entry.bytes,
      sha256: entry.sha256, checksumAlgorithm: 'SHA-256',
    },
    installer: { url: HOME + selected.installer, verifiesArchiveChecksum: true },
    operatorAction: 'REQUIRED', execution: 'NOT_STARTED',
    chatgptConnection: 'NOT_ESTABLISHED',
    note: 'This installs JACO Lite only; full Aura Runtime and ChatGPT Control require separate acceptance.',
  };
}

export async function handleCloudInstall(request, env, url) {
  if (url.pathname !== '/cloud/v1/install-plan') return null;
  if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405);
  if ([...url.searchParams.keys()].some(k => !['platform', 'profile'].includes(k))) return error('UNSUPPORTED_PARAMETER', 400);
  const platform = url.searchParams.get('platform') || 'windows';
  if (!Object.hasOwn(PLATFORMS, platform)) return error('PLATFORM_INVALID', 400);
  const profile = url.searchParams.get('profile') || 'lite';
  if (profile !== 'lite' && profile !== 'full') return error('PROFILE_INVALID', 400);
  if (platform === 'android-chat') {
    return reply({
      schema: 'jaco.cloud-install-plan/v1', status: 'CLIENT_ONLY',
      platform, product: 'JACO Control', agent: 'Aura', agentCount: 1,
      localRuntimeRequired: false, installation: 'NO_ANDROID_RUNTIME',
      nextStep: 'Connect a published OAuth JACO Control plugin to an already paired Aura host.',
      chatgptConnection: 'NOT_ESTABLISHED', execution: 'NOT_STARTED',
    });
  }
  // Do not advertise Lite as a full Aura installation.
  if (profile === 'full') return error('FULL_RUNTIME_RELEASE_NOT_PUBLISHED', 409);
  if (!env?.ASSETS?.fetch) return error('RELEASE_ASSETS_UNAVAILABLE', 503);
  try {
    const result = await env.ASSETS.fetch(new Request(HOME + '/download/latest.json'));
    if (!result.ok) return error('RELEASE_MANIFEST_UNAVAILABLE', 503);
    const raw = await result.text();
    if (raw.length > 16_384) return error('RELEASE_MANIFEST_INVALID', 503);
    return reply(releasePlan(JSON.parse(raw), platform));
  } catch {
    // A partial download, bad JSON or unverified release is not an install plan.
    return error('RELEASE_MANIFEST_UNVERIFIED', 503);
  }
}
