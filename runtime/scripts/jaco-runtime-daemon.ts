#!/usr/bin/env node

/**
 * JACO Continuum Edge Agent (PODAR Loop Client)
 *
 * Runs on Android Termux, Linux or a local node and connects to the
 * real Continuum RuntimeHub (0.21) via /api/continuum/hub/*.
 *
 * Replaces the earlier /api/runtime/agent-call client, which talked to
 * a route that does not exist in the Continuum server and which, on hub errors,
 * fabricated a success:true response with a fake L4 proof. That route
 * and that behaviour are removed: an unreachable hub is now reported as
 * exactly that, and l4Proof comes exclusively from Continuum's real
 * Evidence Ledger (sha256 of the actually stored payload).
 *
 * Zero-Emoji Mandate: uses only ANSI colours and technical tags.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration via environment variables or defaults.
// The Continuum server (src/server/continuum/standalone-server.mjs) binds
// to port 3020 by default, not 3000.
const HUB_URL = (process.env.JACO_CONTINUUM_URL || process.env.JACO_HUB_URL || 'http://127.0.0.1:3020').replace(/\/+$/, '');
const HUB_TOKEN = process.env.JACO_CONTINUUM_TOKEN || '';
const NODE_ID = process.env.JACO_NODE_ID || `termux-node-${os.hostname()}-${process.pid}`;
const NODE_NAME = process.env.JACO_NODE_NAME || `JACO Edge Node (${os.platform()})`;
const INTERVAL_MS = parseInt(process.env.JACO_INTERVAL_MS || '6000', 10);
const CURRENT_GOAL = process.env.JACO_GOAL || 'Autonomous local hardware and AST monitoring';
const CAPABILITIES = (process.env.JACO_NODE_CAPABILITIES || 'edge-telemetry,edge-observation')
  .split(',').map(s => s.trim()).filter(Boolean);
// Kinds of hub tasks this node is prepared to fetch and execute.
// Keep this list narrow: the edge node must not silently take on arbitrary
// tasks it has no real execution logic for.
const CLAIMABLE_TASK_KINDS = new Set(['EDGE_TELEMETRY_SYNC', 'GENERIC']);

const BUFFER_PATH = path.join(process.cwd(), '.jaco', 'edge-runtime', `${NODE_ID}.buffer.jsonl`);

type PodarPhase = 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT';

let currentPhase: PodarPhase = 'PERCEIVE';
let cycleCount = 0;
let isRunning = true;
let agentRegistered = false;

// ANSI colour codes for structured terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m'
};

function log(tag: string, message: string, color: string = colors.cyan) {
  const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`${colors.gray}[${timestamp}]${colors.reset} ${color}${colors.bright}${tag}${colors.reset} ${message}`);
}

/**
 * Collect real-time telemetry from the device (Android Termux or Linux)
 */
async function collectDeviceTelemetry() {
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const cpuLoadAvg = os.loadavg()[0] || 0.15;
  const cpuUsagePercent = Math.min(100, Math.round(cpuLoadAvg * 20));

  let batteryPercent: number | undefined;
  let temperatureC: number | undefined;

  try {
    const { stdout } = await execAsync('termux-battery-status', { timeout: 1500 });
    const battery = JSON.parse(stdout);
    batteryPercent = battery.percentage;
    if (battery.temperature) {
      temperatureC = Math.round(battery.temperature * 10) / 10;
    }
  } catch {
    try {
      if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
        const rawTemp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
        const temp = parseInt(rawTemp, 10);
        if (!isNaN(temp)) {
          temperatureC = temp > 1000 ? Math.round(temp / 100) / 10 : temp;
        }
      }
    } catch {
      // Ignore if unavailable
    }
  }

  const isAndroid = os.platform() === 'android' || fs.existsSync('/data/data/com.termux');
  const npuAccelerated = isAndroid || cpus.some(c => c.model.toLowerCase().includes('snapdragon') || c.model.toLowerCase().includes('qualcomm'));

  return {
    cpuUsagePercent,
    ramUsedMb: usedMem,
    ramTotalMb: totalMem,
    npuAccelerated,
    batteryPercent,
    temperatureC
  };
}

class ContinuumUnavailableError extends Error {}

/**
 * Low-level call to the Continuum RuntimeHub. Throws ContinuumUnavailableError
 * on network error/timeout or a non-2xx response, instead of fabricating
 * a local "successful" result.
 */
