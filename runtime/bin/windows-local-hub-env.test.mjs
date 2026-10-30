import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWindowsHubRole } from './windows-local-hub-env.mjs';

test('Windows Sentinel remains local hub despite stale joined-device .env values',()=>{
  const env={
    JACO_HUB_URL:'https://example.invalid',
    JACO_DEVICE_KEY:'sensitive-old-pairing',
    JACO_NOVA_EXECUTOR:'nova@remote',
    JACO_WORKPLACE_SCOPE:'remote',
    JACO_GATEWAY_TOKEN:'secret-not-to-touch',
    JACO_CHROME_PROFILE_DIR:'C:/JACO/Chrome-CDP-agent',
  };
  const result=applyWindowsHubRole(env);
  assert.equal(result.localHub,true);
  assert.equal(env.JACO_HUB_URL,'');
  assert.equal(env.JACO_DEVICE_KEY,'');
  assert.equal(env.JACO_AURA_ONLY_OPERATOR,'1');
  assert.equal(env.JACO_NOVA_EXECUTOR,'nova');
  assert.equal(env.JACO_WORKPLACE_SCOPE,'local');
  assert.equal(env.JACO_AURA_ONLY_OPERATOR,'1');
  assert.equal(env.JACO_GATEWAY_TOKEN,'secret-not-to-touch');
  assert.equal(env.JACO_CHROME_PROFILE_DIR,'C:/JACO/Chrome-CDP-agent');
  assert.equal(Boolean(env.JACO_HUB_URL&&env.JACO_DEVICE_KEY),false);
});

test('an explicit joined-device opt-out is honored without changing pairing state',()=>{
  const env={JACO_WINDOWS_LOCAL_HUB:'0',JACO_HUB_URL:'https://example.invalid',JACO_DEVICE_KEY:'opaque',JACO_NOVA_EXECUTOR:'nova@device'};
  assert.equal(applyWindowsHubRole(env).localHub,false);
  assert.equal(env.JACO_DEVICE_KEY,'opaque');
  assert.equal(env.JACO_HUB_URL,'https://example.invalid');
});

test('default local hub is idempotent and does not create or delete on-disk secrets',()=>{
  const env={JACO_WINDOWS_LOCAL_HUB:'1',JACO_NOVA_EXECUTOR:'nova'};
  assert.equal(applyWindowsHubRole(env).localHub,true);
  assert.equal(applyWindowsHubRole(env).localHub,true);
  assert.equal(env.JACO_WORKPLACE_SCOPE,'local');
  assert.equal(env.JACO_DEVICE_KEY,'');
});
