import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { JacoCoreClient } from '../src/jaco-client.mjs';
import { createToolHandlers, JACO_MCP_TOOL_NAMES } from '../src/tool-handlers.mjs';

const seen = [];
const fake = createServer(async (req, res) => {
  let body=''; for await (const c of req) body += c;
  seen.push({ method:req.method, url:req.url, headers:req.headers, body });
  const payload = { ok:true, path:req.url, body: body ? JSON.parse(body) : null };
  res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(payload));
});
fake.listen(0, '127.0.0.1'); await once(fake,'listening');
const { port } = fake.address();
const core = new JacoCoreClient({ baseUrl:`http://127.0.0.1:${port}`, token:'secret', modelId:'test-model', timeoutMs:2000 });
const system = { status:async()=>({state:'READY'}), activate:async p=>({state:'READY',profile:p}), update:async()=>({state:'UPDATED'}) };
const workplace = {
  status:()=>({state:'READY',agentId:'agent:codex:test'}),
  agents:async()=>({agents:[{agentId:'agent:claude:test'}]}),
  messages:async()=>({events:[{seq:7,kind:'MESSAGE',body:'hello'}]}),
  post:async a=>({eventId:'event:test',...a}),
};
const h = createToolHandlers({ core, system, modelId:'test-model', workplace });

assert.equal(JACO_MCP_TOOL_NAMES.length, 34);
assert.equal(JACO_MCP_TOOL_NAMES.some(n=>/evaluate|shell|exec|credential/i.test(n)), false);
await h.jaco_identity();
await h.jaco_browser_attach({urlIncludes:'127.0.0.1:3000',port:9222});
await h.jaco_relay_action({surface:'BROWSER',mandateId:'m1',consequence:'READ',action:{type:'observe'}});
await h.jaco_connected_status();
await h.jaco_seer_goal({goal:'test',providerId:'ollama'});
await h.jaco_wordpress_status();
assert.equal((await h.jaco_workplace_status()).agentId,'agent:codex:test');
assert.equal((await h.jaco_workplace_agents()).agents[0].agentId,'agent:claude:test');
assert.equal((await h.jaco_workplace_inbox({})).events[0].seq,7);
assert.equal((await h.jaco_workplace_post({kind:'MESSAGE',body:'ping'})).eventId,'event:test');
assert.equal(seen[0].url, '/api/runtime/identity');
assert.equal(seen[0].headers['x-gateway-token'], 'secret');
assert.equal(seen[0].headers['x-jaco-model-id'], 'test-model');
assert.equal(seen[1].url, '/api/browser/hands-off/attach');
assert.deepEqual(JSON.parse(seen[1].body), {urlIncludes:'127.0.0.1:3000',port:9222});
assert.equal(seen[2].url, '/api/relay/action');
assert.equal(JSON.parse(seen[2].body).modelId, 'test-model');
assert.equal(seen[3].url, '/api/connected/status');
assert.equal(seen[4].url, '/api/connected/goals');
assert.equal(seen[5].url, '/api/connected/wordpress/status');
assert.deepEqual(await h.jaco_system_activate({profile:'full'}), {state:'READY',profile:'full'});
assert.deepEqual(await h.jaco_system_update(), {state:'UPDATED'});

fake.close();
console.log('PASS tool handlers: semantic routes, auth headers, model identity, no raw shell/evaluate tools');
