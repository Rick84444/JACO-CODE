import assert from 'node:assert/strict';
let serverSdk, clientSdk, clientHttp;
try {
  serverSdk = await import('@modelcontextprotocol/server');
  // Client 2.0.0 exports the HTTP transport from its root; the old ./streamableHttp subpath made this
  // whole suite SKIP silently even with the SDK installed.
  clientSdk = await import('@modelcontextprotocol/client');
  clientHttp = clientSdk;
} catch (error) {
  console.log('SKIP MCP runtime: official SDK packages are not installed in this build environment');
  process.exit(0);
}
const { createMcpHandler } = serverSdk;
const { Client } = clientSdk;
const { StreamableHTTPClientTransport } = clientHttp;
const { buildJacoMcpServer } = await import('../src/mcp-factory.mjs');
const core={
 identity:async()=>({product:'JACO Autonomus IDE',version:'0.19.1-rc1'}),
 unifiedStatus:async()=>({}), targets:async()=>[], attach:async a=>a, survey:async()=>({}),
 novaBegin:async a=>a, novaTarget:async a=>a, mandates:async()=>[], relayAction:async a=>({verified:true,...a}), browserReceipts:async()=>[],
 connectedStatus:async()=>({}), seerLive:async()=>({phase:'IDLE'}), seerGoal:async a=>a, missionList:async()=>[], missionTickets:async()=>[], missionTick:async()=>({}),
 providers:async()=>[], providerRegister:async a=>a, providerProbe:async id=>({providerId:id,ok:true}), auraProviderChat:async a=>({providerId:a.providerId,content:'ok'}),
 wordpressStatus:async()=>({configured:false}), wordpressPages:async()=>({pages:[]}), wordpressUpdate:async a=>a, wordpressImprove:async a=>a, wordpressCss:async a=>({verified:true,...a}),
 a2aDiscover:async a=>a, a2aOutbound:async a=>({verified:true,...a})
};
const system={status:async()=>({state:'READY'}),activate:async()=>({state:'READY'}),update:async()=>({state:'UPDATED'})};
const handler=createMcpHandler(()=>buildJacoMcpServer({core,system,modelId:'sdk-test'}));
const client=new Client({name:'jaco-test-client',version:'1.0.0'});
const transport=new StreamableHTTPClientTransport(new URL('http://test.local/mcp'),{fetch:(url,init)=>handler.fetch(new Request(url,init))});
await client.connect(transport);
const listed=await client.listTools();
assert.equal(listed.tools.length,42);
for (const required of ['jaco_identity','jaco_system_update','jaco_seer_goal','jaco_aura_provider_chat','jaco_wordpress_improve','jaco_a2a_discover','jaco_workplace_status','jaco_workplace_agents','jaco_workplace_inbox','jaco_workplace_post']) {
  assert.equal(listed.tools.some(t=>t.name===required),true,`missing ${required}`);
}
// Same boundary as tool-registry.test.mjs: jaco_shell_inspect is the allow-listed, disabled-by-default inspector.
assert.equal(listed.tools.some(t=>/evaluate|shell_exec|bash_shell|credential/i.test(t.name)),false);
const result=await client.callTool({name:'jaco_identity',arguments:{}});
assert.match(JSON.stringify(result),/JACO Autonomus IDE/);
await client.close();

// The actual official SDK discovery must respect the same least-privilege
// profile as the registry unit tests; a tunnel must never see 42 privileged tools.
const readOnlyHandler=createMcpHandler(() => buildJacoMcpServer({
  core,system,modelId:'chatgpt-cognitive-client',profile:'cognitive-read'
}));
const readOnlyClient=new Client({name:'chatgpt-cognitive-test',version:'1.0.0'});
const readOnlyTransport=new StreamableHTTPClientTransport(new URL('http://cognitive.test/mcp'),{
  fetch:(url,init)=>readOnlyHandler.fetch(new Request(url,init)),
});
await readOnlyClient.connect(readOnlyTransport);
const visible=await readOnlyClient.listTools();
assert.deepEqual(visible.tools.map(t=>t.name),[
  'jaco_identity','jaco_system_health','jaco_cognitive_context','jaco_knowledge_search'
]);
assert.equal(visible.tools.some(t=>/goal|update|relay|shell|note|post/.test(t.name)),false);
await readOnlyClient.close();
console.log('PASS MCP runtime: official SDK negotiated 42 local tools and exactly four read-only ChatGPT tools');
