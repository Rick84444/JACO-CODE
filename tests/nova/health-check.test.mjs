import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-health-test-'));
process.env.NOVA_STATE_DIR = dir;
const { loadState, runHealthCheck } = await import('../../agents/hands-off-agent.mjs');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const workersDown = async () => ({ 'a2a-copywriter': { ok: false, error: 'fetch failed' }, 'a2a-smart-calculator': { ok: false, error: 'fetch failed' } });

// Reproduces 2026-10-31: Core and Workplace were up, every remote skill worker was unreachable,
// and the health-check receipt was rejected (WORKERS_DEGRADED), so the operator could not confirm.
test('health-check passes on a ready local runtime even when remote skill workers are down', async () => {
  const result = await runHealthCheck(loadState(), {
    readCore: async () => 'READY (identity)',
    readServices: async () => ({ substrate: 'REACHABLE (200)', workplace: 'READY (200)', seer: 'READY (200)' }),
    checkWorkers: workersDown,
  });
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
  assert.equal(result.workersHealthy, 0);
  assert.equal(result.workers['a2a-copywriter'].ok, false);
});

test('health-check fails when Core or Workplace is not READY', async () => {
  const result = await runHealthCheck(loadState(), {
    readCore: async () => 'DOWN (fetch failed)',
    readServices: async () => ({ workplace: 'REACHABLE (200)' }),
    checkWorkers: async () => ({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'RUNTIME_SERVICES_DOWN:core,workplace');
});
