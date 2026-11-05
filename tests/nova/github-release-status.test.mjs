import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReleaseVersions, githubWindowsReleaseStatus, verifiedWindowsAsset } from '../../runtime/src/server/updates/githubRelease.mjs';

const release = (version = '0.22.1') => ({
  tag_name: 'v' + version,
  draft: false, prerelease: false,
  assets: [{ name: `JACO-Setup-${version}-win-x64.exe`, state: 'uploaded', size: 1000,
    browser_download_url: `https://github.com/Rick84444/JACO-CODE/releases/download/v${version}/JACO-Setup-${version}-win-x64.exe` }]
});
const respond = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });

test('only strictly newer stable semantic releases are actionable', async () => {
  assert.equal(compareReleaseVersions('v0.22.1', '0.22.0'), 1);
  assert.equal(compareReleaseVersions('v0.22.0', '0.22.0'), 0);
  assert.equal(compareReleaseVersions('v0.21.9', '0.22.0'), -1);
  assert.equal(compareReleaseVersions('main', '0.22.0'), null);
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.0', platform: 'win32', installed: true, fetchImpl: respond(release()) })).status, 'available');
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.1', platform: 'win32', fetchImpl: respond(release()) })).status, 'current');
});

test('drafts, prereleases, unsafe assets and missing installer never authorize updates', async () => {
  const draft = { ...release(), draft: true };
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.0', platform: 'win32', fetchImpl: respond(draft) })).status, 'invalid_release');
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.0', platform: 'win32', fetchImpl: respond({ ...release(), prerelease: true }) })).status, 'invalid_release');
  assert.equal(verifiedWindowsAsset({ ...release(), assets: [{ ...release().assets[0], browser_download_url: 'https://evil.example/JACO.exe' }] }, 'v0.22.1'), null);
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.0', platform: 'win32', fetchImpl: respond({ ...release(), assets: [] }) })).status, 'installer_missing');
});

test('API outage or no published release is not a false update notification', async () => {
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.0', platform: 'win32', fetchImpl: respond(null, 404) })).status, 'unpublished');
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.0', platform: 'win32', fetchImpl: async () => { throw Error('offline'); } })).status, 'unreachable');
  assert.equal((await githubWindowsReleaseStatus({ currentVersion: '0.22.0', platform: 'linux', fetchImpl: async () => { throw Error('should not call'); } })).status, 'unsupported');
});
