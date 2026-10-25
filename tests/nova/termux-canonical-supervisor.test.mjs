import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const runtime = path.join(root, 'runtime');
const ctl = path.join(runtime, 'bin/jacoctl');
const upgrade = fs.readFileSync(path.join(root, 'tools/upgrade-aura-termux.sh'), 'utf8');

test('Termux upgrade has one lifecycle owner and does not strand down-markers', () => {
  assert.match(upgrade, /bash "\$RUNTIME\/bin\/jacoctl" restart/);
  assert.doesNotMatch(upgrade, /touch "\$SVDIR\/\$svc\/down"/);
  assert.doesNotMatch(upgrade, /Port \$port still serves health/);
  assert.doesNotMatch(upgrade, /killall node|pkill node/);
});

test('Termux service scripts refuse silent fallback to another checkout', () => {
  for (const service of ['jaco-sentinel','jaco-core','jaco-workplace','jaco-nova','jaco-nova-bridge','jaco-cdp']) {
    const filename = path.join(runtime,'termux/services',service,'run');
    const code = fs.readFileSync(filename,'utf8');
    assert.doesNotMatch(code,/CANONICAL_RUNTIME=|REPO_ROOT=.*\$HOME\/jaco-code/);
    assert.match(code,/JACO_ROOT_INVALID/);
    const syntax = spawnSync('sh',['-n',filename],{encoding:'utf8'});
    assert.equal(syntax.status,0,service+': '+syntax.stderr);
  }
  for (const script of [ctl,path.join(root,'tools/upgrade-aura-termux.sh')]) {
    const syntax = spawnSync('bash',['-n',script],{encoding:'utf8'});
    assert.equal(syntax.status,0,script+': '+syntax.stderr);
  }
});

test('READY requires canonical Sentinel, Core and Workplace PID owners, not HTTP alone', {skip:process.platform!=='linux'}, async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-termux-ownership-'));
  const mockbin=path.join(temp,'bin');
  fs.mkdirSync(mockbin);
  const mock=(name,lines)=>{
    const p=path.join(mockbin,name);
    fs.writeFileSync(p,lines.join('\n')+'\n',{mode:0o755});
  };
  mock('sv',[
    '#!/bin/sh',
    'case "$1" in',
    '  status)',
    '    case "$2" in',
    '      */jaco-sentinel) pid="$JACO_TEST_SENTINEL_PID";;',
    '      */jaco-core) pid="$JACO_TEST_CORE_PID";;',
    '      */jaco-workplace) pid="$JACO_TEST_WORKPLACE_PID";;',
    '      *) echo "down: synthetic"; exit 0;;',
    '    esac',
    '    printf "run: %s: (pid %s) 100s\\n" "$2" "$pid";;',
    '  *) exit 1;;',
    'esac',
  ]);
  mock('curl',[
    '#!/bin/sh',
    'case "$*" in',
    '  *api/runtime/identity*) printf "%s\\n" "$JACO_TEST_CORE_IDENTITY";;',
    '  *2995/health*) printf \'{"supervisedAgents":{"state":"RUNNING","nova":{"state":"RUNNING"}}}\\n\';;',
    '  *) printf "{}\\n";;',
    'esac',
  ]);
  mock('service-daemon',['#!/bin/sh','echo "status must be read-only" >&2','exit 99']);
  const processes=[];
  const start=(cwd,entry)=>{
    const proc=spawn(process.execPath,['-e','setInterval(() => {}, 10000)','--',entry],{cwd,stdio:'ignore'});
    processes.push(proc);
    return proc.pid;
  };
  try {
    const oldGateway=path.join(temp,'jaco-code/runtime/gateway');
    fs.mkdirSync(oldGateway,{recursive:true});
    const legacySentinel=start(oldGateway,'src/sentinel.mjs');
    const canonicalSentinel=start(path.join(runtime,'gateway'),'src/sentinel.mjs');
    const core=start(runtime,'server.ts');
    const workplace=start(root,'gateway/src/workplace/workplace-server.mjs');
    assert.ok(legacySentinel && canonicalSentinel && core && workplace);
    await new Promise(resolve=>setTimeout(resolve,100));
    const release=JSON.parse(fs.readFileSync(path.join(runtime,'CURRENT_RELEASE.json'),'utf8')).releaseId;
    const common={
      ...process.env,
      HOME:temp,
      PATH:mockbin+path.delimiter+process.env.PATH,
      SVDIR:path.join(temp,'services'),
      JACO_STABILITY_PROBE_SECONDS:'0',
      JACO_TEST_CORE_IDENTITY:JSON.stringify({success:true,releaseId:release}),
      JACO_TEST_CORE_PID:String(core),
      JACO_TEST_WORKPLACE_PID:String(workplace),
    };
    const run=pid=>spawnSync('bash',[ctl,'status'],{encoding:'utf8',env:{...common,JACO_TEST_SENTINEL_PID:String(pid)},timeout:10000});
    const wrong=run(legacySentinel);
    assert.equal(wrong.status,0,wrong.stderr);
    assert.match(wrong.stdout,/\[JACO\] DEGRADED/);
    assert.doesNotMatch(wrong.stdout,/\[JACO\] READY/);
    const right=run(canonicalSentinel);
    assert.equal(right.status,0,right.stderr);
    assert.match(right.stdout,/\[JACO\] READY/);
  } finally {
    for (const child of processes) child.kill('SIGTERM');
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
