// Tokenless, bounded Git transport for the canonical ChatGPT Workplace agent.
// This is NOT a second agent, a permission grant, or a public export of Workplace data.
// Incoming commands use a dedicated operator-controlled Git ref. Outgoing data
// contains only receipt metadata and content hashes (never Workplace text).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { githubOriginMatches } from '../../../agents/lib/git-control-receipts.mjs';

const execFileAsync = promisify(execFile);
const IN_REMOTE = 'refs/heads/jaco-chatgpt-in';
const IN_LOCAL = 'refs/jaco/chatgpt-in';
const IN_FILE = '.jaco/chatgpt-in.json';
const OUT_REMOTE = 'refs/heads/jaco-chatgpt-out';
const OUT_LOCAL = 'refs/jaco/chatgpt-out';
const OUT_FILE = '.jaco/chatgpt-out.json';
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const oid = value => /^[0-9a-f]{40,64}$/.test(String(value));

export function createGitRefChatGptTransport({
  repo, repoRoot, gitBin = 'git', gitExecImpl = execFileAsync,
} = {}) {
  if (!repo || !repoRoot) throw new Error('CHATGPT_GIT_REPO_REQUIRED');
  let lastDigest = null;
  const env = {
    ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -oBatchMode=yes -oConnectTimeout=5',
    GIT_AUTHOR_NAME: 'JACO ChatGPT Workplace Bridge',
    GIT_AUTHOR_EMAIL: 'jaco-chatgpt-bridge@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'JACO ChatGPT Workplace Bridge',
    GIT_COMMITTER_EMAIL: 'jaco-chatgpt-bridge@users.noreply.github.com',
  };
  const git = (args, options = {}) => gitExecImpl(gitBin, ['-C', repoRoot, ...args], {
    env: { ...env, ...(options.env || {}) },
    timeout: options.timeout || 20000,
    maxBuffer: 1024 * 1024,
  });
  async function assertOrigin() {
    const remote = (await git(['remote', 'get-url', 'origin'])).stdout.trim();
    if (!githubOriginMatches(remote, repo)) throw new Error('CHATGPT_GIT_ORIGIN_MISMATCH');
  }
  return {
    async read() {
      await assertOrigin();
      try {
        await git(['fetch', '--quiet', '--no-tags', 'origin', '+' + IN_REMOTE + ':' + IN_LOCAL], { timeout: 30000 });
      } catch (error) {
        throw new Error('CHATGPT_GIT_INBOUND_REF_UNAVAILABLE', { cause: error });
      }
      const raw = (await git(['show', IN_LOCAL + ':' + IN_FILE])).stdout;
      if (Buffer.byteLength(raw) > 16384) throw new Error('CHATGPT_GIT_INPUT_TOO_LARGE');
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error('CHATGPT_GIT_INPUT_INVALID_JSON');
      }
    },
    async publish({ agentId, receivedId, scannedCursor, events = [] } = {}) {
      await assertOrigin();
      if (!agentId || !receivedId) throw new Error('CHATGPT_GIT_RECEIPT_MISSING_ID');
      const message = {
        schema: 'jaco.chatgpt-workplace-receipt/v1',
        transport: 'git-ref',
        agentId: String(agentId).slice(0, 160),
        receivedId: String(receivedId).slice(0, 160),
        scannedCursor: Math.max(0, Math.trunc(Number(scannedCursor) || 0)),
        // Public Git is NOT a private messaging medium. Never mirror bodies,
        // references, URLs, credentials or raw event IDs into this branch.
        events: events.slice(-24).map(event => ({
          seq: Math.max(0, Math.trunc(Number(event.seq) || 0)),
          kind: String(event.kind || '').slice(0, 24),
          bodySha256: digest(event.body || ''),
        })),
      };
      const signature = digest(JSON.stringify(message));
      if (lastDigest === signature) return { sent: false, reason: 'unchanged' };
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-chatgpt-git-'));
      const indexEnv = { GIT_INDEX_FILE: path.join(temp, 'index') };
      try {
        const list = (await git(['ls-remote', '--heads', 'origin', OUT_REMOTE], { timeout: 15000 })).stdout.trim();
        let parent = null;
        if (list) {
          const pair = list.split(/\s+/);
          if (pair.length !== 2 || !oid(pair[0]) || pair[1] !== OUT_REMOTE)
            throw new Error('CHATGPT_GIT_OUTBOUND_REF_INVALID');
          await git(['fetch', '--quiet', '--no-tags', 'origin', '+' + OUT_REMOTE + ':' + OUT_LOCAL], { timeout: 30000 });
          parent = (await git(['rev-parse', OUT_LOCAL])).stdout.trim();
        }
        const file = path.join(temp, 'receipt.json');
        fs.writeFileSync(file, JSON.stringify({ ...message, publishedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
        const blob = (await git(['hash-object', '-w', file])).stdout.trim();
        if (!oid(blob)) throw new Error('CHATGPT_GIT_BLOB_INVALID');
        await git(['read-tree', '--empty'], { env: indexEnv });
        await git(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + OUT_FILE], { env: indexEnv });
        const tree = (await git(['write-tree'], { env: indexEnv })).stdout.trim();
        if (!oid(tree)) throw new Error('CHATGPT_GIT_TREE_INVALID');
        const commit = (await git(['commit-tree', tree, ...(parent ? ['-p', parent] : []),
          '-m', 'JACO: bounded ChatGPT Workplace receipt'], { env: indexEnv })).stdout.trim();
        if (!oid(commit)) throw new Error('CHATGPT_GIT_COMMIT_INVALID');
        await git(['push', '--porcelain', 'origin', commit + ':' + OUT_REMOTE], { timeout: 25000 });
        lastDigest = signature;
        return { sent: true, branch: OUT_REMOTE, eventCount: message.events.length };
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    },
  };
}
