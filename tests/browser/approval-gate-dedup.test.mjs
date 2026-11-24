import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';

test('the legacy job gate never creates phantom approvals for unsupported patch jobs', async () => {
  const root=fs.mkdtempSync(requireTempPrefix());
  const cwd=process.cwd(), prev=process.env.JACO_WORKSPACE_ROOT;
  try {
    process.chdir(root);
    process.env.JACO_WORKSPACE_ROOT=root;
    const {submitToGate}=await import('../../runtime/src/server/gate/approvalGate.ts');
    const {listJobs}=await import('../../runtime/src/server/queue/jobQueue.ts');
    for (const type of ['system_patch','model_benchmark']) {
      const result=submitToGate({type,description:'Legacy worker route',
        payload:{filePath:'src/service.ts',revision:'r1'}});
      assert.equal(result.allowed,false);
      assert.match(result.reason,/no verified worker implementation/);
      assert.equal(result.job,undefined);
      assert.equal(listJobs({type}).length,0,'a nonexecutable job must not enter the queue');
    }
    // A real, typed local code-edit worker remains available under the existing
    // mission and workspace controls without an obsolete approval prompt.
    const work=submitToGate({type:'code_refactor',description:'Local code edit',
      payload:{filePath:'src/service.ts',newContent:'export const healthy = true;'}});
    assert.equal(work.allowed,true);
    assert.equal(work.requiresApproval,false);
    assert.equal(work.job.status,'queued');
  } finally {
    process.chdir(cwd);
    if(prev === undefined)delete process.env.JACO_WORKSPACE_ROOT;
    else process.env.JACO_WORKSPACE_ROOT=prev;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
function requireTempPrefix() {
  return os.tmpdir() + '/jaco-real-job-gate-';
}
