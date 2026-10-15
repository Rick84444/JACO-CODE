import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRefusal, defaultServers } from '../../runtime/src/server/mcp/stdioMcpHost.mjs';

test('built-in JacoEdit alone may append a Gameboard proposal with a typed revision', () => {
  const prior = process.env.JACO_LITE;
  process.env.JACO_LITE = '1';
  let def;
  try { def = {id:'editor', transport:'stdio', ...defaultServers({repoRoot:'/test',runtimeRoot:'/test'}).editor,deny:[]}; }
  finally { if(prior===undefined)delete process.env.JACO_LITE; else process.env.JACO_LITE=prior; }
  const tool = {name:'gameboard_publish',readOnly:false};
  const args = {eventId:'obs-1',scope:'mission:test',expectedRevision:0,kind:'OBSERVATION',statement:'CDP service reachable'};
  assert.equal(def.agentAccess,'read');
  assert.equal(agentRefusal(def,tool,args),null);
  for(const name of ['write_file','edit_file','start_goal','git_action'])
    assert.equal(agentRefusal(def,{name,readOnly:false},args),'MCP_TOOL_NOT_READ_ONLY');
  assert.equal(agentRefusal({...def,agentAccess:'off'},tool,args),'MCP_AGENT_ACCESS_OFF');
  assert.equal(agentRefusal({...def,deny:['gameboard_publish']},tool,args),'MCP_TOOL_DENIED');
  assert.equal(agentRefusal({...def,transport:'http'},tool,args),'MCP_REMOTE_WRITE_REQUIRES_AUTHORITY');
  assert.equal(agentRefusal({...def,gameboardJournalOnly:false},tool,args),'MCP_TOOL_NOT_READ_ONLY');
  assert.equal(agentRefusal({...def,id:'other'},tool,args),'MCP_TOOL_NOT_READ_ONLY');
  assert.equal(agentRefusal(def,tool,{...args,kind:'EXECUTE'}),'MCP_GAMEBOARD_MESSAGE_INVALID');
  assert.equal(agentRefusal(def,tool,{...args,expectedRevision:-1}),'MCP_GAMEBOARD_MESSAGE_INVALID');
});
