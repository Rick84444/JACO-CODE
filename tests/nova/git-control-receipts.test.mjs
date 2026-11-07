import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  gitControlReceiptSnapshot, githubOriginMatches, createGitControlReceiptPublisher,
} from '../../agents/lib/git-control-receipts.mjs';

test('Git receipt payload is bounded metadata, never goals, credentials or tool contents', () => {
  const state = { issues: { 'git:command-001': {
    commandId: 'command-001', op: 'mission.create', missionId: 'mission-1',
    transport: 'git-ref', status: 'ACTIVE', phase: 'READY',
    turn: 8, receipts: 3, failures: 0, closed: false,
    goal: 'PRIVATE GOAL', error: 'sk-secret-on-disk', secret: 'ghp_abcdef',
    privateHost: '192.168.1.20', screenshot: 'PNG-RAW-BYTES',
  }, '44': {
    commandId: 'github-token-001', transport: 'github-api', status: 'ACTIVE',
  } } };
  const result = gitControlReceiptSnapshot(state);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].commandId, 'command-001');
  assert.equal(result.entries[0].receipts, 3);
  assert.equal(result.authoritative, false);
  const poisoned=gitControlReceiptSnapshot({issues:{x:{
    commandId:'poisoned-command-001',transport:'git-ref',status:'REJECTED',
    error:'SUPERSECRET',
  }}});
  assert.equal(poisoned.entries[0].errorCode,'COMMAND_REJECTED');
  assert.equal(JSON.stringify(poisoned).includes('SUPERSECRET'),false);
  const safe=gitControlReceiptSnapshot({issues:{x:{
    commandId:'invalid-command-001',transport:'git-ref',status:'REJECTED',
    error:'GITHUB_CONTROL_INVALID_JSON',
  }}});
  assert.equal(safe.entries[0].errorCode,'GITHUB_CONTROL_INVALID_JSON');
  for (const secret of ['PRIVATE GOAL','sk-secret','ghp_','PNG-RAW-BYTES','192.168.1.20']) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
test('Git receipt refuses unknown origins and misleading hostname/path forms', () => {
  assert.equal(githubOriginMatches('https://github.com/Rick84444/JACO-CODE.git','Rick84444/JACO-CODE'),true);
  assert.equal(githubOriginMatches('git@github.com:Rick84444/JACO-CODE.git','Rick84444/JACO-CODE'),true);
  assert.equal(githubOriginMatches('https://github.com.evil.test/Rick84444/JACO-CODE','Rick84444/JACO-CODE'),false);
  assert.equal(githubOriginMatches('https://github.com/Other/JACO-CODE','Rick84444/JACO-CODE'),false);
  assert.equal(githubOriginMatches('https://token@github.com/Rick84444/JACO-CODE.git','Rick84444/JACO-CODE'),false);
  assert.equal(githubOriginMatches('file:///tmp/jaco','Rick84444/JACO-CODE'),false);
});
test('publisher fails closed on unexpected origin without touching checked-out files', async () => {
  const calls=[];
  const publisher=createGitControlReceiptPublisher({
    repo:'Rick84444/JACO-CODE',repoRoot:'/repo',
    gitExecImpl:async (file,args)=>{ calls.push(args);return {stdout:'file:///tmp/untrusted\n',stderr:''}; },
  });
  const state={issues:{one:{commandId:'command-111',transport:'git-ref',status:'ACTIVE'}}};
  const output=await publisher.publish(state);
  assert.equal(output.sent,false);
  assert.equal(output.error,'GIT_CONTROL_ORIGIN_MISMATCH');
  assert.deepEqual(calls.map(a=>a[2]),['remote']);
  assert.equal(state.gitReceiptPushError,'GIT_CONTROL_ORIGIN_MISMATCH');
});

test('publisher performs real offline Git object roundtrip and preserves user worktree', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-git-bridge-test-'));
  const remote=path.join(root,'remote.git');
  const local=path.join(root,'local');
  try {
    execFileSync('git',['init','--bare',remote],{stdio:'ignore'});
    execFileSync('git',['init',local],{stdio:'ignore'});
    execFileSync('git',['-C',local,'remote','add','origin',remote],{stdio:'ignore'});
    fs.writeFileSync(path.join(local,'user-work.txt'),'do-not-touch\n');
    const run=promisify(execFile);
    const gitExecImpl=async (file,args,options)=>{
      if(args[2]==='remote' && args[3]==='get-url') {
        // Simulate an actual GitHub origin while running a no-network bare Git fixture.
        return {stdout:'https://github.com/Rick84444/JACO-CODE.git\n',stderr:''};
      }
      return run(file,args,options);
    };
    const bridge=createGitControlReceiptPublisher({
      repo:'Rick84444/JACO-CODE',repoRoot:local,gitExecImpl,
    });
    const state={issues:{one:{
      commandId:'message-0001',transport:'git-ref',op:'mission.create',
      status:'ACTIVE',phase:'PLANNING',missionId:'mission-123',turn:0,receipts:0,
    }}};
    const first=await bridge.publish(state);
    assert.equal(first.sent,true,JSON.stringify(first));
    const firstData=JSON.parse(execFileSync('git',['--git-dir',remote,'show','refs/heads/jaco-control-status:.jaco/nova-status.json'],{encoding:'utf8'}));
    assert.equal(firstData.entries[0].missionId,'mission-123');
    assert.equal(firstData.entries[0].status,'ACTIVE');
    assert.equal(firstData.authoritative,false);
    assert.equal((await bridge.publish(state)).reason,'unchanged');
    state.issues.one.status='DONE';
    state.issues.one.turn=12;
    state.issues.one.receipts=4;
    const second=await bridge.publish(state);
    assert.equal(second.sent,true,JSON.stringify(second));
    const lastData=JSON.parse(execFileSync('git',['--git-dir',remote,'show','refs/heads/jaco-control-status:.jaco/nova-status.json'],{encoding:'utf8'}));
    assert.equal(lastData.entries[0].status,'DONE');
    assert.equal(lastData.entries[0].receipts,4);
    assert.equal(fs.readFileSync(path.join(local,'user-work.txt'),'utf8'),'do-not-touch\n');
    const stateLines=execFileSync('git',['-C',local,'status','--porcelain'],{encoding:'utf8'});
    assert.match(stateLines,/\?\? user-work.txt/);
    const count=Number(execFileSync('git',['--git-dir',remote,'rev-list','--count','refs/heads/jaco-control-status'],{encoding:'utf8'}).trim());
    assert.equal(count,2);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
