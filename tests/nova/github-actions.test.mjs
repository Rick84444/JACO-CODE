import test from 'node:test';
import assert from 'node:assert/strict';
import {readGithubActions,actionsEnvironment} from '../../runtime/src/server/github/githubActions.mjs';

const fixture={databaseId:123456,workflowName:'CI',displayTitle:'Run test',status:'completed',conclusion:'success',headBranch:'main',headSha:'a'.repeat(40),event:'push',createdAt:'2026-11-26T10:00:00Z',updatedAt:'2026-11-26T10:01:00Z'};
function stub(remote,records=[fixture]){
  const calls=[];
  return {calls,exec:async(bin,args,opts)=>{
    calls.push({bin,args,opts});
    if(bin==='git')return {stdout:remote};
    return {stdout:JSON.stringify(records)};
  }};
}
test('Actions is read-only, scoped to current origin, with real run ID, SHA and trusted URL',async()=>{
  const {exec,calls}=stub('git@github.com:owner/project.git\n');
  const r=await readGithubActions('/test',{exec,env:{PATH:'/bin',GH_TOKEN:'not-for-child',OPENAI_API_KEY:'not-for-child'}});
  assert.equal(r.repository,'owner/project');
  assert.equal(r.runs[0].url,'https://github.com/owner/project/actions/runs/123456');
  assert.equal(r.runs[0].sha,'a'.repeat(40));
  assert.equal(r.runs[0].conclusion,'success');
  assert.deepEqual(calls[0].args,['remote','get-url','origin']);
  assert.deepEqual(calls[1].args.slice(0,6),['run','list','--repo','owner/project','--limit','20']);
  assert.ok(calls.every(c=>c.opts.timeout===12000&&!c.opts.shell));
  assert.ok(calls.every(c=>!('GH_TOKEN'in c.opts.env)&&!('OPENAI_API_KEY'in c.opts.env)));
});
test('non-GitHub origin and unsafe repository segments fail before gh',async()=>{
  for(const url of ['https://example.org/owner/project','https://github.com/../project','https://github.com/owner/project;echo','https://github.com@evil.example/owner/repo']){
    const {exec,calls}=stub(url);
    await assert.rejects(readGithubActions('/test',{exec}),/GITHUB_ORIGIN_UNAVAILABLE/);
    assert.equal(calls.length,1);
  }
});
test('invalid IDs and unrecognized statuses cannot be reported as successful runs',async()=>{
  for(const record of [{...fixture,databaseId:'123'},{...fixture,status:'fabricated'},{...fixture,databaseId:-1}]){
    await assert.rejects(readGithubActions('/test',{exec:stub('https://github.com/owner/project.git',[record]).exec}),/GITHUB_ACTIONS_INVALID_RESPONSE/);
  }
});
test('process failure is bounded and does not expose diagnostic or secret contents',async()=>{
  await assert.rejects(readGithubActions('/test',{exec:async(bin)=>{
    if(bin==='git')return {stdout:'https://github.com/owner/project'};
    throw Object.assign(Error('private diagnostic'),{code:'ENOENT'});
  }}),e=>e.message==='GITHUB_CLI_NOT_INSTALLED');
  assert.deepEqual(actionsEnvironment({GH_HOST:'evil.example',GH_TOKEN:'secret',HOME:'/h'}),{HOME:'/h',GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_NO_EXTENSION_UPDATE_NOTIFIER:'1'});
});
