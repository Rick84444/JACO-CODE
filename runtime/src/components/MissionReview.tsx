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
  const [id,setId]=useState(()=>{try{return preferredMissionId||localStorage.getItem('jaco:aura:review-mission:v1')||missions[0]?.id||'';}catch{return preferredMissionId||missions[0]?.id||'';}});
  const [file,setFile]=useState(''),[review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[wrap,setWrap]=useState(true),[revision,setRevision]=useState(0);
  useEffect(()=>{if(preferredMissionId){setId(preferredMissionId);setFile('');}},[preferredMissionId]);
  // A remembered mission ID can belong to a deleted or previous workspace.
  // Do not indefinitely request NOVA_MISSION_NOT_FOUND for a stale selection.
  // Explicit Gameboard navigation remains authoritative even if the list is paginated.
  useEffect(()=>{
    if (preferredMissionId || (id && missions.some(m=>m.id===id))) return;
    const fallback=missions[0]?.id||'';
    if (fallback!==id) {setId(fallback);setFile('');setReview(null);setError('');}
  },[id,missions,preferredMissionId]);
  useEffect(()=>{if(!id&&missions[0])setId(missions[0].id);},[id,missions]);
  useEffect(()=>{try{if(id)localStorage.setItem('jaco:aura:review-mission:v1',id);else localStorage.removeItem('jaco:aura:review-mission:v1');}catch{}},[id]);
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
  return <section className="mission-review" aria-label="Review the agent's changes">
    <header><h2>Agent results</h2><button type="button" onClick={()=>setRevision(value=>value+1)}>Refresh</button></header>
    <p>Changes are read from the mission's own working copy. Your open project is not changed by this review.</p>
    <label>Mission<select value={id} onChange={event=>{setId(event.target.value);setFile('');setReview(null);}}>
      {!missions.some(m=>m.id===id)&&id&&<option value={id}>Previously selected mission</option>}
      {!missions.length&&!id&&<option value="">No missions observed</option>}
      {missions.map(m=><option key={m.id} value={m.id}>{m.goal.slice(0,100)} · {m.status}</option>)}
    </select></label>
    {loading&&<p role="status">Reading the mission's current results…</p>}
    {error&&<p role="alert">The review could not be refreshed: {error}. Earlier observations may be stale.</p>}
    {current&&<>
      <p>{current.status} · {current.phase} · Observed {new Date(current.observedAt).toLocaleTimeString('en-US')}</p>
      {current.contractStatus&&<p>{current.contractStatus.machineVerified?"The mission's registered checks are satisfied.":"Remaining in the mission's checks: "+current.contractStatus.missing.join(', ')}</p>}
      <p>Test evidence applies to the registered run. This review does not run new tests and does not confirm later manual changes.</p>
      {['BLOCKED','AWAITING_VERIFICATION'].includes(current.status)&&<button type="button" onClick={onDecisions}>Show blockers and available decisions</button>}
      {current.workspace.state==='NOT_CREATED'&&<p>The agent's working copy has not been created yet.</p>}
      {current.workspace.state==='NOT_PROJECT_MISSION'&&<p>This mission has no separate project working copy.</p>}
      {current.workspace.state==='READY'&&<>
        <p>{paths.length} changed files · {current.workspace.branch}</p>
        {!!current.workspace.hiddenFiles&&<p>{current.workspace.hiddenFiles} files are outside the mission's readable scope.</p>}
        {current.workspace.truncated&&<p>The file list is limited to the first 500 observed files.</p>}
        {!paths.length&&<p>No file changes observed against the shared Git base.</p>}
        {paths.length>0&&<label>Changed file<select value={file} onChange={event=>setFile(event.target.value)}><option value="">Choose a file to review</option>{paths.map(entry=><option key={entry.path} value={entry.path}>{entry.path}{entry.untracked?' · new file':''}</option>)}</select></label>}
        {patch&&<div className="mission-review-patch"><div><strong>{patch.path}</strong><button type="button" onClick={()=>setWrap(value=>!value)} aria-pressed={wrap}>Line wrap</button></div>
          {patch.truncated&&<p>The diff is truncated. Review the whole change locally before a final decision.</p>}
          {patchLines.length>3000&&<p>The first 3000 lines are shown. Review the whole diff locally.</p>}
          <pre data-wrap={wrap}>{patchLines.slice(0,3000).map((line,index)=><span key={index} data-kind={line.startsWith('+')&&!line.startsWith('+++')?'add':line.startsWith('-')&&!line.startsWith('---')?'remove':line.startsWith('@@')?'hunk':'context'}>{line||' '}</span>)}</pre>
        </div>}
      </>}
      <details className="mission-review-tests"><summary>Registered test runs ({current.tests.length})</summary>
        {!current.tests.length&&<p>No test runs registered.</p>}
        {current.tests.map((test,index)=><article key={test.actionId||index}><strong>{test.ok&&test.verified?'Passed test run':'Test run not verified'}</strong><p>{test.command}</p><pre>{test.output||'No test output registered.'}</pre></article>)}
      </details>
    </>}
  </section>;
}
