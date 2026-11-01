import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const coreRun = fs.readFileSync(path.join(root,'runtime/termux/services/jaco-core/run'),'utf8');
const ctl = fs.readFileSync(path.join(root,'runtime/bin/jacoctl'),'utf8');

test('Aura Lean is optional and does not change SEER/Nova/model or stored secrets',()=>{
  assert.match(coreRun,/JACO_AURA_LEAN/);
  assert.match(coreRun,/export JACO_AUTO_START_TOOLS=0/);
  assert.match(ctl,/set_config_export JACO_AURA_LEAN/);
  assert.match(ctl,/requested_aura_lean/);
  assert.equal((ctl.match(/JACO_ENABLE_CDP:-1}" == "1" && "\$\{JACO_AURA_LEAN:-0\}" != "1"/g)||[]).length,2);
  assert.match(ctl,/set_config_export JACO_ENABLE_OLLAMA/);
  assert.match(ctl,/set_config_export JACO_WORKPLACE_SUPERVISE_SEER/);
  assert.match(ctl,/set_config_export JACO_WORKPLACE_SUPERVISE_NOVA/);
});

test('Termux Core launcher disables MCP eager start only when Aura Lean is selected',t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-aura-lean-'));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const prefix=path.join(tmp,'prefix'),home=path.join(tmp,'home');
  const runtime=path.join(tmp,'workspace','runtime'),cfg=path.join(tmp,'runtime.env');
  fs.mkdirSync(path.join(prefix,'bin'),{recursive:true});
  fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(home,{recursive:true});
  fs.symlinkSync('/bin/bash',path.join(prefix,'bin','bash'));
  fs.writeFileSync(path.join(runtime,'run_termux_node.sh'),
    '#!/bin/sh\nprintf "AUTO=%s\\n" "${JACO_AUTO_START_TOOLS-unset}"\n');
  const env={...process.env,PREFIX:prefix,HOME:home,JACO_RUNTIME_ENV:cfg};
  delete env.JACO_AUTO_START_TOOLS;
  delete env.JACO_AURA_LEAN;
  for(const mode of ['0','1']){
    fs.writeFileSync(cfg,"export JACO_ROOT='"+runtime+"'\nexport JACO_AURA_LEAN='"+mode+"'\n");
    const run=spawnSync('sh',[path.join(root,'runtime/termux/services/jaco-core/run')],{env,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,new RegExp('AUTO='+(mode==='1'?'0':'unset')));
  }
});

test('Termux Workplace respects disabled model supervision and shares Core planner location', t => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-workplace-launch-'));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const prefix=path.join(tmp,'prefix'), runtime=path.join(tmp,'repo/runtime'), cfg=path.join(tmp,'runtime.env');
  fs.mkdirSync(path.join(prefix,'bin'),{recursive:true});
  fs.mkdirSync(runtime,{recursive:true});
  fs.writeFileSync(path.join(runtime,'run_termux_node.sh'),'');
  fs.writeFileSync(path.join(prefix,'bin/node'), '#!/bin/sh\nprintf "MODEL=%s RUNTIME=%s\\n" "$JACO_WORKPLACE_SUPERVISE_MODEL" "$JACO_RUNTIME_DIR"\n', {mode:0o755});
  for (const model of ['0','1']) {
    fs.writeFileSync(cfg,`export JACO_ROOT='${runtime}'\nexport JACO_WORKPLACE_SUPERVISE_MODEL='${model}'\n`);
    const run=spawnSync('sh',[path.join(root,'runtime/termux/services/jaco-workplace/run')],{
      env:{PATH:process.env.PATH,PREFIX:prefix,HOME:tmp,JACO_RUNTIME_ENV:cfg},encoding:'utf8',
    });
    assert.equal(run.status,0,run.stderr);
    assert.equal(run.stdout.trim(),`MODEL=${model} RUNTIME=${runtime}`);
  }
});

test('Aura activation persists routing without enabling spend; runtime model-off survives stale project defaults', t => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-provider-sync-'));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const dir=path.join(tmp,'runtime/bin'), cfg=path.join(tmp,'runtime.env'), project=path.join(tmp,'project.env');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(cfg,"export JACO_WORKPLACE_SUPERVISE_MODEL='0'\n");
  fs.writeFileSync(project,"export JACO_WORKPLACE_SUPERVISE_MODEL='1'\nexport JACO_SEER_PROVIDER_PREFERENCE='litert'\nexport JACO_ALLOW_PAID_MODELS='0'\n");
  // Execute the production configuration functions, stopping before lifecycle
  // dispatch. No synthetic process ownership or real service mutation.
  const configRunner=path.join(dir,'config-test');
  fs.writeFileSync(configRunner,ctl.split('\nACTION=')[0]+'\nJACOCTL_PROVIDER_SELECTION="${TEST_PROVIDER:-}"\nsync_runtime_env\n');
  const run=provider=>spawnSync('bash',[configRunner],{
    env:{PATH:process.env.PATH,HOME:tmp,JACO_RUNTIME_ENV:cfg,JACO_PROJECT_ENV:project,TEST_PROVIDER:provider},encoding:'utf8',
  });
  for (const provider of ['', 'aura', '']) {
    const result=run(provider);assert.equal(result.status,0,result.stderr);
    const saved=fs.readFileSync(cfg,'utf8');
    assert.match(saved,/JACO_WORKPLACE_SUPERVISE_MODEL='0'/);
    if (provider==='aura') {
      assert.match(saved,/JACO_SEER_PROVIDER_PREFERENCE='aura'/);
      assert.match(saved,/JACO_ENABLE_OLLAMA='0'/);
      assert.match(fs.readFileSync(project,'utf8'),/JACO_ALLOW_PAID_MODELS='0'/);
    }
  }
});
