#!/usr/bin/env node
// Deliver Nova's committed work: push branch -> open/update PR -> merge only when every GitHub check is green.
// Operator decision 2026-09-24: agents commit on their own branch; merging requires green CI.
//   node agents/nova-deliver.mjs            (one pass; prints a JSON receipt)
// Env: JACO_NOVA_CODING_ROOT (worktree), GITHUB_TOKEN (repo scope), GITHUB_REPO (owner/name),
//      JACO_GIT_BASE_BRANCH (override the base; otherwise the repository's own default branch).
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.env.JACO_NOVA_CODING_ROOT;
const repo = process.env.GITHUB_REPO || 'Rick84444/jaco-code';
const token = process.env.GITHUB_TOKEN || '';
const GREEN = new Set(['success', 'skipped', 'neutral']);

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120_000 }).trim();
const done = (state, extra = {}) => { console.log(JSON.stringify({ schema: 'jaco.nova-delivery/v1', state, at: new Date().toISOString(), ...extra }, null, 2)); process.exit(0); };

// The base is the repository's actual default branch, asked for rather than assumed. A hardcoded name is how
// this script came to fetch a branch that does not exist, which threw before anything was ever delivered.
export function resolveBaseBranch(run = git, env = process.env) {
  const explicit = String(env.JACO_GIT_BASE_BRANCH || '').trim();
  if (explicit) return explicit;
  try { return run('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '') || 'main'; } catch { /* clone without origin/HEAD */ }
  try {
    const head = /HEAD branch:\s*(\S+)/.exec(run('remote', 'show', 'origin'));
    if (head && head[1] !== '(unknown)') return head[1];
  } catch { /* offline, or no permission to query the remote */ }
  return 'main';
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'jaco-nova-deliver', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GITHUB_${res.status}: ${data?.message || 'request failed'}`);
  return data;
}

// Running the file delivers; importing it does not. A test has to be able to reach resolveBaseBranch without
// pushing anything, and `done` exits the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
if (!root) done('BLOCKED', { reason: 'JACO_NOVA_CODING_ROOT not set' });
const base = resolveBaseBranch();
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch === base) done('BLOCKED', { reason: `Nova worktree is on ${base}; deliveries only from an agent branch` });
try { git('fetch', 'origin', base); }
catch (error) { done('BLOCKED', { base, branch, reason: `cannot fetch origin/${base}: ${error.message.split('\n')[0]}`, hint: 'set JACO_GIT_BASE_BRANCH if the base branch is not the repository default' }); }
const ahead = Number(git('rev-list', '--count', `origin/${base}..HEAD`));
if (!ahead) done('NOTHING_TO_DELIVER', { branch });
const sha = git('rev-parse', 'HEAD');
git('push', '-u', 'origin', `HEAD:refs/heads/${branch}`);
if (!token) done('PUSHED_NO_TOKEN', { branch, sha, ahead, reason: 'GITHUB_TOKEN missing: branch pushed, PR and merge need a token in .env' });

const owner = repo.split('/')[0];
let [pr] = await gh('GET', `/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}&base=${base}`);
if (!pr) {
  const subjects = git('log', '--format=- %s', `origin/${base}..HEAD`);
  pr = await gh('POST', '/pulls', { title: `Nova: ${git('log', '-1', '--format=%s')}`, head: branch, base, body: `Autonomous Nova delivery (${ahead} commit(s)). Merges only when all checks are green.\n\n${subjects}` });
}
const { check_runs: runs = [] } = await gh('GET', `/commits/${sha}/check-runs?per_page=100`);
if (!runs.length) done('CHECKS_PENDING', { pr: pr.number, url: pr.html_url, sha, reason: 'no check runs reported yet' });
const pending = runs.filter(r => r.status !== 'completed').map(r => r.name);
const failed = runs.filter(r => r.status === 'completed' && !GREEN.has(r.conclusion)).map(r => `${r.name}:${r.conclusion}`);
if (failed.length) done('CHECKS_FAILED', { pr: pr.number, url: pr.html_url, sha, failed });
if (pending.length) done('CHECKS_PENDING', { pr: pr.number, url: pr.html_url, sha, pending });

const merged = await gh('PUT', `/pulls/${pr.number}/merge`, { sha, merge_method: 'merge' });
git('fetch', 'origin', base);
if (!git('status', '--porcelain')) git('reset', '--hard', `origin/${base}`);
done('MERGED', { pr: pr.number, url: pr.html_url, sha, mergeCommit: merged.sha, checks: runs.length });
}
