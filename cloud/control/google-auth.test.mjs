import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyGoogleIdToken} from '../../site/jacocode.com/auth.mjs';
test('Render Google token signature must match a pinned provider key',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const key={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
  const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const h=b64({alg:'RS256',kid:key.kid}),p=b64({sub:'test-subject'}),body=h+'.'+p;
  const token=body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
  const fetchImpl=async url=>{assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[key]});};
  assert.deepEqual(await verifyGoogleIdToken(token,fetchImpl),{sub:'test-subject'});
  assert.equal(await verifyGoogleIdToken(h+'.'+b64({sub:'other'})+'.'+token.split('.')[2],fetchImpl),null);
  assert.equal(await verifyGoogleIdToken(b64({alg:'none',kid:key.kid})+'.'+p+'.AA',fetchImpl),null);
  assert.equal(await verifyGoogleIdToken(token,async()=>Response.json({keys:[]})),null);
});
