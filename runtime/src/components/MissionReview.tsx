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
  return <section className="mission-review" aria-label="Granska agentens ändringar">
    <header><h2>Agentens resultat</h2><button type="button" onClick={()=>setRevision(value=>value+1)}>Uppdatera</button></header>
    <p>Ändringarna läses från uppdragets egen arbetskopia. Ditt öppna projekt ändras inte av denna granskning.</p>
    <label>Uppdrag<select value={id} onChange={event=>{setId(event.target.value);setFile('');setReview(null);}}>
      {!missions.some(m=>m.id===id)&&id&&<option value={id}>Tidigare valt uppdrag</option>}
      {!missions.length&&!id&&<option value="">Inga uppdrag observerade</option>}
      {missions.map(m=><option key={m.id} value={m.id}>{m.goal.slice(0,100)} · {m.status}</option>)}
    </select></label>
    {loading&&<p role="status">Läser uppdragets aktuella resultat…</p>}
    {error&&<p role="alert">Granskningen kunde inte uppdateras: {error}. Tidigare observationer kan vara föråldrade.</p>}
    {current&&<>
      <p>{current.status} · {current.phase} · Observerat {new Date(current.observedAt).toLocaleTimeString('sv-SE')}</p>
      {current.contractStatus&&<p>{current.contractStatus.machineVerified?'Uppdragets registrerade kontroller är uppfyllda.':'Återstår i uppdragets kontroller: '+current.contractStatus.missing.join(', ')}</p>}
      <p>Testbelägg gäller den registrerade körningen. Granskningen kör inte nya tester och bekräftar inte senare manuella ändringar.</p>
      {['BLOCKED','AWAITING_VERIFICATION'].includes(current.status)&&<button type="button" onClick={onDecisions}>Visa hinder och tillgängliga beslut</button>}
      {current.workspace.state==='NOT_CREATED'&&<p>Agentens arbetskopia har inte skapats ännu.</p>}
      {current.workspace.state==='NOT_PROJECT_MISSION'&&<p>Detta uppdrag har ingen separat projektarbetskopia.</p>}
      {current.workspace.state==='READY'&&<>
        <p>{paths.length} ändrade filer · {current.workspace.branch}</p>
        {!!current.workspace.hiddenFiles&&<p>{current.workspace.hiddenFiles} filer ligger utanför uppdragets läsbara omfattning.</p>}
        {current.workspace.truncated&&<p>Fillistan är begränsad till de första 500 observerade filerna.</p>}
        {!paths.length&&<p>Inga filändringar observerade mot den gemensamma Git-utgångspunkten.</p>}
        {paths.length>0&&<label>Ändrad fil<select value={file} onChange={event=>setFile(event.target.value)}><option value="">Välj en fil att granska</option>{paths.map(entry=><option key={entry.path} value={entry.path}>{entry.path}{entry.untracked?' · ny fil':''}</option>)}</select></label>}
        {patch&&<div className="mission-review-patch"><div><strong>{patch.path}</strong><button type="button" onClick={()=>setWrap(value=>!value)} aria-pressed={wrap}>Radbrytning</button></div>
          {patch.truncated&&<p>Diffen är avkortad. Granska hela ändringen lokalt före ett slutligt beslut.</p>}
          {patchLines.length>3000&&<p>De första 3000 raderna visas. Granska hela diffen lokalt.</p>}
          <pre data-wrap={wrap}>{patchLines.slice(0,3000).map((line,index)=><span key={index} data-kind={line.startsWith('+')&&!line.startsWith('+++')?'add':line.startsWith('-')&&!line.startsWith('---')?'remove':line.startsWith('@@')?'hunk':'context'}>{line||' '}</span>)}</pre>
        </div>}
      </>}
      <details className="mission-review-tests"><summary>Registrerade testkörningar ({current.tests.length})</summary>
        {!current.tests.length&&<p>Inga testkörningar registrerade.</p>}
        {current.tests.map((test,index)=><article key={test.actionId||index}><strong>{test.ok&&test.verified?'Godkänd testkörning':'Testkörning ej verifierad'}</strong><p>{test.command}</p><pre>{test.output||'Ingen testutdata registrerad.'}</pre></article>)}
      </details>
    </>}
  </section>;
}
