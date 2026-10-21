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
      operation: entry.op === 'mission.resolve' ? 'mission.resolve' : 'mission.create',
      missionId: bounded(entry.missionId || '', 200) || null,
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
      const canonical = JSON.stringify(status);
      const digest = createHash('sha256').update(canonical).digest('hex');
      if (digest === lastDigest || digest === control.gitReceiptDigest) return { sent: false, reason: 'unchanged' };
      if (Date.now() < retryAfter) return { sent: false, reason: 'backoff' };

      // Do not let a credential prompt hang Nova's execution loop.
      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
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
        fs.writeFileSync(jsonFile, JSON.stringify({ ...status, publishedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
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
        return { sent: true, branch: STATUS_BRANCH, count: status.entries.length };
      } catch (error) {
        const code = /GIT_CONTROL_[A-Z_]+/.exec(String(error?.message || ''))?.[0] || 'GIT_CONTROL_STATUS_PUSH_UNAVAILABLE';
        control.gitReceiptPushError = code;
        retryAfter = Date.now() + 60_000;
        log('warn', code + '; mission execution continues and status remains local');
        return { sent: false, error: code };
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  };
}
