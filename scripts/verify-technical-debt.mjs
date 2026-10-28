#!/usr/bin/env node
/** Fail-closed CI gate for newly introduced, objectively risky technical debt. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const risky=[
 {code:'DEBUGGER',re:/\bdebugger\s*;/},
 {code:'DYNAMIC_EVAL',re:/(?:^|[^\w.])(?:eval|Function)\s*\(/},
 {code:'UNRESOLVED_FIXME',re:/^\s*\/\/\s*(?:FIXME|TODO)\b/},
 {code:'GENERATED_CANDIDATE_COMMENT',re:/^\s*\/\/ candidate \d+:/},
 {code:'TRAILING_WHITESPACE',re:/[ \t]+$/},
];
export function auditDiff(diff){
 const findings=[];let file=null,added=0;
 for(const line of diff.split('\n')){
  if(line.startsWith('+++ b/')){file=line.slice(6);continue;}
  if(line.startsWith('diff --git ')){file=null;continue;}
  if(!file || !/\.(?:[cm]?js|tsx?)$/.test(file) || /(?:^|\/)(?:tests?|fixtures?)\//.test(file))continue;
  if(!line.startsWith('+')||line.startsWith('+++'))continue;
  const code=line.slice(1);added++;
  for(const rule of risky){if(rule.re.test(code))findings.push({file,code:rule.code,snippet:code.slice(0,110)});}
 }
 return {schema:'jaco.technical-debt-gate/v1',addedLinesInspected:added,findings,accepted:findings.length===0};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const base=process.argv[2];
 if(!base || !/^[0-9a-f]{40}$/.test(base)){
  console.error('Usage: node scripts/verify-technical-debt.mjs <BASE_COMMIT_SHA>');process.exit(2);
 }
 const p=spawnSync('git',['diff','--unified=0','--no-ext-diff',`${base}...HEAD`,'--','*.js','*.mjs','*.cjs','*.ts','*.tsx'],{encoding:'utf8',maxBuffer:5_000_000,timeout:30000});
 if(p.status!==0||p.error){console.error('TECHNICAL_DEBT_DIFF_UNAVAILABLE',p.stderr||p.error?.message);process.exit(2)}
 const report=auditDiff(p.stdout);console.log(JSON.stringify(report,null,2));if(!report.accepted)process.exitCode=1;
}