import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkplaceStore } from '../../gateway/src/workplace/workplace-store.mjs';
import { createChatGptGithubRelay } from '../../gateway/src/workplace/chatgpt-github-relay.mjs';

const sha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const commitSha = 'c'.repeat(40);
const inbound = {
  schema: 'jaco.chatgpt-workplace/v1',
  messageId: 'gpt-workplace-handshake-20261116-v1',
  kind: 'QUESTION',
  thread: 'chatgpt',
  targets: ['*'],
  body: 'Can Aura acknowledge this harmless connection check?',
};
function fakeGit({ missingInput = false, wrongOrigin = false, failPush = false } = {}) {
  const state = { published: [], pushes: 0, fetched: [], remoteOut: false };
  const run = async (_file, args, opts = {}) => {
    const sub = args.slice(2);
    if (sub[0] === 'remote') return { stdout: wrongOrigin ? 'https://github.com/other/repo.git\n' : 'https://github.com/Rick84444/JACO-CODE.git\n' };
    if (sub[0] === 'fetch') {
      state.fetched.push(sub.join(' '));
      if (missingInput && sub.some(v => v.includes('jaco-chatgpt-in')))
        throw Error('remote ref missing');
      return { stdout: '' };
    }
    if (sub[0] === 'show') return { stdout: JSON.stringify(inbound) };
    if (sub[0] === 'ls-remote') return { stdout: state.remoteOut ? sha + '\trefs/heads/jaco-chatgpt-out\n' : '' };
    if (sub[0] === 'rev-parse') return { stdout: sha + '\n' };
    if (sub[0] === 'hash-object') {
      state.published.push(JSON.parse(fs.readFileSync(sub.at(-1), 'utf8')));
      return { stdout: sha + '\n' };
    }
    if (sub[0] === 'read-tree' || sub[0] === 'update-index') {
      assert.ok(opts.env?.GIT_INDEX_FILE, 'never touch user index');
      return { stdout: '' };
    }
    if (sub[0] === 'write-tree') return { stdout: treeSha + '\n' };
    if (sub[0] === 'commit-tree') return { stdout: commitSha + '\n' };
    if (sub[0] === 'push') {
      state.pushes++;
      if (failPush) throw Error('push denied');
      state.remoteOut = true;
      return { stdout: '' };
    }
    throw Error('Unexpected Git command: ' + sub.join(' '));
  };
  return { run, state };
}
function peer(store) {
  const card = {
    schema:'jaco.agent-card/v1',
    identity:{stable_id:'aura-test',requested_name:'Aura',provider:'local',agent_type:'coding'},
    session:{environment:'fixture'},
    role:{primary:'operator'},
    capabilities:{},communication:{can_receive_messages:true},
  };
  const reg=store.registerAgent(card);
  store.ack({sessionId:reg.sessionId,sessionToken:reg.sessionToken,cursor:reg.latestSeq});
  store.postEvent({sessionId:reg.sessionId,sessionToken:reg.sessionToken,kind:'STATUS',body:'Aura ready',payload:{status:'READY'}});
  return reg;
}
function setup(t, flags = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-chatgpt-ref-test-'));
  const store=new WorkplaceStore(root,{staleAfterMs:60000});
  const git=fakeGit(flags);
  const relay=createChatGptGithubRelay({
    store,root,gitExecImpl:git.run,log:()=>{},
    env:{
      JACO_CHATGPT_WORKPLACE_TRANSPORT:'git-ref',
      JACO_CHATGPT_WORKPLACE_REPO:'Rick84444/JACO-CODE',
      JACO_CHATGPT_WORKPLACE_ACTOR:'Rick84444',
      JACO_CHATGPT_GIT_REPO_ROOT:root,
      JACO_CHATGPT_WORKPLACE_POLL_MS:'60000',
    },
  });
  t.after(async()=>{await relay.stop();store.close();fs.rmSync(root,{recursive:true,force:true});});
  return {store,git,relay};
}

test('tokenless Git channel registers an honest ChatGPT card and receives a canonical Workplace event',async t=>{
  const {store,git,relay}=setup(t);
  const first=await relay.start();
  assert.equal(first.enabled,true);
  assert.equal(first.transport,'git-ref');
  assert.equal(first.state,'READY');
  assert.ok(first.agentId?.startsWith('agent:chatgpt:'));
  assert.ok(first.sessionId?.startsWith('session:'));
  assert.equal(store.getSession(first.sessionId).status,'READY');
  assert.equal(store.permissions(first.agentId)['mission.create'],false);
  assert.equal(store.permissions(first.agentId)['decision.publish'],false);
  assert.equal(store.permissions(first.agentId)['deployment.execute'],false);
  const chatgpt=store.listAgents().find(x=>x.agentId===first.agentId);
  assert.equal(chatgpt.card.identity.model,'unknown');
  assert.equal(chatgpt.card.communication.can_receive_missions,false);
  const responder=peer(store);
  const ingress=store.sync({sessionId:responder.sessionId,sessionToken:responder.sessionToken,after:0,limit:100}).events.find(e=>e.body===inbound.body);
  assert.ok(ingress);
  assert.equal(ingress.sender.agentId,first.agentId);
  store.postEvent({sessionId:responder.sessionId,sessionToken:responder.sessionToken,
    kind:'ANSWER',thread:'chatgpt',targets:[first.agentId],
    body:'A PRIVATE INTERNAL MESSAGE WITH VALUE wps_sensitive-not-for-github'});
  await relay.poll();
  assert.equal(relay.status().state,'READY');
  assert.ok(git.state.pushes>=2,'bounded receipts pushed to Git in both directions');
  const last=git.state.published.at(-1);
  assert.equal(last.schema,'jaco.chatgpt-workplace-receipt/v1');
  assert.equal(last.agentId,first.agentId);
  assert.equal(last.receivedId,inbound.messageId);
  assert.ok(last.events.some(e=>e.kind==='ANSWER' && /^[0-9a-f]{64}$/.test(e.bodySha256)));
  assert.ok(!JSON.stringify(last).includes('A PRIVATE INTERNAL MESSAGE'));
  assert.ok(!JSON.stringify(last).includes('wps_sensitive'));
  assert.ok(git.state.fetched.some(x=>x.includes('jaco-chatgpt-in')));
});

test('no public or fabricated registration if the Git input ref is missing',async t=>{
  const {store,relay}=setup(t,{missingInput:true});
  const result=await relay.start();
  assert.equal(result.state,'DEGRADED_UNSYNCED');
  assert.match(result.lastError,/CHATGPT_GIT_INBOUND_REF_UNAVAILABLE/);
  assert.equal(result.agentId,null);
  assert.equal(store.listAgents().some(a=>a.requestedName==='ChatGPT'),false);
});
test('origin mismatch refuses session registration',async t=>{
  const {store,relay}=setup(t,{wrongOrigin:true});
  const result=await relay.start();
  assert.equal(result.state,'DEGRADED_UNSYNCED');
  assert.match(result.lastError,/CHATGPT_GIT_ORIGIN_MISMATCH/);
  assert.equal(store.listAgents().some(a=>a.requestedName==='ChatGPT'),false);
});
test('outbound push failure degrades agent status without claiming a live relay',async t=>{
  const {store,relay}=setup(t,{failPush:true});
  const result=await relay.start();
  assert.equal(result.state,'DEGRADED_UNSYNCED');
  assert.equal(store.getSession(result.sessionId).status,'DEGRADED_UNSYNCED');
});
