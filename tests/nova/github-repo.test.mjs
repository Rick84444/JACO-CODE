// Operator 2026-10-02: GitHub repository missions go through the API, not the github.com web form.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-github-repo-'));
process.env.NOVA_STATE_DIR = dir;
process.env.NOVA_BRAIN_MODE = 'direct';
const { validateGithubRepoTask, githubCreateRepo, githubToken } = await import('../../agents/lib/github-repo.mjs');
const { assertPlanTaskAllowed } = await import('../../agents/hands-off-agent.mjs');
const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');

const goal = 'Create a private GitHub repository named "cloudflare-ts-deploy" with description "TypeScript starter".';
const task = data => ({ type: 'github-create-repo', data });

test('the repository name must come from the goal; private is the default', () => {
  const checked = validateGithubRepoTask(task({ name: 'cloudflare-ts-deploy', description: 'TypeScript starter', extra: 'dropped' }), goal);
  assert.deepEqual(checked.data, { name: 'cloudflare-ts-deploy', description: 'TypeScript starter', private: true });
  // Live 2026-10-02: a planner typed the invented name "my-new-repo" into github.com/new.
  assert.throws(() => validateGithubRepoTask(task({ name: 'my-new-repo' }), goal), /GITHUB_REPO_NAME_NOT_IN_GOAL/);
  assert.throws(() => validateGithubRepoTask(task({ name: 'a/b' }), 'a/b'), /GITHUB_REPO_NAME_INVALID/);
  assert.throws(() => validateGithubRepoTask(task({ name: 'cloudflare-ts-deploy', private: 'yes' }), goal), /PRIVATE_INVALID/);
  assert.equal(validateGithubRepoTask(task({ name: 'cloudflare-ts-deploy', private: false }), goal).data.private, false);
});

test('the planner check and the runtime reject an invented name the same way', () => {
  const mission = { goal, allowedTasks: ['github-create-repo'] };
  assert.throws(() => assertPlanTaskAllowed({ task: task({ name: 'my-new-repo' }) }, mission), /PLAN_REJECTED:GITHUB_REPO_NAME_NOT_IN_GOAL/);
  assert.doesNotThrow(() => assertPlanTaskAllowed({ task: task({ name: 'cloudflare-ts-deploy' }) }, mission));
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(dir, 'bus-'))));
  const m = control.create({ goal, idempotencyKey: 'gh-1' });
  assert.ok(m.allowedTasks.includes('github-create-repo'), 'available to non-coding missions by default');
  const lease = control.claim(m.id, 'nova');
  assert.throws(() => control.begin(m.id, { owner: 'nova', token: lease.token, task: task({ name: 'my-new-repo' }) }), /GITHUB_REPO_NAME_NOT_IN_GOAL/);
  const action = control.begin(m.id, { owner: 'nova', token: lease.token, task: task({ name: 'cloudflare-ts-deploy' }) });
  assert.deepEqual(action.data, { name: 'cloudflare-ts-deploy', private: true });
});

const fakeGithub = ({ exists = false, createStatus = 201, userStatus = 200 } = {}) => {
  const calls = [];
  let created = false;
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.replace('https://api.github.com', '')}`);
    assert.match(init.headers.Authorization, /^Bearer tok$/);
    if (url.endsWith('/user')) return new Response(JSON.stringify(userStatus === 200 ? { login: 'Rick84444' } : { message: 'Bad credentials' }), { status: userStatus });
    if (url.endsWith('/user/repos')) {
      assert.equal(JSON.parse(init.body).private, true);
      created = createStatus === 201;
      return new Response(JSON.stringify({ message: createStatus === 201 ? 'created' : 'nope' }), { status: createStatus });
    }
    const repo = { name: 'cloudflare-ts-deploy', html_url: 'https://github.com/Rick84444/cloudflare-ts-deploy', private: true, description: 'TypeScript starter', created_at: '2026-10-02T12:00:00Z' };
    return exists || created ? new Response(JSON.stringify(repo)) : new Response('{"message":"Not Found"}', { status: 404 });
  };
  return { calls, fetchImpl };
};

test('creation is verified by reading the repository back', async () => {
  const gh = fakeGithub();
  const r = await githubCreateRepo({ name: 'cloudflare-ts-deploy', description: 'TypeScript starter', private: true }, { token: 'tok', fetchImpl: gh.fetchImpl });
  assert.equal(r.ok, true); assert.equal(r.verified, true); assert.equal(r.existed, false);
  assert.equal(r.url, 'https://github.com/Rick84444/cloudflare-ts-deploy');
  assert.deepEqual(gh.calls, ['GET /user', 'GET /repos/Rick84444/cloudflare-ts-deploy', 'POST /user/repos', 'GET /repos/Rick84444/cloudflare-ts-deploy']);
  assert.equal(JSON.stringify(r).includes('tok'), false, 'the token never appears in a receipt');
});

test('an existing repository is reported, not recreated; failures say why', async () => {
  const existing = fakeGithub({ exists: true });
  const r = await githubCreateRepo({ name: 'cloudflare-ts-deploy', private: true }, { token: 'tok', fetchImpl: existing.fetchImpl });
  assert.equal(r.existed, true);
  assert.equal(existing.calls.some(c => c.startsWith('POST')), false);
  const badAuth = await githubCreateRepo({ name: 'cloudflare-ts-deploy', private: true }, { token: 'tok', fetchImpl: fakeGithub({ userStatus: 401 }).fetchImpl });
  assert.deepEqual([badAuth.ok, badAuth.error], [false, 'GITHUB_AUTH_FAILED:401']);
  const refused = await githubCreateRepo({ name: 'cloudflare-ts-deploy', private: true }, { token: 'tok', fetchImpl: fakeGithub({ createStatus: 403 }).fetchImpl });
  assert.equal(refused.ok, false); assert.match(refused.error, /GITHUB_CREATE_FAILED:403/);
  const noToken = await githubCreateRepo({ name: 'x', private: true }, { token: null, fetchImpl: async () => assert.fail('no call without a token') });
  assert.match(noToken.error, /GITHUB_TOKEN_MISSING/);
});

test('the token comes from GITHUB_TOKEN, else from the credential git pushes with', () => {
  assert.equal(githubToken({ GITHUB_TOKEN: 'env-token' }, () => assert.fail('not asked')), 'env-token');
  const run = (cmd, args, opts) => {
    assert.deepEqual([cmd, ...args], ['git', 'credential', 'fill']);
    assert.match(opts.input, /host=github\.com/);
    assert.equal(opts.env.GIT_TERMINAL_PROMPT, '0', 'never prompts');
    return { stdout: 'protocol=https\nhost=github.com\nusername=Rick84444\npassword=gcm-token\n' };
  };
  assert.equal(githubToken({}, run), 'gcm-token');
  assert.equal(githubToken({}, () => ({ stdout: '' })), null);
});
