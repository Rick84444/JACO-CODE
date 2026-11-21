// Git transport for Nova control receipts: no REST API or extra model/provider key.
// Uses the repo's existing Git credentials for optional response publication.
// A temporary Git index is used; no checkout and no edits to the user's files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const STATUS_BRANCH = 'refs/heads/jaco-control-status';
const STATUS_LOCAL_REF = 'refs/jaco/nova-control-status';
const STATUS_PATH = '.jaco/nova-status.json';
const ERROR_CODES = new Set([
  'GITHUB_CONTROL_MARKER_REQUIRED','GITHUB_CONTROL_PAYLOAD_INVALID_SIZE',
  'GITHUB_CONTROL_INVALID_JSON','GITHUB_CONTROL_SCHEMA_UNSUPPORTED',
  'GITHUB_CONTROL_COMMAND_ID_INVALID','GITHUB_CONTROL_GOAL_REQUIRED',
  'GITHUB_CONTROL_EXECUTOR_MUST_BE_NOVA','GITHUB_CONTROL_ALLOWED_TASKS_INVALID',
  'GITHUB_CONTROL_CONTRACT_INVALID','GITHUB_CONTROL_MISSION_ID_REQUIRED',
  'GITHUB_CONTROL_DECISION_INVALID','GITHUB_CONTROL_RESOLUTION_NOTE_REQUIRED',
  'GITHUB_CONTROL_SPEND_APPROVAL_NOT_ALLOWED','GITHUB_CONTROL_OPERATION_UNSUPPORTED',
  'INVALID_MISSION_ALLOWED_TASKS','GOAL_REQUIRED','IDEMPOTENCY_KEY_REQUIRED',
  'CODING_CONTRACT_REQUIRED','NOVA_MISSION_NOT_FOUND',
  'CHATGPT_STRATEGY_OPERATOR_OPT_IN_REQUIRED','CHATGPT_STRATEGY_TASK_POLICY_INVALID',
  'CHATGPT_STRATEGY_CODE_SCOPE_NOT_CONFIGURED','CHATGPT_STRATEGY_CODE_SCOPE_DENIED',
  'CHATGPT_STRATEGY_NODE_CODING_CONTRACT_REQUIRED','CHATGPT_STRATEGY_CONTRACT_NOT_AUTHORIZED',
  'CHATGPT_STRATEGY_GIT_REF_REQUIRED','CHATGPT_STRATEGY_GRAPH_CYCLE',
  'CHATGPT_STRATEGY_NODE_COUNT_INVALID','CHATGPT_STRATEGY_TEST_COMMAND_NOT_APPROVED',
  'CHATGPT_STRATEGY_BUDGET_INVALID','CHATGPT_STRATEGY_GRAPH_NOT_FOUND',
  'WINDOWS_WMI_REQUIRES_DESKTOP_AGENTOS',
]);

const bounded = (value, max = 160) => String(value ?? '').slice(0, max);
const digits = value => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;

export function gitControlReceiptSnapshot(control) {
  const records = Object.values(control?.issues || {})
    .filter(entry => entry?.transport === 'git-ref' && /^[A-Za-z0-9._:-]{6,160}$/.test(String(entry.commandId || '')))
    .slice(-32);
  return {
    schema: 'jaco.nova-control-status/v1',
    transport: 'git-ref',
    // A status index, NOT proof of completion or an approval.
    authoritative: false,
    entries: records.map(entry => ({
      commandId: bounded(entry.commandId),
      operation: entry.op === 'invalid' ? 'rejected' : entry.op === 'strategy.graph.create' ? 'strategy.graph.create' : entry.op === 'mission.resolve' ? 'mission.resolve' : 'mission.create',
      missionId: bounded(entry.missionId || '', 200) || null,
      graphId: bounded(entry.graphId || '', 200) || null,
      errorCode: entry.status === 'REJECTED'
        ? (ERROR_CODES.has(String(entry.error || '')) ? entry.error : 'COMMAND_REJECTED')
        : (entry.status === 'UNVERIFIED' && ERROR_CODES.has(String(entry.error || '')) ? entry.error : null),
      status: bounded(entry.status || 'UNKNOWN', 40),
      phase: bounded(entry.phase || '', 80) || null,
      turn: digits(entry.turn),
      failures: digits(entry.failures),
      receipts: digits(entry.receipts),
      closed: entry.closed === true,
      // No mission goals, browser URLs, paths, screenshots, logs or secrets.
    })),
  };
}

