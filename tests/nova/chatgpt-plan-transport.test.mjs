import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { beginAuthorization, acceptCallback, verifyIdentity, exchangeAuthorization, listPlanModels, completePlan, readCompletedResponse } from '../../runtime/src/server/connected/chatgptPlanTransport.mjs';

const hostId='urn:uuid:12345678-1234-4321-9876-123456789abc';
const redirectUri='http://127.0.0.1:1455/auth/callback';
const clientId='oaiapp_fixture';
const make=()=>beginAuthorization({hostId,redirectUri});
const callback=(a,params={})=>redirectUri+'?'+new URLSearchParams({state:a.state,code:'fixture-code',client_id:clientId,...params});
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...keys.publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'}]};
function jwt(a,overrides={}) {
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const now=Math.floor(Date.now()/1000);
  const body=enc({alg:'RS256',kid:'fixture'})+'.'+enc({iss:'https://auth.openai.com',sub:'fixture-sub',aud:clientId,nonce:a.nonce,iat:now,exp:now+600,...overrides});
  return body+'.'+sign('RSA-SHA256',Buffer.from(body),keys.privateKey).toString('base64url');
}
const asJson=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const sse=events=>new Response(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')).body;
const terminal={type:'response.completed',response:{usage:{input_tokens:2}}};
const delta={type:'response.output_text.delta',delta:'hello'};
function authFetch(a,scope='openid resource.invoke chatgpt.tokens.use.direct'){
  return async (url,init)=>{
    if(url.endsWith('/oauth/token')){
      assert.equal(init.body.get('client_id'),clientId);
      assert.equal(init.body.get('code_verifier'),a.verifier);
      return asJson({id_token:jwt(a),access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600,scope});
    }
    assert.equal(url,'https://auth.openai.com/.well-known/jwks.json');
    return asJson(jwks);
  };
}
test('authorization uses own identity, fresh PKCE and exact loopback callback',()=>{
  const a=make(), b=make(), u=new URL(a.url);
  assert.equal(u.origin,'https://auth.openai.com');
  assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');
  assert.equal(u.searchParams.get('agent_name_hint'),'JACO CODE');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  assert.notEqual(a.state,b.state);
  assert.throws(()=>beginAuthorization({hostId,redirectUri:'https://remote.example/auth/callback'}),/CALLBACK_INVALID/);
  assert.throws(()=>acceptCallback(a,callback(a,{state:'wrong'})),/STATE_MISMATCH/);
  assert.equal(acceptCallback(a,callback(a)).client_id,clientId);
  assert.throws(()=>acceptCallback(a,callback(a)),/ATTEMPT_EXPIRED/);
});
test('signed identity validates audience, issuer and nonce',()=>{
  const a=make();
  assert.equal(verifyIdentity(jwt(a),jwks,clientId,a.nonce).subject,'fixture-sub');
  for(const overrides of [{aud:'wrong'},{nonce:'wrong'},{iss:'https://wrong.example'},{exp:1}]){
    assert.throws(()=>verifyIdentity(jwt(a,overrides),jwks,clientId,a.nonce),/IDENTITY_INVALID/);
  }
  const token=jwt(a);
  assert.throws(()=>verifyIdentity(token.slice(0,token.lastIndexOf('.')+1)+'AAAA',jwks,clientId,a.nonce),/SIGNATURE_INVALID/);
});
test('identity alone does not grant plan inference',async()=>{
  const a=make();
  await assert.rejects(exchangeAuthorization(a,callback(a),{fetchImpl:authFetch(a,'openid')}),/PLAN_NOT_GRANTED/);
  await assert.rejects(listPlanModels({accessToken:'fixture'}),/SESSION_REQUIRED/);
});
test('model discovery and completed streaming use only public endpoints',async()=>{
  const a=make(), session=await exchangeAuthorization(a,callback(a),{fetchImpl:authFetch(a)});
  const fake=async(url,init)=>{
    assert.equal(init.headers.authorization,'Bearer fixture-access');
    assert.equal(init.redirect,'error');
    if(url.endsWith('/models'))return asJson({models:[{slug:'fixture-model',visibility:'list',display_name:'Fixture'},{slug:'hidden',visibility:'hidden'}]});
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(init.body);
    assert.equal(body.store,false);assert.equal(body.stream,true);
    return new Response(sse([delta,terminal]));
  };
  assert.deepEqual(await listPlanModels(session,{fetchImpl:fake}),[{id:'fixture-model',label:'Fixture'}]);
  assert.equal((await completePlan(session,{model:'fixture-model',messages:[{role:'user',content:'hi'}],fetchImpl:fake})).content,'hello');
});
test('incomplete and plan-limit streams are never success',async()=>{
  await assert.rejects(readCompletedResponse(sse([delta])),/STREAM_INCOMPLETE/);
  await assert.rejects(readCompletedResponse(sse([delta,{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/PLAN_LIMIT/);
  await assert.rejects(readCompletedResponse(sse([terminal])),/EMPTY_RESPONSE/);
});
