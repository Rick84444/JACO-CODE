import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStartupServices, optionalStartupService } from './local-stack.mjs';
const ready = id => ({ id, state: 'READY' });
const failed = id => ({ id, state: 'UNAVAILABLE' });
const core = ['runtime', 'workplace', 'seer', 'nova-supervisor', 'nova-session'].map(ready);
test('optional helper failure does not block core', () => {
  for (const id of ['remote', 'a2a', 'novaBridge', 'cdp', 'gateway', 'tunnel']) {
    assert.equal(optionalStartupService(id), true);
    assert.equal(classifyStartupServices([...core, failed(id)]), 'DEGRADED');
  }
});
test('required failure and missing core cannot report ready', () => {
  for (const item of core) assert.equal(classifyStartupServices(core.map(s => s.id === item.id ? failed(s.id) : s)), 'BLOCKED');
  assert.equal(classifyStartupServices([ready('remote')]), 'BLOCKED');
  assert.equal(classifyStartupServices([]), 'BLOCKED');
  assert.equal(classifyStartupServices([...core, failed('unknown')]), 'BLOCKED');
  assert.equal(classifyStartupServices(core), 'READY');
});
