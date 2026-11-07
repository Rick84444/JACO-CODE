import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoogleOperatorOAuth, googleOAuthConfig } from '../../runtime/src/server/connected/googleOperatorOAuth.mjs';

const env={
  JACO_GOOGLE_OAUTH_CLIENT_ID:'jaco-test.apps.googleusercontent.com',
  JACO_GOOGLE_OAUTH_CLIENT_SECRET:'fake-test-secret',
  JACO_GOOGLE_OAUTH_REDIRECT_URI:'http://127.0.0.1:3000/api/aura/google/callback'
};

test('Google connection uses state, nonce, PKCE and narrow identity scopes',async()=>{
  let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;
    if(String(url).endsWith('/token')) {
      const params=new URLSearchParams(options.body);
      assert.equal(params.get('grant_type'),'authorization_code');
      assert.ok(params.get('code_verifier')?.length>=43);
      return Response.json({id_token:'fixture-id-token'});
    }
    if(String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      return Response.json({aud:env.JACO_GOOGLE_OAUTH_CLIENT_ID,iss:'https://accounts.google.com',sub:'user-123',email:'operator@example.org',email_verified:'true',exp:String(Math.floor(Date.now()/1000)+500),nonce:lastNonce});
    }
    throw Error('Unexpected URL');
  };
  let lastNonce='';
  const provider=createGoogleOperatorOAuth({env,fetchImpl});
  const start=provider.start(), url=new URL(start.url);
  assert.equal(url.origin,'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'),'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  lastNonce=url.searchParams.get('nonce');
  await assert.rejects(provider.complete({state:'wrong',code:'ok'}),/STATE_INVALID/);
  const completed=await provider.complete({state:url.searchParams.get('state'),code:'valid-code'});
  assert.equal(completed.connected,true);
  assert.equal(calls,2);
  assert.equal(provider.status().identity.email,'operator@example.org');
  assert.equal(provider.status().permissions,'IDENTITY_ONLY');
  await assert.rejects(provider.complete({state:url.searchParams.get('state'),code:'replay'}),/STATE_INVALID/);
});

test('Google refuses invalid redirect and missing configuration',()=>{
  assert.throws(()=>googleOAuthConfig({...env,JACO_GOOGLE_OAUTH_REDIRECT_URI:'https://evil.org/api/aura/google/callback'}),/LOOPBACK_CALLBACK/);
  assert.throws(()=>createGoogleOperatorOAuth({env:{}}).start(),/NOT_CONFIGURED/);
});