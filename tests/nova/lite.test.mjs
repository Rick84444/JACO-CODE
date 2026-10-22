// JACO Lite download (operator 2026-10-10): zip writer, launcher helpers, builder and its secret scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createZip, readZip, crc32 } from '../../tools/lib/zip.mjs';
import { buildLite, liteDependencies, secretValues, findSecrets, collectFiles, LITE_DEPENDENCIES } from '../../tools/build-lite.mjs';
import { nodeSupported, parseArgs, findFreePort, resolveProject, ensureProject, ensureEconomicPolicy, checkInstall, checkReleaseIntegrity, waitForHealth, serverEnv, agentEnv, agentCommand, openBrowser, liteExitCode, appendLiteLifecycle, HELP } from '../../lite/start.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lite-test-'));

test('Windows launcher explains incomplete ZIP extraction before invoking Node', { skip: process.platform !== 'win32' }, () => {
  const dir = tmp();
  try {
    fs.copyFileSync(new URL('../../lite/START.cmd', import.meta.url), path.join(dir, 'START.cmd'));
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'START.cmd'], {
      cwd: dir, input: '\n', encoding: 'utf8', timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 3);
    assert.match(result.stdout, /Extract All/);
    assert.doesNotMatch(result.stdout + result.stderr, /MODULE_NOT_FOUND/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zip: round trip keeps names, bytes, modes and UTF-8; empty and incompressible files are stored', () => {
  const random = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919 + 13) % 251));
  const zip = createZip([
    { name: 'dir/hello.txt', data: 'hello '.repeat(500) },
    { name: 'start.sh', data: '#!/bin/sh\n', mode: 0o755 },
    { name: 'empty.txt', data: '' },
    { name: 'räksmörgås.txt', data: 'å ä ö' },
    { name: 'random.bin', data: random },
  ], { date: new Date(2026, 9, 10, 12, 0, 0) });
  const back = readZip(zip);
  assert.deepEqual(back.map(e => e.name), ['dir/hello.txt', 'start.sh', 'empty.txt', 'räksmörgås.txt', 'random.bin']);
  assert.equal(back[0].data.toString(), 'hello '.repeat(500));
  assert.equal(back[0].method, 8);
  assert.equal(back[1].mode, 0o755);
  assert.equal(back[2].data.length, 0);
  assert.equal(back[4].data.equals(random), true);
  assert.equal(crc32('hello'), 0x3610a686);
  for (const bad of ['/abs', '../up', 'a\\b', '']) assert.throws(() => createZip([{ name: bad, data: 'x' }]), /ZIP_NAME_INVALID/);
  const corrupt = Buffer.from(zip); corrupt[30 + 'dir/hello.txt'.length + 3] ^= 0xff; // inside the first file's data
  assert.throws(() => readZip(corrupt), 'a damaged archive is not read back as fine');
});

