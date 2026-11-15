import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const launcher = path.join(root, 'lite', 'START-PIXEL-TERMINAL.sh');
const specRoot = path.join(root, 'openspec', 'changes', 'harden-pixel-avf-terminal-release');
const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
const skip = process.platform !== 'linux' || bash.error ? 'requires Linux bash' : false;

function fixture(t, { release = true, nodeVersion = 'valid' } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-pixel-avf-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const stage = path.join(rootDir, 'lite');
  const bin = path.join(rootDir, 'bin');
  fs.mkdirSync(stage, { recursive: true });
  fs.mkdirSync(bin);
  fs.copyFileSync(launcher, path.join(stage, 'START-PIXEL-TERMINAL.sh'));
  if (release) {
    fs.mkdirSync(path.join(stage, 'dist'));
    for (const file of ['dist/server.cjs', 'dist/index.html', 'release.json', 'start.mjs'])
      fs.writeFileSync(path.join(stage, file), 'fixture');
  }
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -m) echo aarch64;; -s) echo Linux;; esac\n', {mode:0o755});
  const nodeScript = '#!/bin/sh\ncase "$1" in\n' +
    '  -e) exit ' + (nodeVersion === 'old' ? '1' : '0') + ' ;;\n' +
    '  --experimental-sqlite) exit ' + (nodeVersion === 'no-sqlite' ? '1' : '0') + ' ;;\n' +
    '  *) printf "%s\\n" "$*" > "$JACO_PIXEL_TEST_TRACE"; exit 0 ;;\n' +
    'esac\n';
  fs.writeFileSync(path.join(bin, 'node'), nodeScript, {mode:0o755});
  const trace = path.join(rootDir, 'invocation.txt');
  const env = { ...process.env, TERMUX_VERSION:'', PATH: bin+':'+process.env.PATH, HOME:rootDir,
    JACO_PIXEL_PROJECT:path.join(rootDir, 'project'), JACO_PIXEL_TEST_TRACE:trace };
  return {stage,env,trace,run:(extra = {})=>spawnSync('bash',[path.join(stage,'START-PIXEL-TERMINAL.sh'),'--check'],
    {env:{...env,...extra},encoding:'utf8',timeout:6000})};
}

test('OpenSpec Pixel change has the four mandatory artifacts and normative falsifiable scenarios',()=>{
  for (const f of ['proposal.md','design.md','tasks.md','specs/pixel-terminal/spec.md'])
    assert.equal(fs.existsSync(path.join(specRoot,f)), true, f);
  const spec=fs.readFileSync(path.join(specRoot,'specs/pixel-terminal/spec.md'),'utf8');
  const requirements=spec.split(/^### Requirement:/m).slice(1);
  assert.ok(requirements.length>=4);
  for (const requirement of requirements) {
    assert.match(requirement, /\b(SHALL|MUST)\b/);
    assert.match(requirement, /#### Scenario:/);
    assert.match(requirement, /- \*\*WHEN\*\*/);
    assert.match(requirement, /- \*\*THEN\*\*/);
  }
  const tasks=fs.readFileSync(path.join(specRoot,'tasks.md'),'utf8');
  assert.match(tasks, /- \[ \] Prove physical Pixel/);
});

test('Pixel launcher parses as Bash and never invokes Termux', {skip}, t=>{
  const parsed=spawnSync('bash',['-n',launcher],{encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);
  const fx=fixture(t);
  const denied=fx.run({TERMUX_VERSION:'1.0'});
  assert.equal(denied.status,2);
  assert.match(denied.stderr,/not Termux/);
  assert.equal(fs.existsSync(fx.trace),false);
});

test('Pixel launcher rejects a missing release or outdated/unsupported SQLite runtime', {skip}, t=>{
  const missing=fixture(t,{release:false});
  const a=missing.run();
  assert.equal(a.status,2);
  assert.match(a.stderr,/release files are missing/);
  assert.equal(fs.existsSync(missing.trace),false);
  const old=fixture(t,{nodeVersion:'old'});
  assert.equal(old.run().status,2);
  const noSqlite=fixture(t,{nodeVersion:'no-sqlite'});
  const r=noSqlite.run();
  assert.equal(r.status,2);
  assert.match(r.stderr,/node:sqlite/);
  assert.equal(fs.existsSync(noSqlite.trace),false);
});

test('Pixel launcher uses a local project, forwards --check and suppresses browser opening', {skip}, t=>{
  const fx=fixture(t);
  const r=fx.run();
  assert.equal(r.status,0,r.stderr+r.stdout);
  assert.match(r.stdout,/Pixel Terminal/);
  assert.match(r.stdout,/Pixel Chrome localhost forwarding must be tested/);
  const args=fs.readFileSync(fx.trace,'utf8');
  assert.match(args,/start\.mjs/);
  assert.match(args,/--no-open --check/);
  assert.match(args,/jaco-pixel-avf-/);
  assert.equal(fs.statSync(path.join(fx.env.HOME,'project')).isDirectory(),true);
});
