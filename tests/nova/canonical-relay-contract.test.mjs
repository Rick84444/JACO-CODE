import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGithubBootstrapControl } from '../../runtime/gateway/src/github-bootstrap-control.mjs';
import { configuration, definitions } from '../../agents/lib/local-stack.mjs';
import os from 'node:os';
import path from 'node:path';

const read = name => fs.readFileSync(name, 'utf8');

test('canonical customer transport remains JACO Link, not a second ChatGPT server', () => {
  assert.match(read('site/jacocode.com/link.mjs'), /verifySiteSession/);
  assert.match(read('runtime/src/server/connected/jacoLinkHost.mjs'), /createJacoLinkHost/);
  assert.match(read('site/jacocode.com/link-protocol.mjs'), /validateRemoteCall/);
  assert.match(read('AGENTS.md'), /Search before creating|Mandatory deduplication gate/);
});

test('a fresh Termux installation does not configure developer GitHub control', () => {
  const installer=read('runtime/termux/install-activation.sh');
  assert.match(installer, /ensure_export JACO_GITHUB_BOOTSTRAP_ENABLE "0"/);
  assert.doesNotMatch(installer, /^ensure_export JACO_GITHUB_BOOTSTRAP_REPO /m);
  assert.doesNotMatch(installer, /^ensure_export JACO_GITHUB_BOOTSTRAP_ACTOR /m);
});

test('Windows Sentinel does not force GitHub bootstrap on while started locally', () => {
  const sentinel=read('runtime/bin/sentinel-windows.mjs');
  assert.doesNotMatch(sentinel,/JACO_GITHUB_BOOTSTRAP_ENABLE:\s*'1'/);
  assert.match(sentinel,/JACO_GITHUB_BOOTSTRAP_ENABLE:\s*process\.env\.JACO_GITHUB_BOOTSTRAP_ENABLE\s*\|\|\s*'0'/);
});

test('legacy Git bootstrap refuses to assume an operator identity', async () => {
  let called=false;
  const control = createGithubBootstrapControl({
    enabled:true, repo:'', actor:'', token:'',
    system:{status:async()=>{called=true;throw Error('unexpected');}},
    fetchImpl:async()=>{called=true;throw Error('unexpected fetch');},
  });
  assert.equal(control.enabled,false);
  assert.deepEqual((await control.pollOnce()).processed,[]);
  assert.equal(called,false);
  const config=read('runtime/gateway/src/config.mjs');
  assert.doesNotMatch(config,/githubBootstrapRepo:[^\n]+Rick84444/);
  assert.doesNotMatch(config,/githubBootstrapActor:[^\n]+Rick84444/);
});

test('CDP cannot launch a redundant ChatGPT gateway', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-relay-gate-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'server.ts'),"app.get('/api/runtime/identity',()=>{});");
  fs.writeFileSync(path.join(root,'package.json'),'{"version":"test"}');
  const c=configuration(root,{JACO_ENABLE_CDP:'1'});
  assert.equal(c.cdp,true);
  assert.equal(c.gateway,false);
  assert.equal(definitions(c).some(s=>s.id==='gateway'),false);
  const explicit=configuration(root,{JACO_ENABLE_CDP:'1',JACO_ENABLE_CHATGPT_GATEWAY:'1'});
  assert.equal(explicit.gateway,true,'intentional compatibility flag still works until migration');
});

test('legacy Git ChatGPT messages have no built-in developer GitHub repo', () => {
  const source=read('gateway/src/workplace/chatgpt-github-relay.mjs');
  assert.doesNotMatch(source,/const repo=[^\n]+Rick84444/);
  assert.match(source,/const selectedTransport=env\.JACO_CHATGPT_WORKPLACE_TRANSPORT\|\|'off'/);
});
