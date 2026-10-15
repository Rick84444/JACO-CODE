// github-create-repo: creates a repository on the operator's GitHub account through the REST API
// instead of the github.com web form. Operator 2026-10-02: browser missions that clicked through
// github.com/new kept blocking (NO_TARGET, TARGET_NOT_UNIQUE) and one planner typed an invented name
// ("my-new-repo").
//
// Credential: GITHUB_TOKEN from .env, else the GitHub credential git itself pushes with (Git Credential
// Manager), read via `git credential fill`. The token is never logged or put in a receipt.
import { spawnSync } from 'node:child_process';

const NAME = /^[A-Za-z0-9._-]{1,100}$/;

// Shared by the runtime (begin) and Nova's planner check, so an invalid plan is rejected before it
// costs a mission failure. The name must appear in the operator's goal: the planner never invents one.
export function validateGithubRepoTask(task, goal = '') {
  const data = task?.data || {};
  const name = String(data.name || '').trim();
  if (!NAME.test(name) || name === '.' || name === '..') throw new Error('GITHUB_REPO_NAME_INVALID');
  if (!String(goal).toLowerCase().includes(name.toLowerCase())) throw new Error(`GITHUB_REPO_NAME_NOT_IN_GOAL:${name}`);
  if (data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 350)) throw new Error('GITHUB_REPO_DESCRIPTION_INVALID');
  if (data.private !== undefined && typeof data.private !== 'boolean') throw new Error('GITHUB_REPO_PRIVATE_INVALID');
  return { ...task, data: { name, ...(data.description ? { description: data.description } : {}), private: data.private !== false } };
}

export function githubToken(env = process.env, run = spawnSync) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  const out = run('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
  const line = String(out?.stdout || '').split(/\r?\n/).find(l => l.startsWith('password='));
  return line ? line.slice('password='.length) : null;
}

// Idempotent: an existing repository with that name is reported (existed: true), not recreated.
export async function githubCreateRepo(data, { env = process.env, fetchImpl = fetch, token = githubToken(env) } = {}) {
  if (!token) return { ok: false, verified: false, error: 'GITHUB_TOKEN_MISSING: add GITHUB_TOKEN to .env or sign in to GitHub with git' };
  const api = (path, init = {}) => fetchImpl(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JACO-Nova', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const read = async res => { try { return await res.json(); } catch { return null; } };
  const userRes = await api('/user');
  const user = await read(userRes);
  if (!userRes.ok || !user?.login) return { ok: false, verified: false, error: `GITHUB_AUTH_FAILED:${userRes.status}` };
  const lookup = async () => {
    const res = await api(`/repos/${encodeURIComponent(user.login)}/${encodeURIComponent(data.name)}`);
    return res.ok ? read(res) : null;
  };
  const describe = (repo, existed) => ({
    ok: true, verified: true, existed, owner: user.login, name: repo.name, url: repo.html_url,
    private: repo.private, description: repo.description || null, createdAt: repo.created_at,
  });
  const before = await lookup();
  if (before) return describe(before, true);
  const res = await api('/user/repos', { method: 'POST', body: JSON.stringify({ name: data.name, description: data.description || undefined, private: data.private !== false }) });
  const body = await read(res);
  if (!res.ok && res.status !== 422) return { ok: false, verified: false, error: `GITHUB_CREATE_FAILED:${res.status}:${String(body?.message || '').slice(0, 200)}` };
  // Verified by reading it back, not by trusting the create response.
  const after = await lookup();
  if (!after) return { ok: false, verified: false, error: `GITHUB_CREATE_UNVERIFIED:${res.status}:${String(body?.message || '').slice(0, 200)}` };
  return describe(after, res.status === 422);
}
