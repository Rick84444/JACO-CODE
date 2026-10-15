import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkplaceStore } from '../../gateway/src/workplace/workplace-store.mjs';
import { createChatGptGithubRelay } from '../../gateway/src/workplace/chatgpt-github-relay.mjs';
import { buildMcpClientAgentCard } from '../../gateway/src/workplace/mcp-client-bridge.mjs';

function readyAgent(store, card) {
  const reg=store.registerAgent(card,{workspace:'JACO'});
  store.ack({sessionId:reg.sessionId,sessionToken:reg.sessionToken,workspace:'JACO',cursor:reg.latestSeq});
  store.postEvent({
    sessionId:reg.sessionId,sessionToken:reg.sessionToken,workspace:'JACO',
    kind:'STATUS',thread:'agent-status',body:'ready',payload:{status:'READY'},
  });
  return reg;
}

test('MCP cards identify Claude and Codex without inventing host capabilities',()=>{
  const claude=buildMcpClientAgentCard('claude-code',{});
  assert.equal(claude.identity.stable_id,'claude-code');
  assert.equal(claude.identity.provider,'anthropic');
  assert.equal(claude.capabilities.reasoning,true);
  assert.equal(claude.capabilities.terminal,false);
  assert.equal(claude.capabilities.filesystem_write,false);
  assert.equal(claude.communication.can_receive_messages,true);
  assert.equal(claude.communication.can_receive_missions,false);

  const codex=buildMcpClientAgentCard('codex-vscode',{});
  assert.equal(codex.identity.stable_id,'vscode-codex-jaco');
  assert.equal(codex.identity.provider,'openai');
});

test('ChatGPT GitHub relay transports messages bidirectionally through canonical Workplace',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-chatgpt-workplace-'));
  const store=new WorkplaceStore(root,{staleAfterMs:60_000});
  const postedComments=[];
  const inboundBody=[
    '<!-- jaco-chatgpt-workplace-in:v1 -->',
    '',
    '```json',
    JSON.stringify({
      schema:'jaco.chatgpt-workplace/v1',
      messageId:'chatgpt-test-0001',
      kind:'QUESTION',
      thread:'claude-codex',
      targets:['*'],
      body:'Which target-host risk should we verify first?'
    }),
    '```'
  ].join('\n');

  const fetchImpl=async(url,init={})=>{
    const value=String(url);
    if(value.includes('/issues?')) return Response.json([{
      number:82,title:'[JACO CHATGPT] Workplace bridge',
      body:'<!-- jaco-chatgpt-workplace-bridge:v1 -->',
      user:{login:'Rick84444'},
    }]);
    if(value.includes('/issues/82/comments') && (init.method||'GET')==='GET') return Response.json([{
      id:1001,body:inboundBody,user:{login:'Rick84444'},created_at:'2026-09-26T22:00:00Z'
    }]);
    if(value.includes('/issues/82/comments') && init.method==='POST'){
      const parsed=JSON.parse(init.body);
      postedComments.push(parsed.body);
      return Response.json({id:2000+postedComments.length,body:parsed.body,user:{login:'Rick84444'}});
    }
    return Response.json({message:'not found'},{status:404});
  };

  const relay=createChatGptGithubRelay({
    store,root,fetchImpl,
    env:{
      JACO_CHATGPT_WORKPLACE_TOKEN:'fixture-token',
      JACO_CHATGPT_WORKPLACE_REPO:'Rick84444/jaco-code',
      JACO_CHATGPT_WORKPLACE_ACTOR:'Rick84444',
      JACO_CHATGPT_WORKPLACE_POLL_MS:'60000',
      JACO_CHATGPT_MODEL:'gpt-5.6-sol',
    },
    log:()=>{},
  });

  try{
    const status=await relay.start();
    assert.equal(status.state,'READY');
    assert.ok(status.agentId?.startsWith('agent:chatgpt'));

    const claude=readyAgent(store,{
      schema:'jaco.agent-card/v1',
      identity:{stable_id:'claude-code',requested_name:'Claude Code',provider:'anthropic',model:'claude-opus',agent_type:'coding'},
      session:{environment:'test',persistent:false,sandboxed:true},
      role:{primary:'coding',description:'fixture'},
      capabilities:{reasoning:true},
      constraints:[],preferred_tasks:[],
      communication:{can_receive_messages:true,can_receive_missions:false,can_be_mentioned:true},
    });

    const fromChatGpt=store.sync({
      sessionId:claude.sessionId,sessionToken:claude.sessionToken,workspace:'JACO',after:0,limit:100
    }).events.find(event=>event.body==='Which target-host risk should we verify first?');
    assert.ok(fromChatGpt);
    assert.equal(fromChatGpt.kind,'QUESTION');
    assert.equal(fromChatGpt.sender.agentId,status.agentId);

    store.postEvent({
      sessionId:claude.sessionId,sessionToken:claude.sessionToken,workspace:'JACO',
      kind:'ANSWER',thread:'chatgpt-claude',targets:[status.agentId],
      body:'Verify restart reconstruction against the durable mission on the real host.',
      payload:{evidence:'fixture'},
    });
    await relay.poll();

    assert.ok(postedComments.some(body=>body.includes('jaco-chatgpt-workplace-out:v1')));
    const outbound=postedComments.find(body=>body.includes('jaco-chatgpt-workplace-out:v1'));
    assert.ok(outbound.includes('Verify restart reconstruction'));
    assert.ok(!outbound.includes('fixture-token'));
    assert.ok(!outbound.includes('wps_'));

    const agents=store.listAgents();
    const chatgpt=agents.find(agent=>agent.agentId===status.agentId);
    assert.equal(chatgpt.requestedName,'ChatGPT');
    assert.equal(chatgpt.card.communication.can_receive_missions,false);
    assert.match(chatgpt.card.role.description,/does not imply continuous background cognition/);
  } finally {
    await relay.stop();
    store.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
