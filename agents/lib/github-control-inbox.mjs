import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitControlReceiptPublisher } from './git-control-receipts.mjs';
const execFileAsync = promisify(execFile);
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const API = 'https://api.github.com';
const MARKER = '<!-- jaco-nova-control:v1 -->';
const TITLE_PREFIX = '[JACO NOVA]';
const TERMINAL = new Set(['DONE', 'CANCELLED']);
// Mission-control validation codes: resubmitting the same command can never succeed.
const PERMANENT_MISSION_ERROR = /^(INVALID_[A-Z_]+|GOAL_REQUIRED|IDEMPOTENCY_KEY_REQUIRED|CODING_CONTRACT_REQUIRED|WINDOWS_WMI_REQUIRES_DESKTOP_AGENTOS|NOVA_MISSION_NOT_FOUND)\b/;

export function createGithubNovaControlInbox({
  missionClient,
  fetchImpl = globalThis.fetch,
  repo = process.env.JACO_GITHUB_CONTROL_REPO || 'Rick84444/jaco-code',
  token = process.env.JACO_GITHUB_CONTROL_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  actor = process.env.JACO_GITHUB_CONTROL_ACTOR || String(repo).split('/')[0],
  pollMs = Number(process.env.JACO_GITHUB_CONTROL_POLL_MS || 15000),
  log = () => {},
  repoRoot = process.env.JACO_REPO_ROOT || DEFAULT_REPO_ROOT,
  gitBin = process.env.JACO_GIT_BIN || 'git',
  gitControlRef = process.env.JACO_GIT_CONTROL_REF || 'refs/heads/jaco-control',
  gitControlLocalRef = process.env.JACO_GIT_NOVA_CONTROL_LOCAL_REF || 'refs/jaco/nova-control',
  gitControlPath = process.env.JACO_GIT_NOVA_CONTROL_PATH || '.jaco/nova-control.json',
  gitExecImpl = execFileAsync,
} = {}) {
  if (!missionClient) throw new Error('GITHUB_CONTROL_MISSION_CLIENT_REQUIRED');
  const [owner, name] = String(repo).split('/');
  const configured = Boolean(owner && name && actor);
  const transport = token ? 'github-api' : 'git-ref';
  const effectivePollMs = token
    ? Math.max(5000, Number.isFinite(pollMs) ? pollMs : 15000)
    : Math.max(30000, Number.isFinite(pollMs) ? pollMs : 30000);
  // One canonical mission inbox. Git without an API token uses a separate
  // status ref for acknowledgements instead of introducing a second server.
  const gitReceiptPublisher = token ? null : createGitControlReceiptPublisher({
    repo, repoRoot, gitBin, gitExecImpl, log,
  });

  async function api(path, options = {}) {
    const response = await fetchImpl(API + path, {
      method: options.method || 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        'user-agent': 'jaco-nova-local-control/1',
        'x-github-api-version': '2022-11-28',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error(`GITHUB_CONTROL_HTTP_${response.status}:${body?.message || 'request failed'}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function ensureState(state) {
    state.githubControl ||= { lastPollAt: 0, issues: {}, lastError: null };
    state.githubControl.issues ||= {};
    return state.githubControl;
  }

  async function readGitControl() {
    await gitExecImpl(gitBin, [
      '-C', repoRoot,
      'fetch', '--quiet', '--no-tags',
      'origin',
      `+${gitControlRef}:${gitControlLocalRef}`,
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const { stdout } = await gitExecImpl(gitBin, [
      '-C', repoRoot,
      'show', `${gitControlLocalRef}:${gitControlPath}`,
    ], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    return String(stdout || '').trim();
  }

  async function listCommands() {
    if (!token) {
      const raw = await readGitControl();
      if (!raw) return [];
      return [{
        number: null,
        title: '[JACO NOVA] Git control ref',
        user: { login: actor },
        body: `${MARKER}\n${raw}`,
        transport: 'git-ref',
      }];
    }

    const params = new URLSearchParams({
      state: 'open',
      creator: actor,
      per_page: '50',
      sort: 'created',
      direction: 'asc',
    });
    const issues = await api(`/repos/${owner}/${name}/issues?${params}`);
    return (Array.isArray(issues) ? issues : []).filter(issue =>
      !issue.pull_request &&
      issue.user?.login === actor &&
      String(issue.title || '').startsWith(TITLE_PREFIX) &&
      String(issue.body || '').includes(MARKER)
    );
  }

  async function postComment(issueNumber, body) {
    if (!token) return null;
    return await api(`/repos/${owner}/${name}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  async function updateComment(commentId, body) {
    if (!token) return null;
    return await api(`/repos/${owner}/${name}/issues/comments/${commentId}`, {
      method: 'PATCH',
      body: { body },
    });
  }

  async function closeIssue(issueNumber) {
    if (!token) return null;
    return await api(`/repos/${owner}/${name}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    });
  }

  function parse(issue) {
    const raw = String(issue.body || '');
    const markerAt = raw.indexOf(MARKER);
    if (markerAt < 0) throw new Error('GITHUB_CONTROL_MARKER_REQUIRED');
    const after = raw.slice(markerAt + MARKER.length);
    const fenced = after.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/i);
    const jsonText = (fenced ? fenced[1] : after).trim();
    if (!jsonText || jsonText.length > 60000) throw new Error('GITHUB_CONTROL_PAYLOAD_INVALID_SIZE');

    let payload;
    try { payload = JSON.parse(jsonText); }
    catch { throw new Error('GITHUB_CONTROL_INVALID_JSON'); }

    if (payload?.schema !== 'jaco.nova-control/v1') throw new Error('GITHUB_CONTROL_SCHEMA_UNSUPPORTED');
    const commandId = String(payload.commandId || '').trim();
    if (!/^[a-zA-Z0-9._:-]{6,160}$/.test(commandId)) throw new Error('GITHUB_CONTROL_COMMAND_ID_INVALID');
    const op = String(payload.op || 'mission.create');

    if (op === 'mission.create') {
      const goal = String(payload.goal || '').trim();
      if (!goal || goal.length > 12000) throw new Error('GITHUB_CONTROL_GOAL_REQUIRED');
      if (payload.executor && payload.executor !== 'nova') throw new Error('GITHUB_CONTROL_EXECUTOR_MUST_BE_NOVA');
      if (payload.allowedTasks !== undefined && !Array.isArray(payload.allowedTasks)) throw new Error('GITHUB_CONTROL_ALLOWED_TASKS_INVALID');
      if (payload.contract !== undefined && (!payload.contract || typeof payload.contract !== 'object' || Array.isArray(payload.contract))) {
        throw new Error('GITHUB_CONTROL_CONTRACT_INVALID');
      }
      return {
        schema: payload.schema,
        commandId,
        op,
        goal,
        ...(payload.contract ? { contract: payload.contract } : {}),
        ...(payload.allowedTasks ? { allowedTasks: payload.allowedTasks.map(String) } : {}),
      };
    }

    if (op === 'mission.resolve') {
      const missionId = String(payload.missionId || '').trim();
      const decision = String(payload.decision || '').trim();
      const note = String(payload.note || '').trim();
      if (!missionId || missionId.length > 200) throw new Error('GITHUB_CONTROL_MISSION_ID_REQUIRED');
      if (!['resume', 'cancel', 'confirm'].includes(decision)) throw new Error('GITHUB_CONTROL_DECISION_INVALID');
      if (!note || note.length > 500) throw new Error('GITHUB_CONTROL_RESOLUTION_NOTE_REQUIRED');
      if (/\[approve-spend\]/i.test(note)) throw new Error('GITHUB_CONTROL_SPEND_APPROVAL_NOT_ALLOWED');
      return { schema: payload.schema, commandId, op, missionId, decision, note };
    }

    throw new Error('GITHUB_CONTROL_OPERATION_UNSUPPORTED');
  }

  function statusText(record, mission) {
    const receipts = Array.isArray(mission?.receipts) ? mission.receipts.length : 0;
    const missing = Array.isArray(mission?.contractStatus?.missing) ? mission.contractStatus.missing : [];
    return [
      '<!-- jaco-nova-local-status:v1 -->',
      '### JACO Nova local',
      `- command: \`${record.commandId}\``,
      `- mission: \`${record.missionId || '-'}\``,
      `- status: **${mission?.status || record.status || 'UNKNOWN'}**`,
      `- phase: \`${mission?.phase || '-'}\``,
      `- turn: ${Number(mission?.turn || 0)}`,
      `- failures: ${Number(mission?.failures || 0)}`,
      `- receipts: ${receipts}`,
      ...(missing.length ? [`- verification missing: ${missing.join(', ')}`] : []),
      '',
      'GitHub is transport only; canonical mission state remains local in JACO.',
    ].join('\n');
  }

  async function submit(command, issue) {
    if (command.op === 'mission.create') {
      return await missionClient.create({
        goal: command.goal,
        idempotencyKey: issue.number == null
          ? `git-control:${repo}:${command.commandId}`
          : `github-control:${repo}#${issue.number}:${command.commandId}`,
        source: issue.number == null ? 'git-control' : 'github-control',
        executor: 'nova',
        ...(command.contract ? { contract: command.contract } : {}),
        ...(command.allowedTasks ? { allowedTasks: command.allowedTasks } : {}),
      });
    }
    return await missionClient.resolve(command.missionId, {
      decision: command.decision,
      note: `github-control:${command.commandId} ${command.note}`,
    });
  }

  async function acceptIssue(issue, control) {
    let command;
    try {
      command = parse(issue);
    } catch (error) {
      const comment = await postComment(issue.number, [
        '<!-- jaco-nova-local-status:v1 -->',
        '### JACO Nova local — REJECTED',
        `- error: \`${String(error.message || error).slice(0, 300)}\``,
      ].join('\n')).catch(() => null);
      control.issues[String(issue.number)] = {
        commandId: null,
        op: 'invalid',
        missionId: null,
        commentId: comment?.id || null,
        status: 'REJECTED',
        closed: true,
      };
      await closeIssue(issue.number).catch(() => {});
      return { accepted: false, issue: issue.number, error: error.message };
    }

    const key = issue.number == null ? `git:${command.commandId}` : String(issue.number);
    if (control.issues[key]?.commandId === command.commandId) {
      return { accepted: false, duplicate: true, issue: issue.number };
    }

    let mission;
    try {
      mission = await submit(command, issue);
    } catch (error) {
      // A validation error will fail identically on every poll; record it once
      // instead of retrying the same command forever. Transient errors still retry.
      if (!PERMANENT_MISSION_ERROR.test(String(error?.message || ''))) throw error;
      const comment = issue.number == null ? null : await postComment(issue.number, [
        '<!-- jaco-nova-local-status:v1 -->',
        '### JACO Nova local — REJECTED',
        `- command: \`${command.commandId}\``,
        `- error: \`${String(error.message).slice(0, 300)}\``,
      ].join('\n')).catch(() => null);
      control.issues[key] = {
        commandId: command.commandId,
        op: command.op,
        missionId: null,
        commentId: comment?.id || null,
        issueNumber: issue.number ?? null,
        transport: issue.number == null ? 'git-ref' : 'github-api',
        status: 'REJECTED',
        error: String(error.message).slice(0, 300),
        closed: true,
      };
      if (issue.number != null) await closeIssue(issue.number).catch(() => {});
      log('warn', `GitHub control rejected ${command.commandId}: ${String(error.message).slice(0, 200)}`);
      return { accepted: false, rejected: true, issue: issue.number ?? null, commandId: command.commandId, error: error.message };
    }

    const record = {
      commandId: command.commandId,
      op: command.op,
      missionId: mission.id,
      commentId: null,
      status: mission.status,
      phase: mission.phase || null,
      closed: false,
    };
    const comment = issue.number == null ? null : await postComment(issue.number, statusText(record, mission));
    record.commentId = comment?.id || null;
    record.issueNumber = issue.number ?? null;
    record.transport = issue.number == null ? 'git-ref' : 'github-api';
    control.issues[key] = record;

    if (TERMINAL.has(String(mission.status))) {
      if (issue.number != null) await closeIssue(issue.number);
      record.closed = true;
    }
    return { accepted: true, issue: issue.number ?? null, missionId: mission.id, op: command.op, transport: record.transport };
  }

  async function refreshTracked(control) {
    const updates = [];
    for (const [issueNumber, record] of Object.entries(control.issues)) {
      if (!record?.missionId || record.closed) continue;
      let mission;
      try { mission = await missionClient.get(record.missionId); }
      catch { continue; }

      const statusChanged =
        mission.status !== record.status ||
        mission.phase !== record.phase ||
        Number(mission.turn || 0) !== Number(record.turn || 0) ||
        Number(mission.failures || 0) !== Number(record.failures || 0) ||
        (Array.isArray(mission.receipts) ? mission.receipts.length : 0) !== Number(record.receipts || 0);

      record.status = mission.status;
      record.phase = mission.phase || null;
      record.turn = Number(mission.turn || 0);
      record.failures = Number(mission.failures || 0);
      record.receipts = Array.isArray(mission.receipts) ? mission.receipts.length : 0;

      if (statusChanged && record.commentId) {
        await updateComment(record.commentId, statusText(record, mission)).catch(() => {});
        updates.push({ issue: record.issueNumber ?? null, missionId: mission.id, status: mission.status });
      }

      if (TERMINAL.has(String(mission.status))) {
        if (record.issueNumber != null) await closeIssue(record.issueNumber).catch(() => {});
        record.closed = true;
      }
    }
    return updates;
  }

  return {
    enabled: configured,
    repo,
    actor,
    pollMs: effectivePollMs,
    transport,
    writeback: token ? 'github' : 'git-ref-when-authorized',

    async poll(state, { force = false } = {}) {
      const control = ensureState(state);
      if (!configured) return { enabled: false, accepted: [], updates: [] };
      const now = Date.now();
      if (!force && now - Number(control.lastPollAt || 0) < this.pollMs) {
        return { enabled: true, skipped: true, accepted: [], updates: [] };
      }
      control.lastPollAt = now;

      try {
        const updates = await refreshTracked(control);
        const issues = await listCommands();
        const accepted = [];
        for (const issue of issues) {
          let commandId = null;
          if (issue.number == null) {
            try { commandId = parse(issue).commandId; } catch {}
          }
          const key = issue.number == null && commandId ? `git:${commandId}` : String(issue.number);
          const record = control.issues[key];
          if (record && (record.closed || record.commandId)) continue;
          const result = await acceptIssue(issue, control);
          if (result.accepted) accepted.push(result);
        }
        // Best-effort telemetry: inability to push Git status must never block
        // canonical Nova execution, nor cause duplicate mission creation.
        const statusReceipt = gitReceiptPublisher ? await gitReceiptPublisher.publish(control) : null;
        control.lastError = null;
        if (accepted.length || updates.length || statusReceipt?.sent)
          log('info', `GitHub control: ${accepted.length} command(s), ${updates.length} status update(s), receipt=${statusReceipt?.sent ? 'published' : statusReceipt?.reason || 'local'}`);
        return { enabled: true, accepted, updates, statusReceipt };
      } catch (error) {
        control.lastError = String(error.message || error).slice(0, 500);
        log('warn', `GitHub control poll failed: ${control.lastError}`);
        return { enabled: true, accepted: [], updates: [], error: control.lastError };
      }
    },
  };
}

export const GITHUB_NOVA_CONTROL_MARKER = MARKER;
export const GITHUB_NOVA_CONTROL_TITLE_PREFIX = TITLE_PREFIX;
