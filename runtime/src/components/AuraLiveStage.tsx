import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Camera, CheckCircle2, CircleAlert, Clock3, Code2, ExternalLink, Eye, FileCode2, GitCommit, Layers3, ScanEye, ShieldCheck } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { auraStageHistory, cdpRefreshDelay } from '../lib/auraStage.mjs';
import { cognitiveLink } from '../lib/cognitiveEvents.mjs';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { AuraPresence, type AuraPresenceView } from './AuraPresence';
import { CapturedPage, type CapturedPageData } from './CapturedPage';

type Candidate = { event: CognitiveEvent; material: string | null } | null;
type Props = {
  candidate: Candidate;
  projectRevision: number;
  events: CognitiveEvent[];
  preview: React.ReactNode;
  previewReady: boolean;
  active: boolean;
  onInspect: (event: CognitiveEvent) => void;
  onOpenFile: (path: string) => void;
  htmlSource: string | null;
  htmlDraft: string | null;
  onDraftChange: (value: string) => void;
  onSaveDraft: () => void;
  saveBusy: boolean;
  saveNotice: string | null;
  cdpReady: boolean;
  pinned: boolean;
  activeMission: {id:string;goal:string;phase:string|null;status:string} | null;
  agentActivity: {connected:number;working:number};
  presence: AuraPresenceView;
};

const time = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Tid okänd' : parsed.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
};
const outcome = (event: CognitiveEvent) => ({
  verified: 'Verifierat', unverified: 'Inte verifierat', observed: 'Observerat',
  failed: 'Misslyckades', unknown: 'Okänt utfall',
}[event.evidence.outcome] || 'Observation');

