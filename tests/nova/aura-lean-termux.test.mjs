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