// Git-ref is a legacy, non-authoritative transport. Multiple already-running
// installations may still publish to the same branch during migration. Merge
// bounded receipt indices instead of replacing somebody else's snapshot;
// disagreeing mission IDs are conflicts, never proof of successful execution.
const RECEIPT_ID = /^[A-Za-z0-9._:-]{6,160}$/;
const TERMINAL = new Set(['DONE','CANCELLED','REJECTED','EXHAUSTED']);
const ENTRY_STATES = new Set(['ACTIVE','READY','PLANNING','EXECUTING','AWAITING_VERIFICATION','BLOCKED','DONE','CANCELLED','EXHAUSTED','REJECTED','UNVERIFIED','UNKNOWN','CONFLICT']);
const ENTRY_PHASES = new Set(['READY','PLANNING','EXECUTING','AWAITING_VERIFICATION','BLOCKED','CLOSED','CANCELLED','EXHAUSTED','UNVERIFIED','UNKNOWN']);
const OPERATIONS = new Set(['mission.create','mission.resolve','strategy.graph.create','rejected']);
function safeIndexEntry(e) {
  if (!e || typeof e !== 'object' || !RECEIPT_ID.test(String(e.commandId || '')) ||
      !ENTRY_STATES.has(e.status) || !OPERATIONS.has(e.operation)) return null;
  const validRef = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(v) ? v : null;
  return {
    commandId: e.commandId,
    operation: e.operation,
    missionId: validRef(e.missionId),
    graphId: validRef(e.graphId),
    errorCode: typeof e.errorCode === 'string' && (ERROR_CODES.has(e.errorCode) || e.errorCode === 'GIT_CONTROL_COMMAND_CONFLICT') ? e.errorCode : null,
    status: e.status,
    phase: ENTRY_PHASES.has(e.phase) ? e.phase : null,
    turn: digits(e.turn),
    failures: digits(e.failures),
    receipts: digits(e.receipts),
    closed: e.closed === true,
  };
}
function conflictReceipt(a,b) {
  return {commandId:b.commandId,operation:b.operation,missionId:null,graphId:null,
    errorCode:'GIT_CONTROL_COMMAND_CONFLICT',status:'CONFLICT',phase:null,
    turn:Math.max(a.turn,b.turn),failures:Math.max(a.failures,b.failures),
    receipts:Math.max(a.receipts,b.receipts),closed:false};
}
function reconcileEntry(a,b) {
  if (a.status==='CONFLICT' || b.status==='CONFLICT' || a.operation!==b.operation ||
      (a.missionId && b.missionId && a.missionId!==b.missionId) ||
      (a.graphId && b.graphId && a.graphId!==b.graphId) ||
      ((a.status==='REJECTED' || b.status==='REJECTED') && a.status!==b.status)) {
    return conflictReceipt(a,b);
  }
  // Same canonical mission: never regress a completed receipt to an older
  // ACTIVE status when a stale writer wakes up after the owner finishes.
  const evidence = v => [v.turn,v.receipts,TERMINAL.has(v.status)?1:0];
  const aa=evidence(a),bb=evidence(b);
  const newer=bb[0]>aa[0] || (bb[0]===aa[0] && (bb[1]>aa[1] || (bb[1]===aa[1] && bb[2]>aa[2])));
  const chosen = newer ? b : a;
  return {...chosen,missionId:chosen.missionId || a.missionId || b.missionId,
    graphId:chosen.graphId || a.graphId || b.graphId};
}
export function mergeGitControlReceiptSnapshots(local, remote=null) {
  if(local?.schema!=='jaco.nova-control-status/v1' || local.transport!=='git-ref' ||
     local.authoritative!==false || !Array.isArray(local.entries)) throw Error('GIT_CONTROL_LOCAL_STATUS_INVALID');
  if (remote!==null && (remote?.schema!==local.schema || remote?.transport!=='git-ref' ||
      remote?.authoritative!==false || !Array.isArray(remote?.entries) || remote.entries.length>32))
    throw Error('GIT_CONTROL_REMOTE_STATUS_INVALID');
  const output=new Map();
  // Retain order so trimming protects the most recently observed commands.
  for (const raw of [...(remote?.entries || []),...local.entries]) {
    const e=safeIndexEntry(raw);
    if(!e) throw Error('GIT_CONTROL_REMOTE_STATUS_INVALID');
    const old=output.get(e.commandId);
    if (old) output.delete(e.commandId);
    output.set(e.commandId,old?reconcileEntry(old,e):e);
  }
  return {schema:local.schema,transport:'git-ref',authoritative:false,
    entries:[...output.values()].slice(-32)};
}

export function githubOriginMatches(remote, repo) {
  const match = String(remote || '').trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/:]+)\/([^/:\s]+?)(?:\.git)?\/?$/i);
  if (!match) return false;
  return (match[1] + '/' + match[2]).toLowerCase() === String(repo || '').toLowerCase();
}

