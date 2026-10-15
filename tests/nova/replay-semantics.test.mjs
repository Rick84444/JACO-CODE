import test from 'node:test';
import assert from 'node:assert/strict';
import { mayAutoReplayTask, executionExceptionResult } from '../../agents/lib/replay-semantics.mjs';
import { checkedReceipt } from '../../agents/lib/mission-client.mjs';
import { callMcpTool } from '../../agents/lib/mcp-tools.mjs';

test('only narrowly classified tasks may replay after crash; opaque and UI actions fail closed', () => {
  for (const type of ['web-fetch','repo-read','desktop-observe','android-observe','repo-test','skill-load']) assert.equal(mayAutoReplayTask(type),true);
  for (const type of ['mcp-call','mcp-write','browser-click','android-begin','android-target','shell','new-tool']) assert.equal(mayAutoReplayTask(type),false);
});

test('exception in mutating action is UNKNOWN even when no error receipt can prove the side effect', () => {
  const uncertain = checkedReceipt({type:'browser-click'},executionExceptionResult({type:'browser-click'},new Error('network lost')));
  assert.equal(uncertain.ok,false);
  assert.equal(uncertain.verified,false);
  assert.equal(uncertain.outcomeUnknown,true);
  const read = checkedReceipt({type:'repo-read'},executionExceptionResult({type:'repo-read'},new Error('file absent')));
  assert.equal(read.ok,false);
  assert.equal(read.outcomeUnknown,false);
});

test('MCP write transport failure, 5xx and unparseable acknowledgement are uncertain', async () => {
  const data={server:'files',tool:'save_file',arguments:{path:'x'}};
  const serverError=await callMcpTool(data,{fetchImpl:async(_url,opts)=>{
    assert.equal(JSON.parse(opts.body).mode,'write');
    return {ok:false,status:503,json:async()=>({error:'unavailable'})};
  },mode:'write',runtimeUrl:'http://localhost'});
  assert.equal(serverError.outcomeUnknown,true);
  const lost=await callMcpTool(data,{fetchImpl:async()=>{throw Error('connection reset');},mode:'write',runtimeUrl:'http://localhost'});
  assert.equal(lost.outcomeUnknown,true);
  const readLost=await callMcpTool(data,{fetchImpl:async()=>{throw Error('connection reset');},mode:'read',runtimeUrl:'http://localhost'});
  assert.equal(readLost.outcomeUnknown,undefined);
  const rejected=await callMcpTool(data,{fetchImpl:async()=>({ok:false,status:403,json:async()=>({success:false,error:'denied'})}),mode:'write',runtimeUrl:'http://localhost'});
  assert.equal(rejected.outcomeUnknown,undefined);
  const truncated=await callMcpTool(data,{fetchImpl:async()=>({ok:true,status:200,json:async()=>{throw Error('truncated');}}),mode:'write',runtimeUrl:'http://localhost'});
  assert.equal(truncated.outcomeUnknown,true);
});


test('MCP tool-level errors are not verified even when HTTP 200 and host success=true', async () => {
  const data={server:'files',tool:'save_file',arguments:{path:'x'}};
  const res = payload => ({ok:true,status:200,json:async()=>payload});
  const toolError = await callMcpTool(data,{
    fetchImpl:async()=>res({success:true,result:{isError:true,content:[{type:'text',text:'tool failed'}]}}),
    mode:'write',runtimeUrl:'http://localhost',
  });
  assert.equal(toolError.ok,false);
  assert.equal(toolError.verified,false);
  assert.equal(toolError.error,'MCP_TOOL_ERROR');
  assert.equal(toolError.outcomeUnknown,true,'the tool might have failed after the write');

  const readError = await callMcpTool(data,{
    fetchImpl:async()=>res({success:true,result:{isError:true,content:[]}}),
    mode:'read',runtimeUrl:'http://localhost',
  });
  assert.equal(readError.ok,false);
  assert.equal(readError.outcomeUnknown,undefined);

  const incomplete = await callMcpTool(data,{
    fetchImpl:async()=>res({result:{content:[{type:'text',text:'not an acknowledgement'}]}}),
    mode:'write',runtimeUrl:'http://localhost',
  });
  assert.equal(incomplete.ok,false);
  assert.equal(incomplete.verified,false);
  assert.equal(incomplete.error,'MCP_ACK_INVALID');
  assert.equal(incomplete.outcomeUnknown,true);

  const failedAfterExecution = await callMcpTool(data,{
    fetchImpl:async()=>res({success:false,error:'tool failed after update'}),
    mode:'write',runtimeUrl:'http://localhost',
  });
  assert.equal(failedAfterExecution.ok,false);
  assert.equal(failedAfterExecution.outcomeUnknown,true);
});