export function AuraLiveStage({ candidate, projectRevision, events, preview, previewReady, active, onInspect, onOpenFile, htmlSource, htmlDraft, onDraftChange, onSaveDraft, saveBusy, saveNotice, cdpReady, pinned, activeMission, agentActivity, presence }: Props) {
  const [editing,setEditing]=useState(false);
  const [screenshot,setScreenshot]=useState<{src:string;at:string}|null>(null);
  const [captureBusy,setCaptureBusy]=useState(false);
  const [captureError,setCaptureError]=useState<string|null>(null);
  const [imageLoad,setImageLoad]=useState<'loading'|'loaded'|'failed'>('loading');
  const lastAutoCapture=useRef<string|null>(null);
  const captureEpoch=useRef(0);
  useEffect(()=>{
    // A screenshot belongs to the material visible when capture was requested.
    // Invalidate pending network responses whenever Aura presents another item.
    captureEpoch.current += 1;
    setCaptureBusy(false);
    setEditing(false);setScreenshot(null);setCaptureError(null);setImageLoad('loading');
    return ()=>{captureEpoch.current += 1;};
  },[candidate?.event.id,projectRevision]);
  const captureBrowser=async()=>{
    if(captureBusy || !cdpReady)return false;
    const epoch=++captureEpoch.current;
    setCaptureBusy(true);setCaptureError(null);
    try{
      const reply=await fetch('/api/aura/workbench/mcp/call',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({providerId:'cdp',toolName:'nova_screenshot',arguments:{}}),
        signal:AbortSignal.timeout(25000),cache:'no-store'
      }).then(readAuraResponse);
      if(reply?.result?.isError===true)throw Error('CDP_SCREENSHOT_TOOL_FAILED');
      const png=Array.isArray(reply?.result?.content) ? reply.result.content.find((item:any)=>item?.type==='image' && item?.mimeType==='image/png')?.data : null;
      if(typeof png!=='string'||png.length<1||png.length>8_000_000||!/^[A-Za-z0-9+/=]+$/.test(png))
        throw Error('CDP_PNG_MISSING_OR_INVALID');
      if(epoch===captureEpoch.current)
        setScreenshot({src:'data:image/png;base64,'+png,at:new Date().toISOString()});
      return true;
    }catch(error:any){
      if(epoch===captureEpoch.current)setCaptureError(String(error?.message||error));
      return false;
    }
    finally{if(epoch===captureEpoch.current)setCaptureBusy(false);}
  };
  // The operator asks for the attached page's markup; it stays on the stage until closed, so automatic
  // events do not replace material the operator chose to work on.
  const [capturedPage,setCapturedPage]=useState<CapturedPageData|null>(null);
  // A captured external page must never survive a switch to another project.
  useEffect(()=>{setCapturedPage(null);},[projectRevision]);
  const [pageBusy,setPageBusy]=useState(false);
  const capturePageHtml=async()=>{
    if(pageBusy || !cdpReady)return;
    setPageBusy(true);setCaptureError(null);
    try{
      const reply=await fetch('/api/aura/workbench/mcp/call',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({providerId:'cdp',toolName:'nova_html',arguments:{}}),
        signal:AbortSignal.timeout(25000),cache:'no-store'
      }).then(readAuraResponse);
      let page:any=null;
      try{page=JSON.parse(reply?.result?.content?.[0]?.text||'null');}catch{}
      if(reply?.result?.isError===true || page?.ok!==true)throw Error(page?.error||'CDP_HTML_TOOL_FAILED');
      if(typeof page.html!=='string' || typeof page.url!=='string' || typeof page.sha256!=='string')throw Error('CDP_HTML_MISSING_OR_INVALID');
      setCapturedPage({url:page.url,title:String(page.title||''),html:page.html,sha256:page.sha256,at:page.at||new Date().toISOString()});
    }catch(error:any){setCaptureError(String(error?.message||error));}
    finally{setPageBusy(false);}
  };
  useEffect(()=>{
    const event=candidate?.event;
    if(!cdpReady || pinned || !event || event.id===lastAutoCapture.current)return;
    // Old event streams may be replayed after a restart. Never display a fresh
    // capture as though it belongs to a stale historical screenshot event.
    const age=Date.now()-Date.parse(event.at);
    const confirmed=event.evidence.outcome==='verified' && event.type==='NOVA_ACTION_RESULT'
      && /läser en skärmbild|screenshot/i.test(event.text);
    if(!confirmed || !Number.isFinite(age) || age<0 || age>30_000)return;
    if(document.visibilityState==='hidden')return;
    lastAutoCapture.current=event.id;
    void captureBrowser();
  },[candidate?.event.id,cdpReady,pinned]);
  // While a mission runs, a CDP still that is on screen is refreshed from the same read-only tool,
  // so the stage follows the attached tab instead of freezing at the first capture. Paused when the
  // material is pinned, the page is hidden or no mission is active; failures back off.
  const latestCapture=useRef(captureBrowser);
  latestCapture.current=captureBrowser;
  const refreshFailures=useRef(0);
  const showingCdp=Boolean(screenshot);
  useEffect(()=>{
    if(!cdpReady || pinned || !activeMission || !showingCdp)return;
    let stopped=false, timer=0;
    const schedule=()=>{timer=window.setTimeout(tick,cdpRefreshDelay(refreshFailures.current));};
    const tick=async()=>{
      if(stopped)return;
      if(document.visibilityState!=='hidden'){
        const ok=await latestCapture.current();
        refreshFailures.current=ok?0:refreshFailures.current+1;
      }
      if(!stopped)schedule();
    };
    schedule();
    return()=>{stopped=true;window.clearTimeout(timer);};
  },[cdpReady,pinned,activeMission?.id,showingCdp]);
  const dirty = Boolean(htmlSource !== null && htmlDraft !== null && htmlSource !== htmlDraft);
  const event = candidate?.event || null;
  const history = auraStageHistory(events);
  const material = candidate?.material;
  const url = event ? cognitiveLink(event.evidence.url) : null;
  return <div className="aura-live-stage" data-testid="aura-live-stage">
    <AuraPresence data={presence}/>
    {capturedPage ? <CapturedPage page={capturedPage} onClose={()=>setCapturedPage(null)}/> : !event ? screenshot ? <div className="aura-live-standalone-cdp" aria-label="Observerad webbläsarsida">
      <div className="aura-live-cdp-frame-bar"><Camera size={13}/> Nova-bryggans fästa CDP-flik · {time(screenshot.at)}
        <button type="button" disabled={pageBusy} onClick={()=>void capturePageHtml()}>{pageBusy?'Hämtar sidan…':'Hämta HTML'}</button>
        <button type="button" onClick={()=>setScreenshot(null)}>Tillbaka</button></div>
      <img src={screenshot.src} alt="Faktisk CDP-skärmbild utan modifiering"/>
      <small>En stillbild från den anslutna fliken, inte en liveström.</small>
    </div> : <div className="aura-live-empty" role="status">
      <ScanEye size={34} strokeWidth={1.25}/>
      <h2>Auras arbetsyta</h2>
      <p>{presence.detail}</p>
      <div className="aura-live-empty-context"><span>{presence.connectionLabel}</span><span>Senaste uppdragsläge: {presence.phaseLabel}</span></div>
      <span>Verkliga fynd, kod, bilder och resultat – inte råa händelseloggar.</span>
      {activeMission && <section className="aura-live-mission-focus" aria-label="Verkligt pågående uppdrag">
        <div className="aura-live-material-eyebrow"><Layers3 size={12}/> AKTUELLT UPPDRAG · {activeMission.phase || activeMission.status}</div>
        <strong>{activeMission.goal}</strong>
        <div><span>{agentActivity.working} rapporterade arbetsessioner</span><span>{agentActivity.connected} anslutna agenter</span></div>
        <small>Aura följer observerade uppdrag; inget verifierat visuellt resultat ännu.</small>
      </section>}
      {cdpReady && <button type="button" className="aura-live-capture-button" disabled={captureBusy} onClick={()=>void captureBrowser()}><Camera size={14}/>{captureBusy?'Hämtar bild…':'Visa aktiv CDP-flik'}</button>}
      {cdpReady && <button type="button" className="aura-live-capture-button" disabled={pageBusy} onClick={()=>void capturePageHtml()}><Code2 size={14}/>{pageBusy?'Hämtar sidan…':'Hämta sidans HTML'}</button>}
    </div> : <>
      <header className="aura-live-material-header">
        <div className="aura-live-material-name">
          <div className="aura-live-material-eyebrow"><Layers3 size={13}/> {material === 'html' ? 'PROJEKTFÖRHANDSVISNING' : material === 'image-reference' ? 'BILDREFERENS' : event.category === 'blocked' ? 'ARBETET BEHÖVER HJÄLP' : 'OBSERVATION FRÅN JACO'}</div>
          <h2>{material === 'html' ? (event.evidence.path?.split('/').at(-1) || 'HTML') : event.title}</h2>
          <p>{event.text}</p>
        </div>
        <span className="aura-live-evidence-state" data-outcome={event.evidence.outcome}>
          {event.evidence.outcome === 'verified' ? <CheckCircle2 size={14}/> : <CircleAlert size={14}/>}
          {outcome(event)}
        </span>
      </header>
      {!screenshot && material === 'html' && <div className="aura-live-visual" aria-label="Förhandsvisning av projektfil och arbetskopia">
        {previewReady ? preview : <div className="aura-live-awaiting"><FileCode2 size={28}/><p>Öppnar den verifierade projektfilen…</p><small>En filhändelse är inte en färdig förhandsvisning förrän innehållet kan läsas.</small></div>}
        {editing && previewReady && <div className="aura-live-inline-editor" aria-label="Redigerbar HTML-arbetskopia">
          <div className="aura-live-inline-editor-title"><Code2 size={13}/> Lokal HTML-arbetskopia <span>{dirty?'Osparade ändringar':'Oförändrad'}</span></div>
          <textarea aria-label="Redigera HTML-arbetskopia" spellCheck={false} value={htmlDraft ?? ''} onChange={event=>onDraftChange(event.target.value)}/>
          <div className="aura-live-inline-editor-actions"><button type="button" disabled={!dirty || saveBusy} onClick={onSaveDraft}>{saveBusy?'Sparar…':'Spara till projektet'}</button><button type="button" onClick={()=>setEditing(false)}>Visa bara resultat</button></div>
          {saveNotice && <p role="status">{saveNotice}</p>}
        </div>}
      </div>}
      {!screenshot && material === 'image-reference' && <div className="aura-live-visual aura-live-image-frame" aria-label="Faktisk bild från projektets arbetsyta">
        {event.evidence.path && <img
          key={event.id}
          src={'/api/aura/workbench/image?path='+encodeURIComponent(event.evidence.path)}
          alt={'Bild från projektfilen '+event.evidence.path}
          onLoad={()=>setImageLoad('loaded')} onError={()=>setImageLoad('failed')}
          hidden={imageLoad!=='loaded'}/>}
        {imageLoad==='loading' && <div className="aura-live-awaiting"><Camera size={30}/><p>Läser bildfilen från projektet…</p></div>}
        {imageLoad==='failed' && <div className="aura-live-awaiting"><CircleAlert size={26}/><h3>Bild kunde inte läsas</h3><p>Den rapporterade filen saknas eller är inte giltig PNG, JPEG eller WebP.</p></div>}
        {imageLoad==='loaded' && <small>Aktuell bild från projektfilen. Originalbildens bytehash från agenthändelsen är inte verifierad.</small>}
      </div>}
      {screenshot && <div className="aura-live-visual aura-live-cdp-frame" aria-label="Faktisk bild från CDP:s fästa webbläsarflik">
        <div className="aura-live-cdp-frame-bar"><Camera size={13}/> Aktuell bild från Nova-bryggans fästa flik · {time(screenshot.at)}
          <button type="button" onClick={()=>setScreenshot(null)}>Återgå till materialet</button></div>
        <img src={screenshot.src} alt="Observerad PNG-skärmbild från den anslutna CDP-bryggan"/>
        <small>Fliken kommer från bryggans aktiva mål, inte från en valbar lista. Inga webbläsaråtgärder utfördes.</small>
      </div>}
      {!screenshot && !material && <div className="aura-live-event-focus" data-outcome={event.evidence.outcome}>
        <div className="aura-live-event-accent">{event.evidence.outcome === 'verified' ? <ShieldCheck size={30} strokeWidth={1.3}/> : <Eye size={30} strokeWidth={1.3}/>}</div>
        <div><strong>{event.title}</strong><p>{event.text}</p>
          {event.evidence.error && <div className="aura-live-event-error">{event.evidence.error}</div>}
          {event.evidence.commit && <span className="aura-live-commit"><GitCommit size={13}/> {event.evidence.commit.slice(0,14)}</span>}
        </div>
      </div>}
      {activeMission && <div className="aura-live-mission-strip" aria-label="Pågående agentarbete"><Layers3 size={14}/><span>{activeMission.goal}</span><small>{activeMission.phase || activeMission.status} · {agentActivity.working} arbetsessioner</small></div>}
      <div className="aura-live-context-actions">
        {cdpReady && <button type="button" disabled={captureBusy} onClick={()=>void captureBrowser()}><Camera size={14}/>{captureBusy?'Hämtar…':'Visa CDP-bild'}</button>}
        {material === 'html' && previewReady && <button type="button" onClick={()=>setEditing(value=>!value)}><Code2 size={14}/>{editing?'Dölj källkod':'Redigera arbetskopia'}</button>}
        {material === 'html' && event.evidence.path && <button type="button" onClick={() => onOpenFile(event.evidence.path!)}><FileCode2 size={14}/> Öppna i kodeditorn</button>}
        {url && <a href={url} rel="noopener noreferrer" target="_blank"><ExternalLink size={14}/> Öppna observerad länk <ArrowUpRight size={12}/></a>}
        <button type="button" onClick={() => onInspect(event)}><ShieldCheck size={14}/> Granska belägg</button>
        <span><Clock3 size={12}/> {time(event.at)}</span>
      </div>
    </>}
    {captureError && <p role="alert" className="aura-live-capture-error">CDP-bilden kunde inte hämtas: {captureError}</p>}
    {history.length > 0 && <details className="aura-live-history">
      <summary>Visa körhistorik <span>{history.length} händelsetyper</span></summary>
      <div className="aura-live-history-items">
        {history.map(({event: entry, count}) => <button type="button" key={entry.id} onClick={() => onInspect(entry)}>
          <span className="aura-live-history-indicator" data-outcome={entry.evidence.outcome}/>
          <span>{entry.text}</span>
          {count>1 && <small>{count}×</small>}
          <time>{time(entry.at)}</time>
        </button>)}
      </div>
    </details>}
  </div>;
}
