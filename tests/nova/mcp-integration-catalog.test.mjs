import test from 'node:test';
import assert from 'node:assert/strict';
import {MCP_INTEGRATION_CATALOG,mcpCatalogDraft,mcpConnectionState,pluginLoginPreset} from '../../runtime/src/lib/mcpIntegrationCatalog.mjs';
import {validateServerEntry} from '../../runtime/src/server/mcp/stdioMcpHost.mjs';

test('official catalog presets are valid explicit operator configurations with read-only agent defaults',()=>{
  const ids=new Set();
  for(const item of MCP_INTEGRATION_CATALOG){
    assert.equal(ids.has(item.id),false);
    ids.add(item.id);
    const draft=mcpCatalogDraft(item.id);
    const config=validateServerEntry(draft.id,{...draft,transport:'http',url:draft.target});
    assert.equal(new URL(config.url).protocol,'https:');
    assert.equal(new URL(item.docs).protocol,'https:');
    assert.equal(config.agentAccess,'read');
    assert.notEqual(config.allowOpenLogin,true);
    assert.equal(config.tokenEnv,draft.tokenEnv||null);
    assert.notEqual(mcpCatalogDraft(item.id),draft);
  }
  assert.equal(ids.size,10);
  assert.throws(()=>mcpCatalogDraft('arbitrary'),/MCP_CATALOG_UNKNOWN/);
});
test('configuration, authentication, stale state and discovered tools are distinct',()=>{
  assert.equal(mcpConnectionState(null),'AVAILABLE');
  assert.equal(mcpConnectionState({status:'STOPPED'}),'CONFIGURED');
  assert.equal(mcpConnectionState({status:'STOPPED',credentialConfigured:false}),'AUTH_REQUIRED');
  assert.equal(mcpConnectionState({status:'FAILED',error:'MCP_AUTH_REQUIRED'}),'AUTH_REQUIRED');
  assert.equal(mcpConnectionState({status:'READY'}),'TOOLS_DISCOVERED');
  assert.equal(mcpConnectionState({status:'READY'},false),'UNOBSERVED');
  assert.equal(mcpConnectionState({status:'UNOBSERVED'}),'UNOBSERVED');
  assert.equal(mcpConnectionState({status:'READY',agentAccess:'off'}),'AGENT_ACCESS_OFF');
  assert.equal(mcpConnectionState({status:'FAILED',error:'MCP_TRANSPORT_DNS'}),'ERROR');
});

test('login pages are pinned to the reviewed plugin endpoint and token reference',()=>{
  const d={transport:'http',url:'https://mcp.render.com/mcp',tokenEnv:'RENDER_API_KEY',agentAccess:'read'};
  assert.equal(pluginLoginPreset('render',d)?.loginUrl,'https://dashboard.render.com/');
  for(const changes of [{url:'https://example.org/mcp'},{url:d.url+'?other=true'},{tokenEnv:'OTHER_TOKEN'},{agentAccess:'off'},{transport:'stdio'}]){
    assert.equal(pluginLoginPreset('render',{...d,...changes}),null);
  }
  assert.equal(pluginLoginPreset('unknown',d),null);
});
