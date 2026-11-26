import test from 'node:test';
import assert from 'node:assert/strict';
import {MCP_INTEGRATION_CATALOG,mcpCatalogDraft,mcpConnectionState,pluginLoginPreset,marketplaceEntries,pluginCategory,financialOptions,catalogDefinitionMatches,pluginEvidence,observationFresh,pluginEnvironment} from '../../runtime/src/lib/mcpIntegrationCatalog.mjs';
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
  assert.equal(ids.size,15);
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

test('marketing presets and marketplace candidates never masquerade as connected',()=>{
  const b=mcpCatalogDraft('buffer');
  assert.equal(b.target,'https://mcp.buffer.com/mcp');
  assert.equal(b.tokenEnv,'BUFFER_API_KEY');
  assert.equal(b.agentAccess,'read');
  assert.equal(b.allowOpenLogin,false);
  assert.equal(pluginCategory(MCP_INTEGRATION_CATALOG.find(p=>p.id==='buffer')),'marketing');
  assert.equal(pluginCategory(MCP_INTEGRATION_CATALOG.find(p=>p.id==='stripe')),'finance');
  assert.equal(mcpCatalogDraft('mailchimp-docs').tokenEnv,'');
  for(const id of ['etsy','shopify','ebay','hubspot','jobbi','frantic'])assert.throws(()=>mcpCatalogDraft(id),/MCP_CATALOG_UNKNOWN/);
  const entries=marketplaceEntries([{id:'jobbi',status:'READY'},{id:'etsy',status:'READY'}]);
  assert.equal(entries.find(p=>p.id==='jobbi').state,'TOOLS_DISCOVERED');
  assert.equal(entries.find(p=>p.id==='etsy').state,'ADAPTER_REQUIRED');
  assert.equal(entries.find(p=>p.id==='hubspot').state,'OAUTH_REQUIRED');
});

test('financial choices distinguish observed read tools from setup and never grant financial authority',()=>{
  const unknown=financialOptions();
  assert.equal(unknown.observed,false);
  assert.ok(unknown.strategies.every(s=>s.state==='UNOBSERVED'));
  const coingecko=mcpCatalogDraft('coingecko');
  assert.equal(coingecko.target,'https://mcp.api.coingecko.com/mcp');
  assert.equal(coingecko.tokenEnv,'');
  assert.equal(mcpCatalogDraft('paypal-sandbox').target,'https://mcp.sandbox.paypal.com/http');
  assert.throws(()=>mcpCatalogDraft('paypal'),/MCP_CATALOG_UNKNOWN/);
  for(const id of ['fortnox','wise','coinbase','alpaca'])assert.throws(()=>mcpCatalogDraft(id),/MCP_CATALOG_UNKNOWN/);
  const live={id:'coingecko',status:'READY',agentAccess:'read',tools:[{name:'price',readOnly:true,agentAllowed:true}]};
  const p=financialOptions([live]);
  assert.equal(p.strategies.find(s=>s.id==='market-research').state,'READ_TOOLS_DISCOVERED');
  assert.equal(p.strategies.find(s=>s.id==='capital-overview').state,'SETUP_OR_DISCOVERY_REQUIRED');
  assert.ok(p.strategies.every(s=>!s.financialMutationAllowed&&!s.executionVerified));
  assert.equal(financialOptions([{...live,agentAccess:'off'}]).strategies.find(s=>s.id==='market-research').state,'SETUP_OR_DISCOVERY_REQUIRED');
  assert.equal(financialOptions([{...live,tools:[{readOnly:false,agentAllowed:true}]}]).strategies.find(s=>s.id==='market-research').state,'SETUP_OR_DISCOVERY_REQUIRED');
  assert.equal(financialOptions([{...live,credentialConfigured:false}]).strategies.find(s=>s.id==='market-research').state,'SETUP_OR_DISCOVERY_REQUIRED');
});

test('enterprise evidence separates catalog identity, stale observations and test environment',()=>{
  const def={transport:'http',url:'https://mcp.render.com/mcp',tokenEnv:'RENDER_API_KEY',agentAccess:'read'};
  assert.equal(catalogDefinitionMatches('render',def),true);
  assert.equal(catalogDefinitionMatches('render',{...def,url:def.url+'?other=1'}),false);
  assert.equal(catalogDefinitionMatches('render',{...def,tokenEnv:'DIFFERENT_TOKEN'}),false);
  assert.equal(mcpConnectionState(null,false),'UNOBSERVED');
  assert.equal(pluginEnvironment('paypal-sandbox'),'SANDBOX');
  assert.equal(pluginEnvironment('stripe'),'ACCOUNT_SCOPE_UNVERIFIED');
  const at='2026-11-26T13:00:00.000Z',now=Date.parse(at);
  assert.equal(observationFresh(at,now+30000),true);
  assert.equal(observationFresh(at,now+60000),false);
  assert.equal(observationFresh(at,now-6000),false);
  const provider={id:'coingecko',status:'READY',agentAccess:'read',catalogMatch:true,tools:[{readOnly:true,agentAllowed:true}],stats:{lastCall:{at,outcome:'ok',tool:'price',error:'private'}}};
  assert.equal(pluginEvidence(provider).allowedReadTools,1);
  assert.deepEqual(pluginEvidence(provider).lastCall,{at,outcome:'ok',tool:'price'});
  assert.equal(pluginEvidence(provider).executionVerified,false);
  assert.equal(pluginEvidence(provider,false).lastCall,null);
  assert.equal(pluginEvidence({...provider,catalogMatch:false}).state,'CUSTOM_CONFIGURATION');
  assert.equal(financialOptions([{...provider,catalogMatch:false}]).strategies.find(s=>s.id==='market-research').state,'SETUP_OR_DISCOVERY_REQUIRED');
  assert.equal(financialOptions([provider],at).observedAt,at);
});

test('Stripe sandbox is explicitly isolated from financial strategy readiness',()=>{
  const draft=mcpCatalogDraft('stripe-sandbox');
  assert.equal(draft.tokenEnv,'JACO_MCP_GUIDED_STRIPE_SANDBOX');
  assert.equal(pluginEnvironment('stripe-sandbox'),'SANDBOX');
  const ready={id:'stripe-sandbox',status:'READY',agentAccess:'read',catalogMatch:true,credentialConfigured:true,tools:[{name:'get_stripe_account_info',readOnly:true,agentAllowed:true}]};
  const options=financialOptions([ready]);
  assert.equal(options.plugins.find(p=>p.id==='stripe-sandbox').environment,'SANDBOX');
  assert.ok(options.strategies.every(s=>s.state==='SETUP_OR_DISCOVERY_REQUIRED'&&!s.financialMutationAllowed));
});
