import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useEffect, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';

interface Mission { id:string; goal:string; status:string }
interface Review {
  id:string;goal:string;status:string;phase:string;observedAt:string;
  workspace:{state:string;branch?:string;files:Array<{path:string;untracked:boolean}>;truncated:boolean;hiddenFiles?:number};
  contractStatus:{machineVerified:boolean;missing:string[]}|null;
  tests:Array<{actionId:string;command:string;output:string;ok:boolean;verified:boolean;at:string|null}>;
  patch:{path:string;content:string;truncated:boolean}|null;
}
export function MissionReview({missions,preferredMissionId,onDecisions}:{missions:Mission[];preferredMissionId?:string|null;onDecisions:()=>void}) {
  const { t: uiText } = useUiLanguage();
  const [id,setId]=useState(()=>{try{return preferredMissionId||localStorage.getItem('jaco:aura:review-mission:v1')||missions[0]?.id||'';}catch{return preferredMissionId||missions[0]?.id||'';}});
  const [file,setFile]=useState(''),[review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[wrap,setWrap]=useState(true),[revision,setRevision]=useState(0);
  useEffect(()=>{if(preferredMissionId){setId(preferredMissionId);setFile('');}},[preferredMissionId]);
  useEffect(()=>{if(!id&&missions[0])setId(missions[0].id);},[id,missions]);
  useEffect(()=>{try{if(id)localStorage.setItem('jaco:aura:review-mission:v1',id);}catch{}},[id]);
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setRevision(value=>value+1);},15000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!id)return;
    const controller=new AbortController();let alive=true;
    setLoading(true);setError('');
    void fetch(`/api/aura/workbench/missions/${encodeURIComponent(id)}/review${file?'?path='+encodeURIComponent(file):''}`,{cache:'no-store',signal:controller.signal})
      .then(readAuraResponse).then(data=>{if(alive)setReview(data.review);}).catch(e=>{if(alive&&e.name!=='AbortError')setError(e.message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;controller.abort();};
  },[id,file,revision]);
  const current=review?.id===id?review:null;
  const patch=current?.patch?.path===file?current.patch:null;
  const paths=current?.workspace.files||[];
  const patchLines=patch?.content.split('\n')||[];
  return <section className="mission-review" aria-label={uiText("Review task changes")}>
    <header><h2>{uiText("Task results")}</h2><button type="button" onClick={()=>setRevision(value=>value+1)}>{uiText("Refresh")}</button></header>
    <p>{uiText("Changes are read from the task’s own workspace. Reviewing them does not change your open project.")}</p>
    <label>{uiText("Task")}<select value={id} onChange={event=>{setId(event.target.value);setFile('');setReview(null);}}>
      {!missions.some(m=>m.id===id)&&id&&<option value={id}>{uiText("Previously selected task")}</option>}
      {!missions.length&&!id&&<option value="">{uiText("No tasks observed")}</option>}
      {missions.map(m=><option key={m.id} value={m.id}>{m.goal.slice(0,100)} · {m.status}</option>)}
    </select></label>
    {loading&&<p role="status">{uiText("Reading current task results…")}</p>}
    {error&&<p role="alert">{uiText("Could not refresh the review:")}{' '}{error}{uiText(". Earlier observations may be out of date.")}</p>}
    {current&&<>
      <p>{current.status} · {current.phase} {' '}{uiText("· Observed")}{' '}{new Date(current.observedAt).toLocaleTimeString('sv-SE')}</p>
      {current.contractStatus&&<p>{current.contractStatus.machineVerified?uiText("The task’s recorded checks have passed."):uiText("Remaining task checks: ")+current.contractStatus.missing.join(', ')}</p>}
      <p>{uiText("Test results apply to the recorded run. This review does not run new tests or verify later manual changes.")}</p>
      {['BLOCKED','AWAITING_VERIFICATION'].includes(current.status)&&<button type="button" onClick={onDecisions}>{uiText("View blockers and available decisions")}</button>}
      {current.workspace.state==='NOT_CREATED'&&<p>{uiText("The task workspace has not been created yet.")}</p>}
      {current.workspace.state==='NOT_PROJECT_MISSION'&&<p>{uiText("This task does not have a separate project workspace.")}</p>}
      {current.workspace.state==='READY'&&<>
        <p>{paths.length} {' '}{uiText("changed files ·")}{' '}{current.workspace.branch}</p>
        {!!current.workspace.hiddenFiles&&<p>{current.workspace.hiddenFiles} {' '}{uiText("files are outside the task’s readable scope.")}</p>}
        {current.workspace.truncated&&<p>{uiText("Showing the first 500 observed files.")}</p>}
        {!paths.length&&<p>{uiText("No file changes observed against the shared Git base.")}</p>}
        {paths.length>0&&<label>{uiText("Changed file")}<select value={file} onChange={event=>setFile(event.target.value)}><option value="">{uiText("Choose a file to review")}</option>{paths.map(entry=><option key={entry.path} value={entry.path}>{entry.path}{entry.untracked?uiText(" · new file"):''}</option>)}</select></label>}
        {patch&&<div className="mission-review-patch"><div><strong>{patch.path}</strong><button type="button" onClick={()=>setWrap(value=>!value)} aria-pressed={wrap}>{uiText("Wrap lines")}</button></div>
          {patch.truncated&&<p>{uiText("This diff is truncated. Review the complete change locally before making a final decision.")}</p>}
          {patchLines.length>3000&&<p>{uiText("Showing the first 3000 lines. Review the full diff locally.")}</p>}
          <pre data-wrap={wrap}>{patchLines.slice(0,3000).map((line,index)=><span key={index} data-kind={line.startsWith('+')&&!line.startsWith('+++')?'add':line.startsWith('-')&&!line.startsWith('---')?'remove':line.startsWith('@@')?'hunk':'context'}>{line||' '}</span>)}</pre>
        </div>}
      </>}
      <details className="mission-review-tests"><summary>{uiText("Recorded test runs (")}{current.tests.length})</summary>
        {!current.tests.length&&<p>{uiText("No test runs recorded.")}</p>}
        {current.tests.map((test,index)=><article key={test.actionId||index}><strong>{test.ok&&test.verified?uiText("Verified test run"):uiText("Test run not verified")}</strong><p>{test.command}</p><pre>{test.output||uiText("No test output recorded.")}</pre></article>)}
      </details>
    </>}
  </section>;
}
