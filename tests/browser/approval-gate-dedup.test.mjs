import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('identical contract-bound system patch uses one approval until it finishes', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-approval-gate-'));
  const cwd=process.cwd(),prev=process.env.JACO_WORKSPACE_ROOT;
  try {
    process.chdir(root);
    process.env.JACO_WORKSPACE_ROOT=root;
    const {submitToGate}=await import('../../runtime/src/server/gate/approvalGate.ts');
    const {approve,markRunning,markCompleted,listJobs}=await import('../../runtime/src/server/queue/jobQueue.ts');
    const input={type:'system_patch',description:'Patch active JACO runtime',payload:{filePath:'src/service.ts',revision:'r1'}};
    const first=submitToGate(input);
    assert.equal(first.requiresApproval,true);
    assert.equal(first.job.status,'awaiting_approval');
    const second=submitToGate({...input,payload:{revision:'r1',filePath:'src/service.ts'}});
    assert.equal(second.job.id,first.job.id);
    assert.equal(listJobs({status:'awaiting_approval'}).length,1);
    approve(first.job.id,'operator');
    const third=submitToGate(input);
    assert.equal(third.job.id,first.job.id);
    assert.equal(third.job.status,'queued');
    markRunning(first.job.id);
    assert.equal(submitToGate(input).job.id,first.job.id);
    markCompleted(first.job.id,{ok:true,evidence:{state:'VERIFIED'}});
    const next=submitToGate(input);
    assert.notEqual(next.job.id,first.job.id,'a new execution needs a new approval');
    const changed=submitToGate({...input,payload:{filePath:'src/service.ts',revision:'r2'}});
    assert.notEqual(changed.job.id,next.job.id,'a changed patch cannot reuse an earlier decision');
  } finally {
    process.chdir(cwd);
    if(prev === undefined)delete process.env.JACO_WORKSPACE_ROOT;
    else process.env.JACO_WORKSPACE_ROOT=prev;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
