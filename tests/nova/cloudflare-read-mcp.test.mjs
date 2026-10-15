import test from 'node:test';
import assert from 'node:assert/strict';
import { callCloudflareTool } from '../../runtime/tools/cloudflare-read-mcp.mjs';
const accountId = 'a'.repeat(32);
const store = { get: name => ({ CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_READ_API_TOKEN: 'private-token' })[name] || null };
test('encrypted credentials are consumed in process without returning tokens', async () => {
  const result = await callCloudflareTool('list_workers', { store, fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`);
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    return Response.json({ success: true, result: [{ id: 'jaco-site', secret: 'never-return' }] });
  } });
  assert.deepEqual(result.workers, [{name:'jaco-site',createdOn:null,modifiedOn:null}]);
  assert.ok(!JSON.stringify(result).includes('private-token'));
});
test('missing credentials and unsupported operations never make requests', async () => {
  const options = { store: {get:()=>null}, fetchImpl:()=>{throw Error('unexpected request');} };
  await assert.rejects(callCloudflareTool('list_workers', options), /CREDENTIALS_UNAVAILABLE/);
  await assert.rejects(callCloudflareTool('delete_worker', options), /TOOL_UNKNOWN/);
});
test('upstream failures produce bounded errors without response secrets', async () => {
  for (const [status, code] of [[401,'AUTHENTICATION_FAILED'],[403,'PERMISSION_DENIED'],[429,'RATE_LIMITED'],[503,'HTTP_503']]) {
    await assert.rejects(callCloudflareTool('list_workers', {store,fetchImpl:async()=>Response.json({success:false,error:'private-token'}, {status})}), new RegExp(`^Error: CLOUDFLARE_${code}$`));
  }
  await assert.rejects(callCloudflareTool('list_workers', {store,fetchImpl:async()=>new Response('<html>login</html>')}), /RESPONSE_INVALID/);
  await assert.rejects(callCloudflareTool('list_workers', {store,fetchImpl:async()=>{throw new DOMException('secret', 'TimeoutError');}}), /CLOUDFLARE_TIMEOUT/);
});
