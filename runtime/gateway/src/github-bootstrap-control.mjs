import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { safeNovaReceiptLines } from './nova-receipt-inspector.mjs';
import { safeAuraAcceptanceLines } from './aura-operator-command.mjs';

const API = 'https://api.github.com';
const MARKER = '<!-- jaco-bootstrap-control:v1 -->';
const TITLE_PREFIX = '[JACO BOOT]';
const AURA_MARKER = '<!-- jaco-aura-control:v1 -->';
const AURA_TITLE_PREFIX = '[JACO AURA]';
const ALLOWED_OPS = new Set(['system.status', 'system.health', 'system.activate', 'system.restart', 'system.update', 'system.nova-receipt']);


// Public GitHub issues are a transport, not a place for diagnostic payloads.
// Only explicit status enums / bounded counters may cross this boundary.
// Aura itself is not separately probed by jaco.activation/v2.
export function safeBootstrapHealthLines(result) {
  if (result?.schema === 'jaco.service-health/v1') {
    const core = result.core?.up === true ? 'UP' : result.core?.up === false ? 'DOWN' : 'UNVERIFIED';
    const workplace = ['RUNNING','DEGRADED','DOWN'].includes(result.workplace?.state)
      ? result.workplace.state : 'UNVERIFIED';
    const nova = ['RUNNING','DEGRADED','DOWN'].includes(result.workplace?.novaState)
      ? result.workplace.novaState : 'UNVERIFIED';
    const overall = ['READY','DEGRADED','DOWN'].includes(result.status) ? result.status : 'UNVERIFIED';
    const startupState = ['READY','DEGRADED','BLOCKED','STARTING'].includes(result.startup?.state)
      ? result.startup.state : 'UNVERIFIED';
    const browserAttachment = ['ATTACHED','FAILED','UNAVAILABLE','PENDING','NOT_REQUIRED'].includes(result.startup?.browserAttachment)
      ? result.startup.browserAttachment : 'UNVERIFIED';
    return ['#### Verified loopback services (allowlisted)',
      '- Core: `' + core + '`',
      '- Workplace: `' + workplace + '`',
      '- Durable Nova: `' + nova + '`',
      '- Aura operator: `NOT_INDEPENDENTLY_PROBED`',
      '- Service health: `' + overall + '`',
      ...(result.startup ? ['- Windows startup: `' + startupState + '`',
        '- Browser attachment: `' + browserAttachment + '`'] : []),
    ];
  }
  if (!result || result.schema !== 'jaco.activation/v2') return [];
  const core = result.runtime?.up === true ? 'UP' : result.runtime?.up === false ? 'DOWN' : 'UNVERIFIED';
  const workplace = result.workplace?.required === false ? 'NOT_REQUIRED'
    : result.workplace?.up === false ? 'DOWN'
    : result.workplace?.up === true && result.workplace?.state === 'RUNNING' ? 'RUNNING'
    : result.workplace?.up === true ? 'DEGRADED' : 'UNVERIFIED';
  const nova = result.workplace?.required === false ? 'NOT_REQUIRED'
    : result.workplace?.novaState === 'RUNNING' ? 'RUNNING'
    : result.workplace?.up === false ? 'DOWN'
    : result.workplace?.novaState ? 'DEGRADED' : 'UNVERIFIED';
  const planner = result.planner?.reachable === true ? 'REACHABLE'
    : result.planner?.reachable === false ? 'UNREACHABLE' : 'UNVERIFIED';
  const count = Number.isSafeInteger(result.tools?.toolCount) && result.tools.toolCount >= 0 && result.tools.toolCount <= 100000
    ? String(result.tools.toolCount) : 'UNVERIFIED';
  const overall = result.ok === true ? 'READY' : 'DEGRADED';
  const startupState = ['READY', 'DEGRADED', 'BLOCKED', 'STARTING'].includes(result.startup?.state)
    ? result.startup.state : 'UNVERIFIED';
  const browserAttachment = ['ATTACHED', 'FAILED', 'UNAVAILABLE', 'PENDING', 'NOT_REQUIRED'].includes(result.startup?.browserAttachment)
    ? result.startup.browserAttachment : 'UNVERIFIED';
  const startupPhase = ['preflight', 'browser-attachment', 'complete', 'other'].includes(result.startup?.phase)
    ? result.startup.phase : 'UNVERIFIED';
  return [
    '#### Verified service signals (allowlisted)',
    '- Core: `' + core + '`',
    '- Workplace: `' + workplace + '`',
    '- Durable Nova: `' + nova + '`',
    '- Aura operator: `NOT_INDEPENDENTLY_PROBED`',
    '- Selected planner: `' + planner + '`',
    '- Active tools: `' + count + '`',
    '- End-to-end activation: `' + overall + '`',
    ...(result.startup ? [
      '- Windows startup: `' + startupState + '`',
      '- Browser attachment: `' + browserAttachment + '`',
      '- Startup phase: `' + startupPhase + '`',
    ] : []),
    '',
    'These signals come from the local activation report, not from Cloudflare tunnel status.',
  ];
}

