import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Camera, CheckCircle2, CircleAlert, Clock3, Code2, ExternalLink, Eye, FileCode2, GitCommit, Layers3, ScanEye, ShieldCheck } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { auraStageHistory } from '../lib/auraStage.mjs';
import { cognitiveLink } from '../lib/cognitiveEvents.mjs';
import { readAuraResponse } from '../lib/auraApi.mjs';

type Candidate = { event: CognitiveEvent; material: string | null } | null;
type Props = {
  candidate: Candidate;
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
};

const time = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Tid okänd' : parsed.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
};
const outcome = (event: CognitiveEvent) => ({
  verified: 'Verifierat', unverified: 'Inte verifierat', observed: 'Observerat',
  failed: 'Misslyckades', unknown: 'Okänt utfall',
}[event.evidence.outcome] || 'Observation');

export function AuraLiveStage({ candidate, events, preview, previewReady, active, onInspect, onOpenFile, htmlSource, htmlDraft, onDraftChange, onSaveDraft, saveBusy, saveNotice, cdpReady }: Props) {
  const [editing,setEditing]=useState(false);
  const [screenshot,setScreenshot]=useState<{src:string;at:string}|null>(null);
  const [captureBusy,setCaptureBusy]=useState(false);
  const [captureError,setCaptureError]=useState<string|null>(null);
  useEffect(()=>{setEditing(false);setScreenshot(null);setCaptureError(null);},[candidate?.event.id]);
  const captureBrowser=async()=>{
    if(captureBusy || !cdpReady)return;
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
      setScreenshot({src:'data:image/png;base64,'+png,at:new Date().toISOString()});
    }catch(error:any){setCaptureError(String(error?.message||error));}
    finally{setCaptureBusy(false);}
  };
  const dirty = Boolean(htmlSource !== null && htmlDraft !== null && htmlSource !== htmlDraft);
  const event = candidate?.event || null;
  const history = auraStageHistory(events);
  const material = candidate?.material;
  const url = event ? cognitiveLink(event.evidence.url) : null;
  return <div className="aura-live-stage" data-testid="aura-live-stage">
    {!event ? <div className="aura-live-empty" role="status">
      <ScanEye size={34} strokeWidth={1.25}/>
      <h2>Auras arbetsyta</h2>
      <p>{active ? 'Aura arbetar. Inget nytt verifierbart material att visa ännu.' : 'När Aura hittar eller skapar något relevant visas det här automatiskt.'}</p>
      <span>Verkliga fynd, kod, bilder och resultat – inte råa händelseloggar.</span>
      {cdpReady && <button type="button" className="aura-live-capture-button" disabled={captureBusy} onClick={()=>void captureBrowser()}><Camera size={14}/>{captureBusy?'Hämtar bild…':'Visa aktiv CDP-flik'}</button>}
      {screenshot && <div className="aura-live-empty-cdp"><img src={screenshot.src} alt="Faktiskt observerad CDP-skärmbild"/><small>Nova-bryggans fästa flik · {time(screenshot.at)}</small></div>}
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
      {!screenshot && material === 'image-reference' && <div className="aura-live-awaiting aura-live-visual">
        <Camera size={38}/><h3>{event.evidence.path?.split('/').at(-1)}</h3>
        <p>Bildfilen har rapporterats i projektet.</p>
        <small>En verifierad bildhämtning med rätt mål och media-API krävs innan vi kan visa pixlarna här.</small>
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
