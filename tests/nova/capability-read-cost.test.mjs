// The operator's capability file is read on every refresh of the Gameboard. Reading it once per task or per tool
// blocked the runtime's event loop for seconds (observed on Windows: ~90% of CPU time in readFileSync), so
// requests timed out and healthy providers were reported unreachable. One answer must cost a bounded number of reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { CapabilityPolicy } from '../../runtime/src/server/capabilities/capabilityPolicy.mjs';
import { StdioMcpHost } from '../../runtime/src/server/mcp/stdioMcpHost.mjs';
import { TASK_FIELDS } from '../../agents/lib/task-fields.mjs';

function capabilityReads(t, run) {
  const original = fs.readFileSync;
  let reads = 0;
  const spy = t.mock.method(fs, 'readFileSync', function (file, ...rest) {
    if (String(file).endsWith('capabilities.json')) reads++;
    return original.call(this, file, ...rest);
  });
  try { return { value: run(), reads }; } finally { spy.mock.restore(); }
}

const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-capability-cost-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('reading one mission reads the capability file once, and still honours a switch turned off', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-capability-cost-'));
  const policy = new CapabilityPolicy(path.join(root, 'capabilities.json'), { taskIds: Object.keys(TASK_FIELDS) });
  policy.update({ tasks: { 'browser-click': false } });
  const bus = new DurableMissionBus(path.join(root, 'bus'));
  // The database must be closed before its folder can be removed on Windows.
  t.after(() => { bus.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const missions = new NovaMissionControl(bus, { capabilities: policy });
  const mission = missions.create({ goal: 'Look at the page', idempotencyKey: 'cost-1' });
  assert.ok(mission.allowedTasks.length > 5);

  const { value, reads } = capabilityReads(t, () => missions.get(mission.id));
  assert.deepEqual(value.allowedTasks, mission.allowedTasks);
  assert.ok(!value.allowedTasks.includes('browser-click'));
  assert.equal(reads, 1);
});

test('MCP status reads the capability file a fixed number of times, however many tools are connected', t => {
  const root = tmp(t);
  const configFile = path.join(root, '.jaco', 'mcp', 'servers.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ servers: { custom: { command: 'node', args: ['server.mjs'] }, shell: { command: 'node', args: ['shell.mjs'] } } }));
  const state = path.join(root, '.jaco', 'state', 'capabilities.json');
  new CapabilityPolicy(state, { taskIds: ['mcp-call', 'mcp-write', 'shell'] }).update({ tasks: { 'mcp-write': false } });
  const host = new StdioMcpHost({ configFile, repoRoot: root, runtimeRoot: root });
  const tools = Array.from({ length: 60 }, (_, i) => ({ name: `tool_${i}`, readOnly: i % 2 === 0 }));
  for (const id of ['custom', 'shell']) host.clients.set(id, { def: host.servers()[id], initialized: true, tools });

  const { value, reads } = capabilityReads(t, () => host.status());
  const custom = value.find(server => server.id === 'custom');
  assert.equal(custom.tools.length, 60);
  assert.ok(custom.tools.filter(tool => !tool.readOnly).every(tool => tool.agentAllowed === false), 'the write switch is honoured');
  assert.ok(reads <= 3, `expected at most one read per switch, got ${reads}`);
});