export function createGitControlReceiptPublisher({
  repo, repoRoot, gitBin = 'git', gitExecImpl = execFileAsync, log = () => {},
} = {}) {
  let lastDigest = null;
  let retryAfter = 0;
  const git = (args, env, timeout = 20_000) =>
    gitExecImpl(gitBin, ['-C', repoRoot, ...args], {
      timeout, maxBuffer: 1024 * 1024, env,
    });
  return {
    async publish(control) {
      const status = gitControlReceiptSnapshot(control);
      if (!status.entries.length) return { sent: false, reason: 'no-git-commands' };
      if (Date.now() < retryAfter) return { sent: false, reason: 'backoff' };

      // Do not let a credential prompt hang Nova's execution loop.
      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
        // Existing SSH agent credentials work; absent credentials fail quickly, not via prompts.
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -oBatchMode=yes -oConnectTimeout=5',
        GIT_AUTHOR_NAME: 'JACO Git Bridge',
        GIT_AUTHOR_EMAIL: 'jaco-git-bridge@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'JACO Git Bridge',
        GIT_COMMITTER_EMAIL: 'jaco-git-bridge@users.noreply.github.com',
      };
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-git-control-status-'));
      const jsonFile = path.join(temporary, 'status.json');
      env.GIT_INDEX_FILE = path.join(temporary, 'index');
      try {
        const remote = (await git(['remote', 'get-url', 'origin'], env)).stdout.trim();
        if (!githubOriginMatches(remote, repo)) throw new Error('GIT_CONTROL_ORIGIN_MISMATCH');
        const existing = (await git(['ls-remote', '--heads', 'origin', STATUS_BRANCH], env, 15_000)).stdout.trim();
        let parent = null;
        if (existing) {
          if (!/^[0-9a-f]{40,64}\s+refs\/heads\/jaco-control-status$/.test(existing)) throw new Error('GIT_CONTROL_STATUS_REF_INVALID');
          await git(['fetch', '--quiet', '--no-tags', 'origin', '+' + STATUS_BRANCH + ':' + STATUS_LOCAL_REF], env, 30_000);
          parent = (await git(['rev-parse', STATUS_LOCAL_REF], env)).stdout.trim();
        }
        let remoteSnapshot = null;
        if (parent) {
          const {stdout} = await git(['show', STATUS_LOCAL_REF + ':' + STATUS_PATH], env, 15_000);
          try {remoteSnapshot=JSON.parse(stdout);} catch {throw Error('GIT_CONTROL_REMOTE_STATUS_INVALID');}
        }
        const reconciled=mergeGitControlReceiptSnapshots(status, remoteSnapshot);
        const canonical=JSON.stringify(reconciled);
        const digest=createHash('sha256').update(canonical).digest('hex');
        if (remoteSnapshot && JSON.stringify(mergeGitControlReceiptSnapshots(status,remoteSnapshot)) ===
              JSON.stringify({schema:remoteSnapshot.schema,transport:remoteSnapshot.transport,
                authoritative:remoteSnapshot.authoritative,entries:remoteSnapshot.entries})) {
          lastDigest=digest;
          control.gitReceiptDigest=digest;
          return {sent:false,reason:'unchanged'};
        }
        fs.writeFileSync(jsonFile, JSON.stringify({ ...reconciled, publishedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
        const blob = (await git(['hash-object', '-w', jsonFile], env)).stdout.trim();
        if (!/^[0-9a-f]{40,64}$/.test(blob)) throw new Error('GIT_CONTROL_BLOB_INVALID');
        await git(['read-tree', '--empty'], env);
        await git(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + STATUS_PATH], env);
        const tree = (await git(['write-tree'], env)).stdout.trim();
        const args = ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'JACO: bounded Nova receipt status'];
        const commit = (await git(args, env)).stdout.trim();
        if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error('GIT_CONTROL_COMMIT_INVALID');
        // No force push; a concurrent writer cannot be overwritten.
        await git(['push', '--porcelain', 'origin', commit + ':' + STATUS_BRANCH], env, 25_000);
        lastDigest = digest;
        control.gitReceiptDigest = digest;
        control.gitReceiptPushError = null;
        control.gitReceiptPushedAt = new Date().toISOString();
        retryAfter = 0;
        return { sent: true, branch: STATUS_BRANCH, count: reconciled.entries.length };
      } catch (error) {
        const code = /GIT_CONTROL_[A-Z_]+/.exec(String(error?.message || ''))?.[0] || 'GIT_CONTROL_STATUS_PUSH_UNAVAILABLE';
        control.gitReceiptPushError = code;
        retryAfter = Date.now() + 60_000;
        log('warn', code + '; mission execution continues and status remains local');
        return { sent: false, error: code };
      } finally {
        try { fs.rmSync(temporary, { recursive: true, force: true }); }
        catch { log('warn', 'GIT_CONTROL_TEMP_CLEANUP_FAILED'); }
      }
    },
  };
}