test('launcher: Node version, arguments, free port, project folder and the server environment', async () => {
  assert.deepEqual(['22.4.0', '22.5.0', '24.11.0', '20.19.0', 'x'].map(v => nodeSupported(v)), [false, true, true, false, false]);
  assert.deepEqual(parseArgs(['proj', '--port', '3100', '--no-open', '--check']), { help: false, check: true, open: false, agent: true, verbose: false, whatsapp: null, whatsappCheck: false, port: 3100, project: 'proj', errors: [] });
  assert.equal(parseArgs(['--whatsapp', '+46701234567']).whatsapp, '+46701234567');
  assert.equal(parseArgs(['--whatsapp']).errors.length, 1);
  assert.equal(parseArgs(['--whatsapp-check']).whatsappCheck, true);
  assert.equal(parseArgs(['--port=99999']).errors.length, 1);
  assert.equal(parseArgs(['a', 'b', '--nope']).errors.length, 2);
  assert.match(HELP, /Node.js 22.5/);

  const busy = net.createServer(); await new Promise(r => busy.listen(0, '127.0.0.1', r));
  const taken = busy.address().port;
  assert.equal(await findFreePort(taken, { tries: 3 }) > taken, true, 'the next free port is taken');
  await assert.rejects(findFreePort(taken, { strict: true }), /PORT_IN_USE/);
  await new Promise(r => busy.close(r));

  const install = path.resolve('/opt/jaco-lite');
  assert.equal(resolveProject({ project: null, cwd: path.join(install, 'dist'), installDir: install }), path.join(install, 'workspace'), 'never opens the installation itself');
  assert.equal(resolveProject({ project: null, cwd: path.resolve('/home/me/app'), installDir: install }), path.resolve('/home/me/app'));
  assert.equal(resolveProject({ project: 'x', cwd: path.resolve('/home/me'), installDir: install }), path.resolve('/home/me/x'));

  const dir = tmp(); ensureProject(dir); ensureProject(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.jaco', '.gitignore'), 'utf8'), '*\n');
  assert.equal(checkInstall(dir).length, 6, 'an empty folder is not an installation');
  assert.equal(ensureEconomicPolicy(dir), true);
  const policyFile = path.join(dir, '.jaco', 'continuum', 'economic-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  assert.equal(policy.cloudEnabled, true);
  assert.deepEqual([policy.dailyCloudUsd, policy.monthlyCloudUsd, policy.maxCloudUsdPerTask], [undefined, undefined, undefined], 'no cost caps until the operator sets them');
  fs.writeFileSync(policyFile, JSON.stringify({ dailyCloudUsd: 2 }));
  assert.equal(ensureEconomicPolicy(dir), false);
  assert.equal(JSON.parse(fs.readFileSync(policyFile, 'utf8')).dailyCloudUsd, 2, 'a change the operator made is never overwritten');
  assert.equal(agentCommand(dir), null, 'no agent file, no agent');
  const agent = agentEnv({ env: {}, installDir: install, project: dir, url: 'http://127.0.0.1:3999', token: 'tok' });
  assert.deepEqual([agent.JACO_LITE, agent.NOVA_BRAIN_MODE, agent.JACO_RUNTIME_URL, agent.JACO_AUTO_APPROVE_LEVEL, agent.JACO_POLICY_EDIT_GRANT], ['1', 'direct', 'http://127.0.0.1:3999', '5', '1']);
  assert.equal(agentEnv({env:{JACO_AUTO_APPROVE_LEVEL:'1',JACO_POLICY_EDIT_GRANT:'0'},installDir:install,project:dir,url:'http://127.0.0.1:3999',token:'tok'}).JACO_AUTO_APPROVE_LEVEL,'1');
  assert.equal(JSON.stringify(agent).includes('OLLAMA'), false, 'the agent is not tied to one local server');
  const env = serverEnv({ env: { PATH: 'p' }, installDir: install, project: dir, port: 3999, token: 'tok' });
  assert.deepEqual([env.PORT, env.NODE_ENV, env.JACO_LITE, env.JACO_WORKSPACE_ROOT, env.GATEWAY_TOKEN, env.PATH, env.JACO_AUTO_APPROVE_LEVEL], ['3999', 'production', '1', dir, 'tok', 'p', '5']);
});

test('builder: stages dist without maps, adds launcher and license, scans for secrets, writes a verified zip', async () => {
  const repo = tmp(); const runtime = path.join(repo, 'rt'); const out = path.join(repo, 'out');
  fs.mkdirSync(path.join(runtime, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'dist', 'server.cjs'), 'server /api/aura/workbench/live /api/aura/workbench/gameboard');
  fs.writeFileSync(path.join(runtime, 'dist', 'server.cjs.map'), 'map');
  fs.writeFileSync(path.join(runtime, 'dist', 'index.html'), '<div id="root"></div><script src="/assets/a.js"></script>');
  fs.writeFileSync(path.join(runtime, 'dist', 'assets', 'a.js'), 'data-cognitive-workspace /api/aura/workbench/live /api/aura/workbench/gameboard Spelplan');
  const deps = Object.fromEntries(LITE_DEPENDENCIES.map(n => [n, '^1.0.0']));
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '9.9.9', dependencies: deps }));
  fs.mkdirSync(path.join(repo, 'lite'));
  for (const f of ['start.mjs', 'START.cmd', 'start.sh', 'START-ANDROID.sh', 'README.md', 'connect.html', 'connect.js', 'connect.css']) fs.writeFileSync(path.join(repo, 'lite', f), `// ${f}\n`);
  fs.writeFileSync(path.join(repo, 'LICENSE'), 'MIT');
  const install = stage => { fs.mkdirSync(path.join(stage, 'node_modules', '.bin'), { recursive: true }); fs.writeFileSync(path.join(stage, 'node_modules', 'express.js'), 'x'); fs.writeFileSync(path.join(stage, 'node_modules', '.bin', 'shim.cmd'), 'x'); fs.mkdirSync(path.join(stage, 'node_modules', '@img'), { recursive: true }); fs.writeFileSync(path.join(stage, 'node_modules', '@img', 'sharp.node'), 'x'); };
  const bundleNova = async outfile => fs.writeFileSync(outfile, '// nova');
  const bundleSetup = async stage => { for (const file of ['workplace.mjs', 'jaco-editor.mjs', 'jaco-shell.mjs', 'voice-link.mjs']) fs.writeFileSync(path.join(stage, 'dist', file), file === 'jaco-editor.mjs' ? '// test bundle gameboard_status' : '// test bundle'); };
  const r = await buildLite({ repoRoot: repo, runtimeDir: runtime, outDir: out, install, bundleNova, bundleSetup });
  const entries = readZip(fs.readFileSync(r.zipPath));
  const names = entries.map(e => e.name);
  assert.equal(r.name, 'jaco-lite-9.9.9');
  for (const n of ['start.mjs', 'START.cmd', 'start.sh', 'START-ANDROID.sh', 'README.md', 'LICENSE', 'package.json', 'dist/server.cjs', 'dist/index.html', 'dist/assets/a.js', 'dist/nova.mjs', 'dist/voice-link.mjs', 'node_modules/express.js']) assert.ok(names.includes(`jaco-lite-9.9.9/${n}`), n);
  assert.equal(names.some(n => n.endsWith('.map') || n.includes('.bin')), false);
  assert.equal(names.some(n => n.includes('node_modules/@img')), false, 'the 28 MB of image binaries stay out');
  assert.equal(entries.find(e => e.name.endsWith('/start.sh')).mode, 0o755);
  assert.equal(entries.find(e => e.name.endsWith('/START-ANDROID.sh')).mode, 0o755);
  assert.deepEqual(JSON.parse(entries.find(e => e.name.endsWith('/package.json')).data).scripts, { start: 'node start.mjs' });
  assert.equal(fs.readFileSync(`${r.zipPath}.sha256`, 'utf8').split(' ')[0], r.sha256);
  const release = JSON.parse(entries.find(e => e.name.endsWith('/release.json')).data);
  assert.equal(release.workspace, 'cognitive-live/v1');
  assert.equal(release.clientSha256, r.clientSha256);

  // One zip per platform, each with only its own launchers, plus latest.json pointing at the public names.
  const win = readZip(fs.readFileSync(r.platforms.windows.zipPath)), droid = readZip(fs.readFileSync(r.platforms.android.zipPath));
  const has = (entries, top, rel) => entries.some(e => e.name === `${top}/${rel}`);
  assert.ok(has(win, 'jaco-lite-windows-9.9.9', 'START.cmd') && has(win, 'jaco-lite-windows-9.9.9', 'start.mjs'));
  assert.ok(!has(win, 'jaco-lite-windows-9.9.9', 'START-ANDROID.sh') && !has(win, 'jaco-lite-windows-9.9.9', 'start.sh'), 'no Android launchers in the Windows zip');
  assert.ok(has(droid, 'jaco-lite-android-9.9.9', 'START-ANDROID.sh') && has(droid, 'jaco-lite-android-9.9.9', 'start.sh') && has(droid, 'jaco-lite-android-9.9.9', 'start.mjs'));
  assert.ok(!has(droid, 'jaco-lite-android-9.9.9', 'START.cmd'), 'no Windows launcher in the Android zip');
  for (const [entries, top] of [[win, 'jaco-lite-windows-9.9.9'], [droid, 'jaco-lite-android-9.9.9']]) {
    for (const rel of ['dist/server.cjs', 'dist/index.html', 'dist/nova.mjs', 'node_modules/express.js', 'LICENSE', 'package.json']) assert.ok(has(entries, top, rel), `${top}/${rel}`);
  }
  assert.equal(droid.find(e => e.name.endsWith('/START-ANDROID.sh')).mode, 0o755);
  assert.equal(JSON.parse(win.find(e => e.name.endsWith('/release.json')).data).platform, 'windows');
  assert.equal(JSON.parse(droid.find(e => e.name.endsWith('/release.json')).data).platform, 'android');
  assert.equal(JSON.parse(win.find(e => e.name.endsWith('/release.json')).data).clientSha256, r.clientSha256, 'same build as the universal zip');
  assert.equal(fs.readdirSync(out).filter(f => /^jaco-lite-.*\.zip$/.test(f)).length, 1, 'the universal zip stays the only jaco-lite-*.zip in the output folder');
  const latest = JSON.parse(fs.readFileSync(r.latestPath, 'utf8'));
  assert.equal(latest.schema, 'jaco.lite-latest/v1');
  assert.equal(latest.version, '9.9.9');
  assert.deepEqual(Object.fromEntries(Object.entries(latest.files).map(([k, v]) => [k, v.file])), { universal: 'jaco-lite.zip', windows: 'jaco-lite-windows.zip', android: 'jaco-lite-android.zip' });
  assert.equal(latest.files.windows.sha256, r.platforms.windows.sha256);
  assert.equal(latest.files.android.sha256, crypto.createHash('sha256').update(fs.readFileSync(r.platforms.android.zipPath)).digest('hex'));
  assert.match(fs.readFileSync(`${r.platforms.windows.zipPath}.sha256`, 'utf8'), /^[a-f0-9]{64} {2}jaco-lite-windows\.zip\n$/);
  fs.writeFileSync(path.join(runtime, 'dist', 'assets', 'a.js'), 'old editor');
  await assert.rejects(buildLite({ repoRoot: repo, runtimeDir: runtime, outDir: out, install, bundleNova, bundleSetup }), /LITE_COGNITIVE_WORKSPACE_MISSING/);
  assert.equal(fs.existsSync(r.zipPath), false, 'a rejected stale build cannot leave an older downloadable ZIP');
  assert.equal(fs.existsSync(r.platforms.windows.zipPath) || fs.existsSync(r.platforms.android.zipPath) || fs.existsSync(r.latestPath), false, 'nor older platform zips or latest.json');

  // A secret from the builder's .env inside a staged file stops the build.
  const envFile = path.join(repo, '.env'); fs.writeFileSync(envFile, 'DEEPSEEK_API_KEY=sk-super-secret-value-123\nPORT=3000\n');
  fs.writeFileSync(path.join(runtime, 'dist', 'assets', 'a.js'), 'data-cognitive-workspace /api/aura/workbench/live /api/aura/workbench/gameboard Spelplan const k="sk-super-secret-value-123"');
  await assert.rejects(buildLite({ repoRoot: repo, runtimeDir: runtime, outDir: out, install, bundleNova, bundleSetup, envFile }), /LITE_SECRET_FOUND:dist\/assets\/a\.js/);
  assert.deepEqual(secretValues('A_KEY=short\nB_TOKEN=abcdefghijklmnop\nC=plainplainplain\nD_SECRET=true'), ['abcdefghijklmnop']);
  assert.deepEqual(findSecrets(collectFiles(path.join(runtime, 'dist')), ['sk-super-secret-value-123']), ['assets/a.js']);
  assert.throws(() => liteDependencies({ dependencies: {} }), /LITE_DEPENDENCY_UNKNOWN:express/);
});

