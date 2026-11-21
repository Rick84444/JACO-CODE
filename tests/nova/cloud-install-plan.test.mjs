import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleCloudInstall, releasePlan } from '../../site/jacocode.com/cloud-install.mjs';

const sha = 'a'.repeat(64);
const manifest = {
  schema: 'jaco.lite-latest/v1', version: '0.21.0',
  sourceCommit: 'b'.repeat(40), builtAt: '2026-11-21T00:00:00Z',
  files: {
    windows: {file: 'jaco-lite-windows.zip', bytes: 200_000, sha256: sha},
    universal: {file: 'jaco-lite.zip', bytes: 300_000, sha256: sha},
  },
};
const request = (query = '?platform=windows', method = 'GET') => {
  const url = new URL('https://jacocode.com/cloud/v1/install-plan' + query);
  return {request: new Request(url, {method}), url};
};
const env = {ASSETS:{fetch:async () => Response.json(manifest)}};
async function plan(query, options = {}) {
  const {request: req, url} = request(query, options.method);
  const response = await handleCloudInstall(req, options.env || env, url);
  return {status: response.status, body: await response.json()};
}

test('JACO Cloud plan uses checksum-pinned release assets without pretending to install', async () => {
  const {status,body} = await plan('?platform=windows');
  assert.equal(status,200);
  assert.equal(body.product,'JACO Lite');
  assert.equal(body.agent,'Aura');
  assert.equal(body.agentCount,1);
  assert.equal(body.artifact.url,'https://jacocode.com/download/jaco-lite-windows.zip');
  assert.equal(body.artifact.sha256,sha);
  assert.equal(body.installer.url,'https://jacocode.com/install.ps1');
  assert.equal(body.execution,'NOT_STARTED');
  assert.equal(body.chatgptConnection,'NOT_ESTABLISHED');
  assert.equal(body.operatorAction,'REQUIRED');
});
test('Linux/macOS reuse the verified universal release; Android ChatGPT needs no local runtime', async () => {
  for (const platform of ['linux','macos']) {
    const {body} = await plan('?platform=' + platform);
    assert.equal(body.artifact.url,'https://jacocode.com/download/jaco-lite.zip');
    assert.equal(body.installer.url,'https://jacocode.com/install.sh');
  }
  const android = await plan('?platform=android-chat');
  assert.equal(android.body.status,'CLIENT_ONLY');
  assert.equal(android.body.localRuntimeRequired,false);
  assert.equal(android.body.chatgptConnection,'NOT_ESTABLISHED');
});
test('rejects a full-runtime claim, unknown platforms, unexpected fields and POST writes', async () => {
  assert.equal((await plan('?platform=windows&profile=full')).body.error,'FULL_RUNTIME_RELEASE_NOT_PUBLISHED');
  assert.equal((await plan('?platform=android')).status,400);
  assert.equal((await plan('?platform=windows&url=https://evil.example')).status,400);
  assert.equal((await plan('?platform=windows',{method:'POST'})).status,405);
});
test('untrusted manifest cannot inject arbitrary download URL, digest or version', () => {
  assert.throws(() => releasePlan({...manifest,version:'latest'},'windows'),/RELEASE_MANIFEST_INVALID/);
  assert.throws(() => releasePlan({...manifest,files:{windows:{file:'../../malware.zip',bytes:300000,sha256:sha}}},'windows'),/RELEASE_ARTIFACT_INVALID/);
  assert.throws(() => releasePlan({...manifest,files:{windows:{file:'jaco-lite.zip',bytes:300000,sha256:sha}}},'windows'),/RELEASE_ARTIFACT_MISMATCH/);
  assert.throws(() => releasePlan({...manifest,files:{windows:{file:'jaco-lite-windows.zip',bytes:300000,sha256:'oops'}}},'windows'),/RELEASE_ARTIFACT_INVALID/);
});
test('no assets or invalid manifest is unavailable and cannot be interpreted as install success',async()=>{
  const missing = await plan('?platform=windows',{env:{}});
  assert.equal(missing.status,503);
  const invalid = await plan('?platform=windows',{env:{ASSETS:{fetch:async()=>Response.json({})}}});
  assert.equal(invalid.status,503);
  assert.equal(invalid.body.status,'UNAVAILABLE');
});
test('existing website worker mounts plan as a read-only route',()=>{
  const worker=fs.readFileSync('site/jacocode.com/worker.mjs','utf8');
  assert.match(worker,/handleCloudInstall/);
  assert.match(worker,/cloud\/v1\/install-plan/);
});
