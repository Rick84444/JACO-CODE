#!/usr/bin/env node
// An idle scheduler must not grow the ledger or rewrite large state files on every tick.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContinuumRuntime } from '../../src/server/continuum/continuumRuntime.mjs';

class NullSessions { async list() { return []; } }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-idle-churn-'));
try {
  const rt = new ContinuumRuntime({ workspaceRoot: root, browserSessions: new NullSessions() });
  rt.scheduler.state.enabled = true;
  // Warm-up: the first ticks register workers and let the future window ingest those registration events.
  await rt.scheduler.tick();
  await rt.scheduler.tick();
  const eventsAfterFirstTick = rt.events.list({ limit: 5000 }).length;
  const hubFile = path.join(rt.root, 'runtime-hub.json');
  const futureFile = path.join(rt.root, 'future-window.json');
  const hubMtime = fs.statSync(hubFile).mtimeMs, futureMtime = fs.statSync(futureFile).mtimeMs;
  await new Promise(r => setTimeout(r, 50));

  for (let i = 0; i < 25; i += 1) await rt.scheduler.tick();

  const idleEvents = rt.events.list({ afterSequence: eventsAfterFirstTick, limit: 5000 });
  const agentUpdates = idleEvents.filter(e => e.type === 'agent.updated');
  assert.equal(agentUpdates.length, 0, `idle ticks re-logged agents ${agentUpdates.length} times`);
  assert.ok(idleEvents.length <= 2, `idle ticks appended ${idleEvents.length} events: ${[...new Set(idleEvents.map(e => e.type))].join(', ')}`);
  assert.equal(fs.statSync(hubFile).mtimeMs, hubMtime, 'hub state rewritten on idle ticks');
  assert.equal(fs.statSync(futureFile).mtimeMs, futureMtime, 'future window rewritten on idle ticks');

  // Liveness still advances in memory and reaches disk on flush.
  const before = rt.hub.listAgents().find(a => a.id === 'jaco-seer').lastHeartbeatAt;
  await new Promise(r => setTimeout(r, 20));
  await rt.scheduler.tick();
  const after = rt.hub.listAgents().find(a => a.id === 'jaco-seer').lastHeartbeatAt;
  assert.ok(after > before);
  rt.hub.flush();
  assert.equal(JSON.parse(fs.readFileSync(hubFile, 'utf8')).agents['jaco-seer'].lastHeartbeatAt, after);

  // A real definition change is still an event.
  rt.hub.registerAgent({ id: 'jaco-seer', name: 'JACO SEER', role: 'seer', capabilities: ['REVIEW'], provider: 'provider-router', model: 'dynamic' }, 'test');
  assert.equal(rt.events.list({ type: 'agent.updated', limit: 10 }).length, 1);

  console.log('CONTINUUM_IDLE_CHURN: PASS (no agent re-logging, no idle rewrites, heartbeat flushed, definition change logged)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