test('Lite activation checks matching server, client and index SHA-256 before boot', () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, 'dist','assets'), { recursive: true });
    const files = {'dist/server.cjs':'server v1',
      'dist/index.html':'<script src="/assets/a.js"></script>',
      'dist/assets/a.js':'client v1'};
    for (const [relative, content] of Object.entries(files))
      fs.writeFileSync(path.join(root,relative),content);
    const hash = content => crypto.createHash('sha256').update(content).digest('hex');
    const manifest = { schema:'jaco.lite-release/v1', workspace:'cognitive-live/v1',
      entry:'/assets/a.js', serverSha256:hash(files['dist/server.cjs']),
      indexSha256:hash(files['dist/index.html']), clientSha256:hash(files['dist/assets/a.js']) };
    fs.writeFileSync(path.join(root,'release.json'),JSON.stringify(manifest));
    assert.deepEqual(checkReleaseIntegrity(root),[],'a complete release passes');
    fs.writeFileSync(path.join(root,'dist/assets/a.js'),'tampered');
    assert.ok(checkReleaseIntegrity(root).includes('checksum mismatch for dist/assets/a.js'));
    fs.writeFileSync(path.join(root,'dist/assets/a.js'),files['dist/assets/a.js']);
    manifest.entry='/assets/../../outside.js';
    fs.writeFileSync(path.join(root,'release.json'),JSON.stringify(manifest));
    assert.match(checkReleaseIntegrity(root).join(','), /invalid client entry/,'no path traversal through manifest');
    fs.rmSync(path.join(root,'release.json'));
    assert.deepEqual(checkReleaseIntegrity(root),['missing release.json']);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Android browser opening uses Termux instead of desktop xdg-open', () => {
  const calls = [];
  openBrowser('http://127.0.0.1:3000', 'android', (cmd,args) => { calls.push({cmd,args}); return {on(){},unref(){}}; });
  assert.deepEqual(calls, [{cmd:'termux-open-url',args:['http://127.0.0.1:3000']}]);
});