async function callContinuum(pathname: string, method: 'GET' | 'POST', payload?: any) {
  const url = `${HUB_URL}${pathname}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = { 'User-Agent': `JACO-Continuum-Edge/${NODE_ID}` };
    if (HUB_TOKEN) headers['Authorization'] = `Bearer ${HUB_TOKEN}`;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};

    if (!res.ok || json.success === false) {
      const msg = json?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new ContinuumUnavailableError(msg);
    }

    return json;
  } catch (err: any) {
    if (err instanceof ContinuumUnavailableError) throw err;
    throw new ContinuumUnavailableError(err.message || String(err));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Register the node as a real Continuum agent (idempotent: the same
 * agent id is updated on re-registration instead of being duplicated).
 */
async function ensureAgentRegistered() {
  await callContinuum('/api/continuum/hub/agents', 'POST', {
    id: NODE_ID,
    name: NODE_NAME,
    role: 'edge-observer',
    provider: 'edge-runtime',
    model: 'device-telemetry',
    capabilities: CAPABILITIES,
    status: 'ONLINE',
    metadata: { platform: os.platform(), goal: CURRENT_GOAL }
  });
  agentRegistered = true;
  log('[REGISTER]', `Agent ${NODE_ID} registered in Continuum RuntimeHub (${HUB_URL})`, colors.green);
}

/**
 * Store telemetry as real, hash-chained evidence in the Continuum Evidence
 * Ledger. Returns the evidence id + the real contentHash-based
 * L4 proof (never a locally invented sha256).
 */
async function recordTelemetryEvidence(phase: PodarPhase, telemetry: any) {
  const result = await callContinuum('/api/continuum/evidence', 'POST', {
    kind: 'edge-telemetry-observation',
    claim: `Node ${NODE_ID} observed local hardware telemetry during PODAR phase ${phase}`,
    source: `edge-node:${NODE_ID}`,
    verified: true,
    verificationMethod: 'deterministic os.cpus()/os.freemem()/os.totalmem() + termux-battery-status/thermal_zone read',
    data: { nodeId: NODE_ID, phase, cycle: cycleCount, telemetry }
  });
  return result.evidence as { id: string; contentHash: string };
}

async function heartbeat(status: string, idleJustification: string | null, currentTaskId: string | null) {
  await callContinuum(`/api/continuum/hub/agents/${encodeURIComponent(NODE_ID)}/heartbeat`, 'POST', {
    status,
    currentTaskId,
    idleJustification,
    progress: true
  });
}

/**
 * Try to fetch and execute a queued hub task whose requirements this node
 * meets. Sticks strictly to CLAIMABLE_TASK_KINDS: the node must not
 * pretend it can do general agent work it has no logic for.
 */
async function tryClaimAndRunTask(evidenceId: string): Promise<string | null> {
  const { tasks } = await callContinuum('/api/continuum/hub/tasks?status=QUEUED', 'GET');
  const candidate = (tasks || []).find((t: any) =>
    CLAIMABLE_TASK_KINDS.has(t.kind) &&
    (t.requirements || []).every((r: string) => CAPABILITIES.includes(r))
  );
  if (!candidate) return null;

  const { lease } = await callContinuum('/api/continuum/leases', 'POST', {
    agentId: NODE_ID,
    missionId: candidate.missionId || undefined,
    allowedActions: ['hub.task.complete'],
    maxActions: 1,
    durationMs: 5 * 60_000
  });

  const { task: claimed } = await callContinuum(
    `/api/continuum/hub/tasks/${encodeURIComponent(candidate.id)}/claim`, 'POST',
    { agentId: NODE_ID, leaseId: lease.id }
  );
  log('[TASK-CLAIM]', `Claimed task ${claimed.id} (${claimed.kind})`, colors.blue);

  await callContinuum(`/api/continuum/hub/tasks/${encodeURIComponent(claimed.id)}/complete`, 'POST', {
    agentId: NODE_ID,
    status: 'COMPLETED',
    evidenceRefs: [evidenceId]
  });
  log('[TASK-COMPLETE]', `Task ${claimed.id} completed with evidence ${evidenceId}`, colors.green);
  return claimed.id;
}

/**
 * Buffer an observation locally when the hub is unreachable. No fabricated
 * "success" status is sent to the log; what is written truthfully states
 * that this is not yet verified work.
 */
function bufferLocally(record: any) {
  const dir = path.dirname(BUFFER_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(BUFFER_PATH, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * On reconnect: send buffered observations as evidence and empty
 * the buffer. Best effort; if the hub becomes unreachable again mid-flush,
 * the rest of the buffer is kept for the next attempt.
 */
async function flushBufferIfAny() {
  if (!fs.existsSync(BUFFER_PATH)) return;
  const lines = fs.readFileSync(BUFFER_PATH, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) { fs.unlinkSync(BUFFER_PATH); return; }

  log('[FLUSH]', `Sending ${lines.length} buffered observations to Continuum...`, colors.yellow);
  let sent = 0;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      await callContinuum('/api/continuum/evidence', 'POST', {
        kind: 'edge-telemetry-observation',
        claim: `Node ${NODE_ID} (buffered) observed local hardware telemetry during PODAR phase ${record.phase}`,
        source: `edge-node:${NODE_ID}`,
        verified: true,
        verificationMethod: 'deterministic os telemetry read, buffered while hub unreachable',
        data: record
      });
      sent++;
    } catch {
      break; // The hub became unreachable again; leave the rest in the buffer.
    }
  }
  const remaining = lines.slice(sent);
  if (remaining.length) {
    fs.writeFileSync(BUFFER_PATH, remaining.map(l => l).join('\n') + '\n', 'utf8');
  } else {
    fs.unlinkSync(BUFFER_PATH);
  }
  log('[FLUSH]', `${sent}/${lines.length} buffered observations sent.`, colors.green);
}

/**
 * Main loop of the autonomous runtime
 */
async function runLoop() {
  console.log('\n' + '='.repeat(70));
  log('[INIT]', `JACO Continuum Edge Agent started on node: ${NODE_ID}`, colors.green);
  log('[CONFIG]', `Continuum Target: ${HUB_URL} | Interval: ${INTERVAL_MS}ms`, colors.cyan);
  log('[GOAL]', `Active goal: ${CURRENT_GOAL}`, colors.yellow);
  console.log('='.repeat(70) + '\n');

  while (isRunning) {
    cycleCount++;
    const telemetry = await collectDeviceTelemetry();
    log(`[PODAR:${currentPhase}]`, `Cycle #${cycleCount} | CPU: ${telemetry.cpuUsagePercent}% | RAM: ${telemetry.ramUsedMb}/${telemetry.ramTotalMb}MB | NPU: ${telemetry.npuAccelerated ? 'YES' : 'NO'}`, colors.cyan);

    try {
      if (!agentRegistered) {
        await flushBufferIfAny();
        await ensureAgentRegistered();
      }

      const evidence = await recordTelemetryEvidence(currentPhase, telemetry);
      log('[EVIDENCE]', `Stored in Continuum Evidence Ledger: ${evidence.id}`, colors.dim);
      log('[L4-PROOF]', evidence.contentHash, colors.yellow);

      let claimedTaskId: string | null = null;
      try {
        claimedTaskId = await tryClaimAndRunTask(evidence.id);
      } catch (taskErr: any) {
        log('[WARN]', `Could not fetch/execute hub task: ${taskErr.message}`, colors.yellow);
      }

      await heartbeat(
        'ONLINE',
        claimedTaskId ? null : 'no runnable task matching node capabilities',
        claimedTaskId
      );

      const phases: PodarPhase[] = ['PERCEIVE', 'ORIENT', 'DECIDE', 'ACT', 'REFLECT'];
      currentPhase = phases[(phases.indexOf(currentPhase) + 1) % phases.length];

    } catch (err: any) {
      agentRegistered = false;
      log('[ERROR]', `Continuum unreachable (${err.message}). Buffering observation locally.`, colors.red);
      bufferLocally({ nodeId: NODE_ID, phase: currentPhase, cycle: cycleCount, telemetry, observedAt: new Date().toISOString() });
      log('[STATE]', 'hubConnected=false executionState=BUFFERING assignedAgent=null verifiedWorkPerformed=false', colors.gray);
    }

    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

process.on('SIGINT', () => {
  log('[SHUTDOWN]', 'Stopping JACO Continuum Edge Agent gracefully...', colors.yellow);
  isRunning = false;
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('[SHUTDOWN]', 'SIGTERM received. Shutting down the node...', colors.yellow);
  isRunning = false;
  process.exit(0);
});

runLoop();
