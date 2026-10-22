import fs from 'node:fs';
import { isPathAllowed } from '../../../../agents/lib/coding-contract.mjs';
import { redactText } from '../../../../agents/lib/secret-capture.mjs';

const clean = value => redactText(String(value || '')).text;
const real = value => { const result=fs.realpathSync(value); return process.platform==='win32'?result.toLowerCase():result; };

// Read-only projection of the canonical mission, its Git worktree and recorded receipts.
export function readMissionReview({ mission, projectRoot, worktrees, file = null }) {
  const receipts = Array.isArray(mission.receipts) ? mission.receipts : [];
  const tests = receipts.filter(item => item.type === 'repo-test').slice(-20).map(item => ({
    actionId:item.actionId,ok:item.ok===true,verified:item.verified===true,at:item.at||null,
    command:clean(item.result?.command||item.input?.command||item.task?.data?.command||''),
    output:clean(item.result?.output||item.result?.stderr||item.error||'').slice(-20000),
  }));
  const result = { id:mission.id,goal:clean(mission.goal),status:mission.status,phase:mission.phase,
    contractStatus:mission.contractStatus||null,cancelRequested:Boolean(mission.cancelRequested),
    observedAt:new Date().toISOString(),tests,verificationScope:'RECORDED_MISSION_RECEIPTS',
    workspace:{state:'NOT_PROJECT_MISSION',files:[],truncated:false},patch:null };
  if (!mission.metadata?.projectRoot) return result;
  if (real(mission.metadata.projectRoot)!==real(projectRoot)) throw Error('MISSION_PROJECT_MISMATCH');
  if (!mission.contract) throw Error('MISSION_REVIEW_CONTRACT_REQUIRED');
  const observed = worktrees.inspect({projectRoot:mission.metadata.projectRoot,missionId:mission.id});
  const files = observed.files.filter(entry=>isPathAllowed(mission.contract,entry.path));
  result.workspace={...observed,files,hiddenFiles:observed.files.length-files.length};
  if (file != null) {
    if (typeof file!=='string'||file.length>500||!files.some(entry=>entry.path===file)) throw Error('MISSION_REVIEW_FILE_NOT_FOUND');
    const patch=clean(worktrees.diff({projectRoot:mission.metadata.projectRoot,missionId:mission.id,file}));
    result.patch={path:file,content:patch.slice(0,200000),truncated:patch.length>200000};
  }
  return result;
}