test('Android launcher validates built-in SQLite and does not misreport the selected IDE port', () => {
  const script = fs.readFileSync(new URL('../../lite/START-ANDROID.sh',import.meta.url),'utf8');
  assert.match(script,/node --experimental-sqlite/);
  assert.match(script,/node:sqlite/);
  assert.doesNotMatch(script,/Open http:\/\/127\.0\.0\.1:3000/,'a --port 3100 invocation must not suggest port 3000');
  assert.match(script,/exec node "\$DIR\/start\.mjs" "\$PROJECT" --no-open "\$@"/);
});


test('Lite health accepts only the real JSON product, never the SPA HTML fallback', async () => {
  const paths = [];
  const falseHtml = async uri => {
    paths.push(uri);
    return new Response('<!doctype html><title>JACO</title>', {
      status: 200, headers: {'content-type':'text/html'}
    });
  };
  const options = { fetchImpl:falseHtml, timeoutMs:15, intervalMs:1 };
  assert.equal(await waitForHealth('http://127.0.0.1:3100',options),false,'HTML with 200 OK is NOT a healthy JACO runtime');
  assert.ok(paths.every(p=>p.endsWith('/api/runtime/identity')),'IDE readiness must use the identity endpoint');
  assert.equal(await waitForHealth('http://127.0.0.1:3100',{
    ...options,fetchImpl:async ()=>new Response(JSON.stringify({success:true,product:'Impersonated Runtime'}),{status:200})
  }),false,'a wrong product cannot mark an IDE ready');
  assert.equal(await waitForHealth('http://127.0.0.1:3100',{
    ...options,fetchImpl:async uri=>{
      assert.equal(uri,'http://127.0.0.1:3100/api/runtime/identity');
      return new Response(JSON.stringify({success:true,product:'JACO Autonomus IDE',primaryPort:3100}),{status:200});
    }
  }),true,'real identity is accepted');
  assert.equal(await waitForHealth('http://127.0.0.1:2995',{
    ...options,expectedProduct:'JACO Workplace',fetchImpl:async uri=>{
      assert.equal(uri,'http://127.0.0.1:2995/health');
      return new Response(JSON.stringify({product:'JACO Workplace',status:'READY'}),{status:200});
    }
  }),true,'Workplace readiness keeps its own JSON health contract');
});

