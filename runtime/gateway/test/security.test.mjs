import assert from 'node:assert/strict';
import { parseHostHeader, hostAllowed, originAllowed, bearerAllowed } from '../src/security.mjs';

assert.equal(parseHostHeader('127.0.0.1:2999'),'127.0.0.1');
assert.equal(parseHostHeader('localhost:2999'),'localhost');
assert.equal(parseHostHeader('[::1]:2999'),'[::1]');
assert.equal(parseHostHeader('user@localhost:2999'),null);
assert.equal(parseHostHeader('localhost/path'),null);
const cfg={gatewayHost:'127.0.0.1',gatewayPort:2999,allowedHosts:['127.0.0.1','localhost','[::1]']};
const req=(host,origin,auth)=>({headers:{host,...(origin?{origin}:{}),...(auth?{authorization:auth}:{})}});
assert.equal(hostAllowed(req('127.0.0.1:2999'),cfg.allowedHosts),true);
assert.equal(hostAllowed(req('evil.test:2999'),cfg.allowedHosts),false);
assert.equal(originAllowed(req('127.0.0.1:2999','http://127.0.0.1:2999'),cfg),true);
assert.equal(originAllowed(req('127.0.0.1:2999','https://evil.test'),cfg),false);
assert.equal(originAllowed(req('127.0.0.1:2999','http://user@localhost:2999'),cfg),false);
assert.equal(bearerAllowed(req('localhost',null,'Bearer abc'),'abc'),true);
assert.equal(bearerAllowed(req('localhost',null,'Bearer abd'),'abc'),false);
console.log('PASS security boundary: strict host/origin parsing and bearer comparison');