export function createGithubBootstrapControl({
  system,
  fetchImpl = globalThis.fetch,
  enabled = process.env.JACO_GITHUB_BOOTSTRAP_ENABLE === '1',
  repo = process.env.JACO_GITHUB_BOOTSTRAP_REPO || process.env.JACO_GITHUB_CONTROL_REPO || 'Rick84444/jaco-code',
  token = process.env.JACO_GITHUB_BOOTSTRAP_TOKEN || process.env.JACO_GITHUB_CONTROL_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  actor = process.env.JACO_GITHUB_BOOTSTRAP_ACTOR || process.env.JACO_GITHUB_CONTROL_ACTOR || String(repo).split('/')[0],
  pollMs = Number(process.env.JACO_GITHUB_BOOTSTRAP_POLL_MS || 15000),
  stateFile = process.env.JACO_GITHUB_BOOTSTRAP_STATE_FILE || join(homedir(), '.config', 'jaco', 'github-bootstrap-state.json'),
  gitControlRef = process.env.JACO_GIT_BOOTSTRAP_REF || 'refs/heads/jaco-control',
  gitControlLocalRef = process.env.JACO_GIT_BOOTSTRAP_LOCAL_REF || 'refs/jaco/bootstrap-control',
  gitControlPath = process.env.JACO_GIT_BOOTSTRAP_PATH || '.jaco/bootstrap-control.json',
  gitReadImpl = null,
  auraReadinessTimeoutMs = Number(process.env.JACO_AURA_READINESS_TIMEOUT_MS || 180000),
  now = () => Date.now(),
} = {}) {
  if (!system) throw new Error('GITHUB_BOOTSTRAP_SYSTEM_REQUIRED');
  // commandId -> first poll that found Aura's ingress not ready. In memory only: nothing was journaled
  // or created, so a Sentinel restart simply starts the bounded wait again.
  const auraNotReadySince = new Map();
  const [owner, name] = String(repo).split('/');
  const configured = Boolean(enabled && owner && name && actor);
  const loadState = () => {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
      return {
        handled: Array.isArray(parsed?.handled) ? parsed.handled.map(String) : [],
        lastPollAt: parsed?.lastPollAt || null,
        lastProcessed: parsed?.lastProcessed || null,
        lastError: parsed?.lastError || null,
      };
    } catch {
      return { handled: [], lastPollAt: null, lastProcessed: null, lastError: null };
    }
  };
  const durable = loadState();
  const handled = new Set(durable.handled);
  const persistState = () => {
    mkdirSync(dirname(stateFile), { recursive: true });
    const temp = stateFile + '.tmp.' + process.pid;
    writeFileSync(temp, JSON.stringify({
      schema: 'jaco.bootstrap-state/v1',
      handled: [...handled].slice(-500),
      lastPollAt: durable.lastPollAt,
      lastProcessed: durable.lastProcessed,
      lastError: durable.lastError,
    }, null, 2), { mode: 0o600 });
    renameSync(temp, stateFile);
  };
  const remember = key => { handled.add(String(key)); persistState(); };
  const transport = token ? 'github-api' : 'git-ref';
  const effectivePollMs = token
    ? Math.max(5000, Number.isFinite(pollMs) ? pollMs : 15000)
    : Math.max(30000, Number.isFinite(pollMs) ? pollMs : 30000);
  let inFlight = false;

  async function api(path, options = {}) {
    const response = await fetchImpl(API + path, {
      method: options.method || 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        'user-agent': 'jaco-sentinel-bootstrap/1',
        'x-github-api-version': '2022-11-28',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 500) }; }
    if (!response.ok) throw new Error(`GITHUB_BOOTSTRAP_HTTP_${response.status}:${body?.message || 'request failed'}`);
    return body;
  }

  function parse(issue) {
    const raw = String(issue.body || '');
    const auraCommand = String(issue.title || '').startsWith(AURA_TITLE_PREFIX);
    const marker = auraCommand ? AURA_MARKER : MARKER;
    const markerAt = raw.indexOf(marker);
    if (markerAt < 0) throw new Error('GITHUB_BOOTSTRAP_MARKER_REQUIRED');
    const after = raw.slice(markerAt + marker.length);
    const fenced = after.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/i);
    const jsonText = (fenced ? fenced[1] : after).trim();
    let payload;
    try { payload = JSON.parse(jsonText); } catch { throw new Error('GITHUB_BOOTSTRAP_INVALID_JSON'); }
    if (auraCommand) {
      if (payload?.schema !== 'jaco.aura-command/v1' || payload?.op !== 'aura.acceptance')
        throw new Error('GITHUB_AURA_OPERATION_UNSUPPORTED');
      if (Object.keys(payload).some(k => !['schema','commandId','op'].includes(k)))
        throw new Error('GITHUB_AURA_FIELDS_UNSUPPORTED');
    } else if (payload?.schema !== 'jaco.bootstrap-control/v1') {
      throw new Error('GITHUB_BOOTSTRAP_SCHEMA_UNSUPPORTED');
    }
    const commandId = String(payload.commandId || '').trim();
    if (!/^[a-zA-Z0-9._:-]{6,160}$/.test(commandId)) throw new Error('GITHUB_BOOTSTRAP_COMMAND_ID_INVALID');
    const op = String(payload.op || '').trim();
    if (auraCommand ? op !== 'aura.acceptance' : !ALLOWED_OPS.has(op))
      throw new Error('GITHUB_BOOTSTRAP_OPERATION_UNSUPPORTED');
    if (op === 'system.nova-receipt') {
      const goalSha256 = String(payload.goalSha256 || '').trim();
      if (!/^[a-f0-9]{64}$/.test(goalSha256)) throw new Error('GITHUB_BOOTSTRAP_GOAL_SHA256_INVALID');
      return { commandId, op, goalSha256 };
    }
    return { commandId, op };
  }

  async function readGitControl() {
    if (gitReadImpl) return gitReadImpl({ gitControlRef, gitControlLocalRef, gitControlPath });
    if (!system?.runFile || !system?.repoRoot) throw new Error('GIT_BOOTSTRAP_SYSTEM_GIT_UNAVAILABLE');
    const gitBin = system.gitBin || 'git';
    await system.runFile(gitBin, [
      '-C', system.repoRoot,
      'fetch', '--quiet', '--no-tags',
      'origin',
      `+${gitControlRef}:${gitControlLocalRef}`,
    ]);
    // A control branch may legitimately exist without a bootstrap instruction.
    // Distinguish an absent file from a failed Git fetch, missing ref or bad payload:
    // only the absent file is a quiet no-op; everything else still fails closed.
    const { stdout: entries } = await system.runFile(gitBin, [
      '-C', system.repoRoot,
      'ls-tree', '--name-only', gitControlLocalRef, '--', gitControlPath,
    ]);
    if (!String(entries || '').split(/\r?\n/).includes(gitControlPath)) return '';
    const { stdout } = await system.runFile(gitBin, [
      '-C', system.repoRoot,
      'show', `${gitControlLocalRef}:${gitControlPath}`,
    ]);
    return String(stdout || '').trim();
  }

  async function listCommands() {
    if (!token) {
      const raw = await readGitControl();
      if (!raw) return [];
      return [{
        number: null,
        title: '[JACO BOOT] Git control ref',
        user: { login: actor },
        body: `${MARKER}\n${raw}`,
        transport: 'git-ref',
      }];
    }

    const params = new URLSearchParams({
      state: 'open',
      creator: actor,
      per_page: '30',
      sort: 'created',
      direction: 'asc',
    });
    const issues = await api(`/repos/${owner}/${name}/issues?${params}`);
    return (Array.isArray(issues) ? issues : []).filter(issue =>
      !issue.pull_request &&
      issue.user?.login === actor &&
      ((String(issue.title || '').startsWith(TITLE_PREFIX) && String(issue.body || '').includes(MARKER)) ||
       (String(issue.title || '').startsWith(AURA_TITLE_PREFIX) && String(issue.body || '').includes(AURA_MARKER)))
    );
  }

  async function comment(issueNumber, lines) {
    if (!token) return null;
    return api(`/repos/${owner}/${name}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: { body: lines.join('\n') },
    });
  }

  async function close(issueNumber) {
    if (!token) return null;
    return api(`/repos/${owner}/${name}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    });
  }

  async function execute(command) {
    if (command.op === 'aura.acceptance') return system.startAuraAcceptance();
    if (command.op === 'system.status') return system.status();
    if (command.op === 'system.health') return system.health();
    if (command.op === 'system.nova-receipt') return system.verifyNovaMission(command.goalSha256);
    if (command.op === 'system.activate') return system.activate('full', { fromMcp: false });
    if (command.op === 'system.restart') return system.restart({ fromMcp: false });
    if (command.op === 'system.update') return system.update({ fromMcp: false });
    throw new Error('GITHUB_BOOTSTRAP_OPERATION_UNSUPPORTED');
  }

  async function pollOnce() {
    if (!configured || inFlight) return { enabled: configured, processed: [] };
    inFlight = true;
    const processed = [];
    durable.lastPollAt = new Date().toISOString();
    durable.lastError = null;
    persistState();
    try {
      const issues = await listCommands();
      for (const issue of issues) {
        let command;
        try { command = parse(issue); }
        catch (error) {
          durable.lastProcessed = {
            at: new Date().toISOString(),
            issue: issue.number ?? null,
            commandId: null,
            op: null,
            status: 'REJECTED',
          };
          remember(issue.number == null ? `invalid:${String(issue.body || '').slice(0, 160)}` : `issue:${issue.number}`);
          await comment(issue.number, [
            '<!-- jaco-bootstrap-status:v1 -->',
            '### JACO Sentinel bootstrap — REJECTED',
            `- error: \`${String(error?.message || error).slice(0, 300)}\``,
          ]).catch(() => {});
          if (issue.number != null) await close(issue.number).catch(() => {});
          processed.push({ issue: issue.number, status: 'REJECTED' });
          continue;
        }
        if (handled.has(command.commandId)) continue;

        // Sentinel starts before the stack at Windows sign-in. An Aura goal taken while Core or SEER is
        // still starting failed and could never be retried (2026-10-30, issue #81). Leave the issue
        // untouched until the ingress answers; only a bounded timeout ends it, as NOT_READY.
        if (command.op === 'aura.acceptance' && typeof system.auraReady === 'function') {
          const ready = await system.auraReady().catch(() => false);
          if (!ready) {
            const since = auraNotReadySince.get(command.commandId) ?? now();
            auraNotReadySince.set(command.commandId, since);
            if (now() - since < auraReadinessTimeoutMs) {
              processed.push({ issue: issue.number, status: 'WAITING' });
              continue;
            }
            auraNotReadySince.delete(command.commandId);
            // No goal was created, so recording the command cannot hide a duplicate; it stops repeats.
            remember(command.commandId);
            durable.lastProcessed = { at: new Date().toISOString(), issue: issue.number ?? null, commandId: command.commandId, op: command.op, status: 'NOT_READY' };
            persistState();
            if (issue.number != null) {
              await comment(issue.number, [
                '<!-- jaco-bootstrap-status:v1 -->',
                '### JACO Sentinel bootstrap — NOT_READY',
                `- command: \`${command.commandId}\``,
                `- operation: \`${command.op}\``,
                `- Aura ingress (Core and SEER) did not become ready within ${Math.round(auraReadinessTimeoutMs / 1000)} s. No goal was created; send a new command ID.`,
              ]).catch(() => {});
              await close(issue.number).catch(() => {});
            }
            processed.push({ issue: issue.number, status: 'NOT_READY' });
            continue;
          }
          auraNotReadySince.delete(command.commandId);
        }

        try {
          if (issue.number != null) {
            await comment(issue.number, [
              '<!-- jaco-bootstrap-status:v1 -->',
              '### JACO Sentinel bootstrap',
              `- command: \`${command.commandId}\``,
              `- operation: \`${command.op}\``,
              '- status: **RUNNING**',
            ]);
          }
          // Aura goals mutate durable strategic state. Journal the command BEFORE
          // invoking the local operator route so a crash cannot replay it.
          // A missing response is UNKNOWN, never an invitation to retry.
          if (command.op === 'aura.acceptance') remember(command.commandId);
          const result = await execute(command);
          const reported = result?.schema === 'jaco.aura-operator-command/v1'
            ? (result.status === 'ACCEPTED' ? 'ACCEPTED' : 'UNVERIFIED')
            : result?.schema === 'jaco.nova-receipt-summary/v1'
            ? (result.matched === true ? 'OBSERVED' : 'DEGRADED')
            : result?.schema === 'jaco.activation/v2'
            ? (result.ok === true ? 'READY' : 'DEGRADED')
            : result?.error ? 'DEGRADED'
            : result?.state || result?.status || (command.op === 'system.status' ? 'OBSERVED' : 'READY');
          // The issue is public: an untrusted runtime status must never become free-form text.
          const state = ['READY', 'RUNNING', 'DEGRADED', 'FAILED', 'OBSERVED', 'UPDATED', 'ACCEPTED'].includes(reported)
            ? reported : 'UNVERIFIED';
          const healthLines = result?.schema === 'jaco.aura-operator-command/v1'
            ? safeAuraAcceptanceLines(result)
            : result?.schema === 'jaco.nova-receipt-summary/v1'
            ? safeNovaReceiptLines(result) : safeBootstrapHealthLines(result);
          if (issue.number != null) {
            await comment(issue.number, [
              '<!-- jaco-bootstrap-status:v1 -->',
              '### JACO Sentinel bootstrap',
              `- command: \`${command.commandId}\``,
              `- operation: \`${command.op}\``,
              `- status: **${String(state).slice(0, 80)}**`,
              '',
              ...(healthLines.length ? healthLines : ['- Service evidence: `NOT_AVAILABLE` (only command completion was reported).']),
              '',
              'Sentinel executed a fixed JACO lifecycle verb; no arbitrary shell was exposed.',
            ]);
            await close(issue.number);
          }
          durable.lastProcessed = {
            at: new Date().toISOString(),
            issue: issue.number ?? null,
            commandId: command.commandId,
            op: command.op,
            status: String(state),
          };
          remember(command.commandId);
          processed.push({ issue: issue.number, status: String(state) });
        } catch (error) {
          durable.lastError = String(error?.message || error).slice(0, 500);
          durable.lastProcessed = {
            at: new Date().toISOString(),
            issue: issue.number,
            commandId: command.commandId,
            op: command.op,
            status: 'FAILED',
          };
          // A failed activation may already have partially changed the host.
          // Persist the attempted command before network writeback: never auto-retry it.
          remember(command.commandId);
          if (issue.number != null) {
            await comment(issue.number, [
              '<!-- jaco-bootstrap-status:v1 -->',
              '### JACO Sentinel bootstrap — FAILED',
              `- command: \`${command.commandId}\``,
              `- operation: \`${command.op}\``,
              '- error: `TARGET_EXECUTION_FAILED`',
              '- details: available only on the target host; not published to this issue.',
            ]).catch(() => {});
            await close(issue.number).catch(() => {});
          }
          processed.push({ issue: issue.number, status: 'FAILED' });
        }
      }
      return { enabled: configured, processed };
    } catch (error) {
      durable.lastError = String(error?.message || error).slice(0, 500);
      persistState();
      throw error;
    } finally {
      inFlight = false;
    }
  }

  function status() {
    return {
      enabled: configured,
      repo,
      actor,
      pollMs: effectivePollMs,
      transport,
      writeback: token ? 'github' : 'local-only',
      lastPollAt: durable.lastPollAt,
      lastProcessed: durable.lastProcessed,
      lastError: durable.lastError,
    };
  }

  return {
    enabled: configured,
    repo,
    actor,
    pollMs: effectivePollMs,
    pollOnce,
    status,
  };
}