test('Lite records signal termination as a failure, never a false exit code zero', () => {
  const signals = { SIGKILL: 9, SIGTERM: 15, SIGINT: 2 };
  assert.equal(liteExitCode(null, 'SIGKILL', signals), 137);
  assert.equal(liteExitCode(null, 'SIGTERM', signals), 143);
  assert.equal(liteExitCode(null, 'SIGINT', signals), 130);
  assert.equal(liteExitCode(0, null, signals), 0);
  assert.equal(liteExitCode(3, null, signals), 3);
  assert.equal(liteExitCode(null, null, signals), 1);
  assert.equal(liteExitCode(null, 'UNRECOGNIZED_SIGNAL', signals), 1);
});

test('Lite writes durable append-only lifecycle receipts without secrets or crashing on unavailable storage', () => {
  const dir = tmp();
  try {
    ensureProject(dir);
    assert.equal(appendLiteLifecycle(dir, { component:'ide', event:'READY', pid:111, port:3100 }), true);
    assert.equal(appendLiteLifecycle(dir, { component:'ide', event:'EXIT', pid:111, exitCode:137, signal:'SIGKILL', expected:false }), true);
    const rows = fs.readFileSync(path.join(dir, '.jaco', 'lite-lifecycle.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].event, 'READY');
    assert.equal(rows[1].exitCode, 137);
    assert.equal(rows[1].signal, 'SIGKILL');
    assert.equal(rows[1].expected, false);
    assert.equal(rows[1].schema, 'jaco.lite.lifecycle/v1');
    assert.match(rows[1].observedAt,/^20\d\d-/);
    assert.equal(appendLiteLifecycle(dir, {component:'ide'}, { appendFileSync(){ throw Error('ENOSPC'); } }),false);
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

import { checkForUpdate, isNewer, platformFor, updateNotice } from '../../lite/start.mjs';
test('Lite says where a newer download is, reads only latest.json, and never blocks or fails the start', async () => {
  const dir = tmp();
  try {
    const release = { schema: 'jaco.lite-release/v1', builtAt: '2026-10-10T10:00:00.000Z', sourceCommit: 'a'.repeat(40) };
    fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(release));
    const latest = { schema: 'jaco.lite-latest/v1', version: '1', sourceCommit: 'b'.repeat(40), builtAt: '2026-10-13T10:00:00.000Z',
      files: { universal: { file: 'jaco-lite.zip', sha256: '1'.repeat(64) }, windows: { file: 'jaco-lite-windows.zip', sha256: '2'.repeat(64) }, android: { file: 'jaco-lite-android.zip', sha256: '3'.repeat(64) } } };
    const serve = body => async (url, init) => { assert.equal(url, 'https://jacocode.com/download/latest.json'); assert.ok(init.signal, 'it has a timeout'); assert.ok(!init.headers.authorization && !init.headers.cookie, 'no identifier is sent'); return { ok: true, status: 200, json: async () => body }; };
    const win = await checkForUpdate({ installDir: dir, fetchImpl: serve(latest), platform: 'win32', env: {} });
    assert.equal(win.state, 'UPDATE'); assert.equal(win.url, 'https://jacocode.com/download/jaco-lite-windows.zip'); assert.equal(win.sha256, '2'.repeat(64));
    assert.equal((await checkForUpdate({ installDir: dir, fetchImpl: serve(latest), platform: 'linux', env: { TERMUX_VERSION: '0.118' } })).url, 'https://jacocode.com/download/jaco-lite-android.zip');
    assert.equal((await checkForUpdate({ installDir: dir, fetchImpl: serve(latest), platform: 'linux', env: {} })).url, 'https://jacocode.com/download/jaco-lite.zip');
    assert.match(updateNotice(win, {}).join('\n'), /newer JACO Lite is available[\s\S]*jaco-lite-windows\.zip[\s\S]*SHA-256 2{64}/);
    const viaInstaller = updateNotice(win, { JACO_LITE_INSTALLER: '1' }).join('\n');
    assert.match(viaInstaller, /jaco-lite update/); assert.match(viaInstaller, /jaco-lite rollback/); assert.doesNotMatch(viaInstaller, /Unzip it/, 'an installed copy is told the command, not to unzip');
    // same build, an older published build, or a changed commit that is not newer: nothing to say
    assert.equal((await checkForUpdate({ installDir: dir, fetchImpl: serve({ ...latest, builtAt: release.builtAt }) })).state, 'CURRENT');
    assert.equal((await checkForUpdate({ installDir: dir, fetchImpl: serve({ ...latest, builtAt: '2026-10-01T00:00:00.000Z' }) })).state, 'CURRENT');
    assert.equal(isNewer(release, { ...latest, sourceCommit: release.sourceCommit }), false, 'the same commit is never an update');
    assert.deepEqual(updateNotice({ state: 'CURRENT' }), []);
    // a platform zip knows its own platform; a hostile latest.json cannot make the notice point elsewhere
    assert.equal(platformFor({ release: { platform: 'android' }, platform: 'win32' }), 'android');
    const evil = { ...latest, files: { universal: { file: 'https://evil.example/x.zip', sha256: 'z' } } };
    assert.equal((await checkForUpdate({ installDir: dir, fetchImpl: serve(evil) })).state, 'UNKNOWN');
    // offline, slow or broken: unknown, never an exception
    assert.equal((await checkForUpdate({ installDir: dir, fetchImpl: async () => { throw new Error('offline'); } })).state, 'UNKNOWN');
    assert.equal((await checkForUpdate({ installDir: dir, fetchImpl: async () => ({ ok: false, status: 503 }) })).reason, 'HTTP_503');
    assert.equal((await checkForUpdate({ installDir: path.join(dir, 'nope'), fetchImpl: serve(latest) })).state, 'UNKNOWN');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('start.mjs runs when started through a symlink, as the installer\'s "current" link does', async t => {
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-lite-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'link.mjs');
  try { fs.symlinkSync(path.resolve('lite/start.mjs'), link); } catch { return t.skip('no symlinks here'); }
  const viaLink = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
  assert.match(viaLink.stdout, /Usage|--port/, viaLink.stderr);
  const { isEntryPoint } = await import('../../lite/start.mjs');
  const startUrl = new URL('../../lite/start.mjs', import.meta.url).href;
  assert.equal(isEntryPoint('/somewhere/else.mjs', startUrl), false, 'imported by another script it does not start');
  assert.equal(isEntryPoint(null, startUrl), false);
  assert.equal(isEntryPoint(link, startUrl), true, 'through a symlink it does');
});
