import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  relayControlPath, readRelayControl, relayEnvironment, writeRelayControl,
} from '../../gateway/src/workplace/chatgpt-relay-control.mjs';
import { relayCli } from '../../agents/jaco-cli.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-relay-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function stream() {
  let value = '';
  return { write(text) { value += text; }, get text() { return value; } };
}
const health = relay => ({
  ok: true, json: async () => ({
    schema: 'jaco.workplace/v1', status: 'READY', chatgptRelay: relay,
  }),
});

test('Git-ref communication stays off by default and requires explicit local operator control', t => {
  const root = fixture(t);
  assert.deepEqual(readRelayControl(root), { configured: false, enabled: false });
  assert.equal(relayEnvironment(root, {}).JACO_CHATGPT_WORKPLACE_TRANSPORT, undefined);
  const enabled = writeRelayControl(root, true);
  assert.equal(enabled.transport, 'git-ref');
  assert.deepEqual(readRelayControl(root), { configured: true, enabled: true });
  const env = relayEnvironment(root, { JACO_CHATGPT_WORKPLACE_TRANSPORT: 'github-issue' });
  assert.equal(env.JACO_CHATGPT_WORKPLACE_TRANSPORT, 'git-ref');
  assert.equal(Object.hasOwn(env, 'JACO_CHATGPT_WORKPLACE_TOKEN'), false);
  const mode = fs.statSync(relayControlPath(root)).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o600);
  writeRelayControl(root, false);
  assert.deepEqual(readRelayControl(root), { configured: true, enabled: false });
  assert.equal(relayEnvironment(root, env).JACO_CHATGPT_WORKPLACE_TRANSPORT, 'off');
});

test('corrupt or symlinked relay operator control fails closed', t => {
  const root = fixture(t);
  const file = relayControlPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"enabled":true}', 'utf8');
  assert.equal(readRelayControl(root).enabled, false);
  assert.equal(relayEnvironment(root, { JACO_CHATGPT_WORKPLACE_TRANSPORT: 'git-ref' }).JACO_CHATGPT_WORKPLACE_TRANSPORT, 'off');
  fs.unlinkSync(file);
  if (process.platform !== 'win32') {
    const other = path.join(root, 'sentinel');
    fs.writeFileSync(other, 'do not overwrite');
    fs.symlinkSync(other, file);
    assert.equal(readRelayControl(root).enabled, false);
    assert.throws(() => writeRelayControl(root, true), /SYMLINK_REFUSED/);
    assert.equal(fs.readFileSync(other, 'utf8'), 'do not overwrite');
  }
});

test('CLI enable and disable only change local ignored config, with no network call', async t => {
  const root = fixture(t);
  const stdout = stream();
  let networkCalls = 0;
  const fetchImpl = async () => { networkCalls++; throw Error('network must not be contacted'); };
  assert.equal(await relayCli(['enable'], { root, out:stdout, fetchImpl }), 0);
  assert.equal(readRelayControl(root).enabled, true);
  assert.equal(await relayCli(['disable'], { root, out:stdout, fetchImpl }), 0);
  assert.equal(readRelayControl(root).enabled, false);
  assert.equal(networkCalls, 0);
  assert.match(stdout.text, /without restarting the stack/);
});

test('CLI status distinguishes configured state, live relay state and real evidence', async t => {
  const root = fixture(t);
  writeRelayControl(root, true);
  const stdout = stream();
  const calls = [];
  const fetchImpl = async (url,opts) => {
    calls.push({url,method:opts?.method || 'GET'});
    return health({ state: 'READY', transport: 'git-ref', agentId: 'agent:chatgpt:abc123',
      inboundRef:'jaco-chatgpt-in',outboundRef:'jaco-chatgpt-out',lastMirroredSeq:42 });
  };
  assert.equal(await relayCli(['status'], { root, out:stdout, fetchImpl }),0);
  const status = JSON.parse(stdout.text);
  assert.equal(status.connected,true);
  assert.equal(status.observed,true);
  assert.equal(status.workplace.agentId,'agent:chatgpt:abc123');
  assert.deepEqual(calls,[{url:'http://127.0.0.1:2995/health',method:'GET'}]);
});

test('CLI fails closed when Workplace is unreachable or URL is remote', async t => {
  const root=fixture(t);
  const out=stream();
  let calls=0;
  const bad=async()=>{calls++;return health({state:'READY',transport:'git-ref',agentId:'fake'});};
  assert.equal(await relayCli(['status'],{root,env:{JACO_WORKPLACE_URL:'https://jaco.example'},out,fetchImpl:bad}),1);
  assert.equal(calls,0);
  assert.equal(JSON.parse(out.text).connected,false);
  const out2=stream();
  assert.equal(await relayCli(['status'],{root,out:out2,fetchImpl:async()=>{throw Error('connection refused');}}),1);
  assert.equal(JSON.parse(out2.text).observed,false);
});

test('CLI never treats a configured relay as connected without live acknowledgement', async t => {
  const root=fixture(t);
  writeRelayControl(root,true);
  const out=stream();
  await relayCli(['status'],{root,out,fetchImpl:async()=>health({state:'DISABLED',transport:'off',agentId:null})});
  assert.equal(JSON.parse(out.text).connected,false);
});
