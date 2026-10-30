
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectShell, shellInspectionOptions } from '../src/shell-inspector.mjs';

test('shell inspector exposes an explicit read-only command catalog', () => {
  assert.deepEqual(shellInspectionOptions(),['git_status','git_diff_stat','git_recent_commits','node_version','npm_version']);
});
test('shell inspection is disabled until explicitly enabled on the target host', async () => {
  let called=false;
  const system={repoRoot:'/safe/repo',runFile:async()=>{called=true;return {stdout:'',stderr:''}}};
  await assert.rejects(inspectShell('git_status',system),/JACO_MCP_SHELL_INSPECT_DISABLED/);
  assert.equal(called,false);
});
test('shell inspector denies arbitrary commands without process execution', async () => {
  let called=false;
  const system={repoRoot:'/safe/repo',runFile:async()=>{called=true;return {stdout:'',stderr:''}}};
  await assert.rejects(inspectShell('powershell -Command whoami',system,{enabled:true}),/SHELL_INSPECT_OPERATION_DENIED/);
  await assert.rejects(inspectShell('git_push',system,{enabled:true}),/SHELL_INSPECT_OPERATION_DENIED/);
  assert.equal(called,false);
});
test('shell inspector invokes git without a shell, limits output and strips tokens', async () => {
  const calls=[];
  const system={repoRoot:'/safe/repo',gitBin:'git',runFile:async(bin,args,opts)=>{
    calls.push({bin,args,opts});return {stdout:'x'.repeat(20000),stderr:''};
  }};
  const result=await inspectShell('git_diff_stat',system,{enabled:true});
  assert.equal(result.ok,true);
  assert.equal(result.stdout.length,10000);
  assert.deepEqual(calls[0].args,['-C','/safe/repo','diff','--stat','--no-ext-diff']);
  assert.equal(calls[0].opts.shell,false);
  assert.equal(calls[0].opts.cwd,'/safe/repo');
  assert.equal(calls[0].opts.timeout,10000);
  for (const key of ['JACO_GATEWAY_TOKEN','GATEWAY_TOKEN','CLOUDFLARE_API_TOKEN','GITHUB_TOKEN']) {
    assert.equal(key in calls[0].opts.env,false);
  }
});
test('shell inspector reports failures without echoing raw command line or inherited error secrets', async () => {
  const system={repoRoot:'/safe/repo',runFile:async()=>{const e=new Error('SECRET_COMMAND_FAILED');e.stdout='partial';throw e}};
  const result=await inspectShell('node_version',system,{enabled:true});
  assert.equal(result.ok,false);
  assert.equal(result.error,'INSPECTION_COMMAND_FAILED');
  assert.ok(!JSON.stringify(result).includes('SECRET_COMMAND_FAILED'));
});
