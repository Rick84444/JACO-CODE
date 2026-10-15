// Operator 2026-10-02: the first paid service is a repo security scan, delivered without a human.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-repo-scan-'));
process.env.NOVA_STATE_DIR = dir;
process.env.NOVA_BRAIN_MODE = 'direct';
process.env.JACO_PLANNER_CHOICE_FILE = path.join(dir, 'planner-choice.json');
const scan = await import('../../agents/lib/repo-scan.mjs');
const { processOrders, orderMissionGoal } = await import('../../agents/repo-scan-orders.mjs');
const { assertPlanTaskAllowed } = await import('../../agents/hands-off-agent.mjs');
const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');

// Key-shaped strings are assembled at runtime so this file never contains one.
const fakeAws = 'AKIA' + 'Q'.repeat(16);
const fakeGh = 'ghp_' + 'a'.repeat(36);
const fakeStripeTest = 'sk_' + 'test_' + 'b'.repeat(24);
const order = 'cs_live_' + 'c'.repeat(40);

test('only public GitHub repository URLs are accepted', () => {
  assert.deepEqual(scan.parseRepoUrl('https://github.com/octocat/Hello-World.git'), { owner: 'octocat', repo: 'Hello-World', url: 'https://github.com/octocat/Hello-World' });
  for (const bad of ['http://github.com/a/b', 'https://gitlab.com/a/b', 'https://github.com/a', 'https://github.com/a/b/c', 'https://github.com/a/..', 'git@github.com:a/b.git', 'https://github.com/a/b;rm -rf']) {
    assert.throws(() => scan.parseRepoUrl(bad), /REPO_URL_INVALID/, bad);
  }
});

test('secrets are found with file, line and severity, and masked in the finding', () => {
  const found = scan.scanTextForSecrets(`const a = 1;\naws = "${fakeAws}"\ntoken: ${fakeGh}\ntest = ${fakeStripeTest}`, 'config.js');
  assert.deepEqual(found.map(f => [f.kind, f.severity, f.line]), [['aws-access-key', 'critical', 2], ['github-token', 'critical', 3], ['stripe-test-key', 'low', 4]]);
  for (const f of found) assert.ok(f.preview.includes('****') && !fakeAws.includes(f.preview) && f.preview.length <= 16, f.preview);
  assert.deepEqual(scan.scanTextForSecrets('const sk = "skeleton"; // AKIA in prose', 'x.js'), []);
});

test('a scan of a checked-out tree reports secrets and vulnerable pinned dependencies, and the HTML escapes content', async () => {
  const work = fs.mkdtempSync(path.join(dir, 'repo-'));
  fs.writeFileSync(path.join(work, '.env.example'), `AWS_KEY=${fakeAws}\n`);
  fs.writeFileSync(path.join(work, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/lodash': { version: '4.17.15' }, 'node_modules/ok': { version: '1.0.0' } } }));
  fs.writeFileSync(path.join(work, 'requirements.txt'), 'django==1.11.0\nrequests>=2\n');
  fs.mkdirSync(path.join(work, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(work, 'node_modules', 'x', 'leak.js'), fakeGh);
  const osv = async (url, init) => {
    if (url.endsWith('/querybatch')) {
      const q = JSON.parse(init.body).queries;
      return new Response(JSON.stringify({ results: q.map(x => ['lodash', 'django'].includes(x.package.name) ? { vulns: [{ id: `GHSA-${x.package.name}` }] } : {}) }));
    }
    return new Response(JSON.stringify({ summary: 'Test advisory <script>', database_specific: { severity: 'HIGH' } }));
  };
  const report = await scan.scanRepo('https://github.com/acme/demo', { workDir: work, cloneImpl: () => {}, fetchImpl: osv });
  assert.deepEqual(report.secrets.map(s => [s.kind, s.file]), [['aws-access-key', '.env.example']], 'node_modules is not scanned');
  assert.equal(report.dependencies.analysed, 3);
  assert.deepEqual(report.dependencies.vulnerable.map(v => `${v.ecosystem}:${v.name}`).sort(), ['PyPI:django', 'npm:lodash']);
  const html = scan.renderReportHtml(report, { order });
  assert.match(html, /Action needed: credentials are exposed/);
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'), 'advisory text is escaped');
  assert.ok(!html.includes(fakeAws), 'the full key never appears in the report');
  const down = await scan.scanRepo('https://github.com/acme/demo', { workDir: work, cloneImpl: () => {}, fetchImpl: async () => new Response('x', { status: 503 }) });
  assert.match(down.dependencies.error, /OSV_HTTP_503/);
  assert.match(scan.renderReportHtml(down), /could not be queried/, 'an unavailable database is not reported as clean');
});

test('the task is bound to its paid order: planner and runtime reject anything else', () => {
  const goal = orderMissionGoal(order, 'https://github.com/acme/demo');
  const t = data => ({ type: 'repo-scan', data });
  assert.deepEqual(scan.validateRepoScanTask(t({ url: 'https://github.com/acme/demo', order }), goal).data, { url: 'https://github.com/acme/demo', order });
  assert.throws(() => scan.validateRepoScanTask(t({ url: 'https://github.com/other/repo', order }), goal), /REPO_NOT_IN_GOAL/);
  assert.throws(() => scan.validateRepoScanTask(t({ url: 'https://github.com/acme/demo', order: 'cs_live_' + 'd'.repeat(40) }), goal), /ORDER_NOT_IN_GOAL/);
  const mission = { goal, allowedTasks: ['repo-scan'] };
  assert.throws(() => assertPlanTaskAllowed({ task: t({ url: 'https://github.com/other/repo', order }) }, mission), /PLAN_REJECTED:REPO_SCAN_REPO_NOT_IN_GOAL/);
  const control = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(dir, 'bus-'))));
  assert.equal(control.create({ goal: 'check status', idempotencyKey: 'plain' }).allowedTasks.includes('repo-scan'), false, 'never granted implicitly');
  const orders = new NovaMissionControl(new DurableMissionBus(fs.mkdtempSync(path.join(dir, 'bus-'))));
  const m = orders.create({ goal, idempotencyKey: order, allowedTasks: ['repo-scan'], source: 'stripe-order' });
  const lease = orders.claim(m.id, 'nova');
  assert.throws(() => orders.begin(m.id, { owner: 'nova', token: lease.token, task: t({ url: 'https://github.com/other/repo', order }) }), /REPO_NOT_IN_GOAL/);
});

