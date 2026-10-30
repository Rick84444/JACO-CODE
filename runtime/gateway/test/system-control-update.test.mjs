import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemControl } from '../src/system-control.mjs';

function fixture({ tracked='', branch='main', before='aaa', after='bbb', runtimeState='READY', changedFiles='' } = {}) {
  const calls=[];
  const spawned=[];
  const execFileImpl=async(file,args,options={})=>{
    calls.push([file,...args,...(options.cwd?['@'+options.cwd]:[])]);
    if (file === 'npm') return {stdout:'',stderr:''};
    if (file === 'git') {
      const op=args[2];
      if (op==='status') return {stdout:tracked,stderr:''};
      if (op==='branch') return {stdout:branch+'\n',stderr:''};
      if (op==='rev-parse') {
        const rev=args[3];
        // calls holds [file, '-C', repo, op, ...]; the op sits at index 3.
        return {stdout:(rev==='HEAD' && calls.filter(x=>x[3]==='rev-parse').length>1 ? after : before)+'\n',stderr:''};
      }
      if (op==='fetch' || op==='merge') return {stdout:'',stderr:''};
      if (op==='diff') return {stdout:changedFiles,stderr:''};
    }
    if (file === '/runtime/bin/jacoctl') return {stdout:JSON.stringify({state:runtimeState}),stderr:''};
    throw new Error('unexpected exec '+file+' '+args.join(' '));
  };
  const spawnImpl=(file,args,options)=>{
    spawned.push({file,args,options});
    return { unref(){} };
  };
  const system=new SystemControl({
    jacoctl:'/runtime/bin/jacoctl',
    core:{identity:async()=>({})},
    runtimeRoot:'/runtime',
    repoRoot:'/repo',
    npmBin:'npm',
    gitBin:'git',
    bashBin:'/bin/bash',
    execFileImpl,
    spawnImpl,
  });
  return {system,calls,spawned};
}

test('remote update fast-forwards main, restarts runtime, then schedules Sentinel restart', async()=>{
  const {system,calls,spawned}=fixture();
  const result=await system.update({fromMcp:false});
  assert.equal(result.state,'UPDATED');
  assert.equal(result.before,'aaa');
  assert.equal(result.after,'bbb');
  assert.equal(result.changed,true);
  assert.equal(result.runtime,'READY');
  assert.equal(result.sentinelRestartScheduled,true);
  assert.ok(calls.some(x=>x.join(' ').includes('git -C /repo fetch origin main')));
  assert.ok(calls.some(x=>x.join(' ').includes('git -C /repo merge --ff-only origin/main')));
  assert.ok(calls.some(x=>x.join(' ').includes('/runtime/bin/jacoctl restart --json')));
  assert.equal(spawned.length,1);
  assert.equal(spawned[0].file,'/bin/bash');
  assert.deepEqual(spawned[0].args.map(a=>a.replace(/\\/g,'/')),['/runtime/termux/restart-sentinel-after-delay.sh','3']);
});

test('remote update installs dependencies where a package file changed, and nowhere else', async()=>{
  const {system,calls}=fixture({changedFiles:'runtime/package-lock.json\nagents/hands-off-agent.mjs\ngateway/package.json\n'});
  const result=await system.update({fromMcp:false});
  const installs=calls.filter(x=>x[0]==='npm').map(x=>x.at(-1));
  assert.equal(installs.length,2);
  assert.ok(installs.some(cwd=>cwd.replace(/\\/g,'/').endsWith('/repo/runtime')));
  assert.ok(installs.some(cwd=>cwd.replace(/\\/g,'/').endsWith('/repo/gateway')));
  assert.deepEqual(result.dependenciesInstalled.sort(),['gateway','runtime']);
  const restartIndex=calls.findIndex(x=>x.join(' ').includes('jacoctl restart'));
  assert.ok(calls.findIndex(x=>x[0]==='npm')<restartIndex,'dependencies are installed before the restart');
});

test('by default paths come from JACO_ROOT, not from the installed jacoctl wrapper', ()=>{
  const saved=process.env.JACO_ROOT, savedRepo=process.env.JACO_REPO_ROOT;
  process.env.JACO_ROOT='/data/home/jaco-code/runtime'; delete process.env.JACO_REPO_ROOT;
  try {
    const system=new SystemControl({jacoctl:'/data/home/.local/bin/jacoctl',core:{}});
    assert.equal(system.repoRoot.replace(/\\/g,'/').replace(/^[A-Z]:/,''),'/data/home/jaco-code');
    assert.equal(system.sentinelRestartHelper.replace(/\\/g,'/').replace(/^[A-Z]:/,''),'/data/home/jaco-code/runtime/termux/restart-sentinel-after-delay.sh');
  } finally {
    if (saved===undefined) delete process.env.JACO_ROOT; else process.env.JACO_ROOT=saved;
    if (savedRepo!==undefined) process.env.JACO_REPO_ROOT=savedRepo;
  }
});

test('remote update fails closed on tracked changes before network mutation', async()=>{
  const {system,calls}=fixture({tracked:' M bin/jacoctl\n'});
  await assert.rejects(system.update({fromMcp:false}),/REMOTE_UPDATE_TRACKED_CHANGES/);
  assert.equal(calls.some(x=>x.includes('fetch')),false);
});

test('MCP update requires its own explicit capability, separate from activation', async()=>{
  const {system,calls}=fixture();
  await assert.rejects(system.update(),/MCP_UPDATE_DISABLED/);
  assert.equal(calls.some(x=>x.includes('fetch')),false);
});

test('remote update refuses non-main checkout', async()=>{
  const {system,calls}=fixture({branch:'feature/local'});
  await assert.rejects(system.update({fromMcp:false}),/REMOTE_UPDATE_BRANCH_UNSUPPORTED/);
  assert.equal(calls.some(x=>x.includes('fetch')),false);
});

test('remote update does not schedule Sentinel restart unless runtime returns READY', async()=>{
  const {system,spawned}=fixture({runtimeState:'DEGRADED'});
  await assert.rejects(system.update({fromMcp:false}),/REMOTE_UPDATE_RUNTIME_NOT_READY/);
  assert.equal(spawned.length,0);
});
