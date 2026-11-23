import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { configuration, resolveServicePorts, readResolvedPorts, resolvedPortsFile, ROOT } from '../../agents/lib/local-stack.mjs';

function stack(extra = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-ports-'));
  const env = { JACO_DATA_DIR: dataRoot, JACO_GATEWAY_TOKEN: 'x'.repeat(32), JACO_ENABLE_CDP: '0', ...extra };
  return { dataRoot, config: () => configuration(ROOT, env) };
}
const unreachable = async s => ({ id: s.id, state: 'UNREACHABLE' });
const free = async () => true;

test('a foreign listener moves the service to a free port and never blocks startup', async () => {
  const { config } = stack();
  const c = config();
  const runtimePort = c.ports.runtime;
  const moves = await resolveServicePorts(c, { probe: unreachable, occupied: async p => p === runtimePort, owns: () => false, bindable: free });
  assert.equal(moves.length, 1);
  assert.deepEqual({ service: moves[0].service, from: moves[0].from }, { service: 'runtime', from: runtimePort });
  assert.notEqual(c.ports.runtime, runtimePort);
  assert.equal(c.env.PORT, String(c.ports.runtime));
  assert.equal(c.env.JACO_RUNTIME_URL, `http://127.0.0.1:${c.ports.runtime}`);
  assert.equal(c.env.JACO_BASE_URL, c.env.JACO_RUNTIME_URL);
  assert.equal(new Set(Object.values(c.ports)).size, Object.values(c.ports).length, 'resolved ports stay unique');
});

test('the resolution is persisted and every later process reads the same ports', async () => {
  const { config, dataRoot } = stack();
  const first = config();
  const requested = first.ports.runtime;
  await resolveServicePorts(first, { probe: unreachable, occupied: async p => p === requested, owns: () => false, bindable: free });
  assert.ok(fs.existsSync(resolvedPortsFile(dataRoot)));
  const second = config();
  assert.equal(second.ports.runtime, first.ports.runtime);
  assert.equal(second.env.JACO_RUNTIME_URL, first.env.JACO_RUNTIME_URL);
  assert.equal(second.requestedPorts.runtime, requested);
  assert.equal(readResolvedPorts(dataRoot).runtime.requested, requested);
});

test('an operator who changes the requested port is not overridden by an old resolution', async () => {
  const { config, dataRoot } = stack();
  const first = config();
  await resolveServicePorts(first, { probe: unreachable, occupied: async p => p === first.ports.runtime, owns: () => false, bindable: free });
  const env = { JACO_DATA_DIR: dataRoot, JACO_GATEWAY_TOKEN: 'x'.repeat(32), JACO_ENABLE_CDP: '0', PORT: '3555' };
  assert.equal(configuration(ROOT, env).ports.runtime, 3555);
});

test('healthy and owned listeners keep their ports', async () => {
  const { config } = stack();
  const ready = config();
  const before = { ...ready.ports };
  assert.deepEqual(await resolveServicePorts(ready, { probe: async s => ({ id: s.id, state: 'READY' }), occupied: async () => true, owns: () => false, bindable: free }), []);
  assert.deepEqual(ready.ports, before);
  const owned = config();
  assert.deepEqual(await resolveServicePorts(owned, { probe: unreachable, occupied: async () => true, owns: () => true, bindable: free }), []);
  assert.deepEqual(owned.ports, before);
});

test('candidate ports that are occupied or cannot be bound are skipped', async () => {
  const { config } = stack();
  const c = config();
  const start = c.ports.runtime;
  const moves = await resolveServicePorts(c, { probe: unreachable, occupied: async p => p === start || p === start + 1, owns: () => false, bindable: async p => p !== start + 2 });
  assert.equal(moves[0].to, start + 3);
});

test('a real foreign socket on the runtime port is routed around', async () => {
  const foreign = net.createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => foreign.once('listening', resolve));
  try {
    const port = foreign.address().port;
    const { config } = stack({ PORT: String(port) });
    const c = config();
    assert.equal(c.ports.runtime, port);
    const moves = await resolveServicePorts(c);
    assert.ok(moves.some(m => m.service === 'runtime' && m.from === port && m.to !== port));
    assert.ok(foreign.listening, 'the foreign listener is left running');
  } finally { foreign.close(); }
});