test('the Nova executor stores the report under the order and returns a verified receipt with the public link', async () => {
  const env = { JACO_REPO_SCAN_DIR: path.join(dir, 'reports'), JACO_GATEWAY_PUBLIC_URL: 'https://api.example.test/' };
  const r = await scan.runRepoScanTask({ url: 'https://github.com/acme/demo', order }, { env, scan: async () => ({ repo: 'https://github.com/acme/demo', scannedAt: new Date().toISOString(), filesScanned: 2, secrets: [], dependencies: { analysed: 0, vulnerable: [], details: {}, error: null }, scope: 's' }) });
  assert.deepEqual([r.ok, r.verified, r.url], [true, true, `https://api.example.test/scan/${order}`]);
  assert.ok(fs.existsSync(path.join(env.JACO_REPO_SCAN_DIR, `${order}.html`)));
  const failed = await scan.runRepoScanTask({ url: 'https://github.com/acme/demo', order }, { env, scan: async () => { throw new Error('REPO_NOT_REACHABLE: x'); } });
  assert.deepEqual([failed.ok, failed.verified], [false, false]);
  assert.match(failed.error, /REPO_NOT_REACHABLE/);
});

test('each paid order becomes exactly one mission; unpaid and unscannable orders do not', async () => {
  const state = {};
  const created = [];
  const createMission = async input => { created.push(input); return { id: `mission-${created.length}` }; };
  const session = (id, extra = {}) => ({ id, status: 'complete', payment_status: 'paid', custom_fields: [{ key: 'repo', text: { value: 'https://github.com/acme/demo' } }], customer_details: { email: 'buyer@example.test' }, ...extra });
  const o2 = 'cs_live_' + 'e'.repeat(40), o3 = 'cs_live_' + 'f'.repeat(40), o4 = 'cs_live_' + 'g'.repeat(40);
  const sessions = [session(order), session(o2, { payment_status: 'unpaid' }), session(o3, { custom_fields: [{ key: 'repo', text: { value: 'my repo please' } }] }), session(o4, { status: 'open' })];
  const first = await processOrders({ sessions, state, createMission });
  assert.deepEqual(first.map(r => r.status), ['MISSION_CREATED', 'NEEDS_OPERATOR']);
  assert.deepEqual(created[0], { goal: orderMissionGoal(order, 'https://github.com/acme/demo'), idempotencyKey: order, allowedTasks: ['repo-scan'], source: 'stripe-order' });
  assert.equal(state[o3].status, 'NEEDS_OPERATOR');
  assert.deepEqual(await processOrders({ sessions, state, createMission }), [], 'a second poll creates nothing');
  assert.equal(created.length, 1);
});
