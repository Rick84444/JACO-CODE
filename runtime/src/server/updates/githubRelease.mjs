// Read-only, bounded update discovery. A Git commit on main is not a published release.
// Do not fetch, execute or install binaries from a model or an unverified response.
const REPO = 'Rick84444/JACO-CODE';
const LATEST_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest';

export function releaseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

export function compareReleaseVersions(a, b) {
  const left = releaseVersion(a), right = releaseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export function verifiedWindowsAsset(release, tag) {
  const name = `JACO-Setup-${tag.slice(1)}-win-x64.exe`;
  const asset = Array.isArray(release?.assets) ? release.assets.find(item => item?.name === name) : null;
  if (!asset || asset.state !== 'uploaded') return null;
  try {
    const url = new URL(String(asset.browser_download_url || ''));
    if (url.origin !== 'https://github.com' || url.pathname !== `/${REPO}/releases/download/${tag}/${name}`) return null;
    return { name, url: url.href, size: Number(asset.size) || 0, sha256: /^sha256:[a-f0-9]{64}$/i.test(String(asset.digest || '')) ? String(asset.digest).slice(7).toLowerCase() : null };
  } catch { return null; }
}

export async function githubWindowsReleaseStatus({ currentVersion = '', platform = process.platform, installed = false, fetchImpl = fetch } = {}) {
  const base = { success: true, installed, platform, currentVersion: String(currentVersion || ''), source: LATEST_URL };
  if (platform !== 'win32') return { ...base, status: 'unsupported' };
  try {
    const response = await fetchImpl(LATEST_URL, {
      headers: { 'User-Agent': 'JACO-Windows-Release-Checker', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 404) return { ...base, status: 'unpublished' };
    if (!response.ok) return { ...base, success: false, status: 'unreachable' };
    const release = await response.json();
    const tag = String(release?.tag_name || '');
    if (release?.draft || release?.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag)) return { ...base, success: false, status: 'invalid_release' };
    const comparison = compareReleaseVersions(tag, currentVersion);
    if (comparison === null) return { ...base, success: false, status: 'invalid_version' };
    const asset = verifiedWindowsAsset(release, tag);
    const releaseUrl = `https://github.com/${REPO}/releases/tag/${tag}`;
    if (comparison <= 0) return { ...base, status: 'current', latestVersion: tag.slice(1), releaseUrl };
    if (!asset) return { ...base, status: 'installer_missing', latestVersion: tag.slice(1), releaseUrl };
    return { ...base, status: 'available', latestVersion: tag.slice(1), releaseUrl, installer: asset };
  } catch {
    return { ...base, success: false, status: 'unreachable' };
  }
}
