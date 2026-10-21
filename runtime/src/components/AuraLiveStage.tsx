import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Camera, CheckCircle2, CircleAlert, Clock3, Code2, ExternalLink, Eye, FileCode2, GitCommit, Layers3, ScanEye, ShieldCheck } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { auraStageHistory } from '../lib/auraStage.mjs';
import { cognitiveLink } from '../lib/cognitiveEvents.mjs';

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
};

const time = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Tid okänd' : parsed.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
};
const outcome = (event: CognitiveEvent) => ({
  verified: 'Verifierat', unverified: 'Inte verifierat', observed: 'Observerat',
  failed: 'Misslyckades', unknown: 'Okänt utfall',
}[event.evidence.outcome] || 'Observation');

export function AuraLiveStage({ candidate, events, preview, previewReady, active, onInspect, onOpenFile, htmlSource, htmlDraft, onDraftChange, onSaveDraft, saveBusy, saveNotice }: Props) {
  const [editing,setEditing]=useState(false);
  useEffect(()=>{setEditing(false);},[candidate?.event.id]);
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
      {material === 'html' && <div className="aura-live-visual" aria-label="Förhandsvisning av projektfil och arbetskopia">
        {previewReady ? preview : <div className="aura-live-awaiting"><FileCode2 size={28}/><p>Öppnar den verifierade projektfilen…</p><small>En filhändelse är inte en färdig förhandsvisning förrän innehållet kan läsas.</small></div>}
        {editing && previewReady && <div className="aura-live-inline-editor" aria-label="Redigerbar HTML-arbetskopia">
          <div className="aura-live-inline-editor-title"><Code2 size={13}/> Lokal HTML-arbetskopia <span>{dirty?'Osparade ändringar':'Oförändrad'}</span></div>
          <textarea aria-label="Redigera HTML-arbetskopia" spellCheck={false} value={htmlDraft ?? ''} onChange={event=>onDraftChange(event.target.value)}/>
          <div className="aura-live-inline-editor-actions"><button type="button" disabled={!dirty || saveBusy} onClick={onSaveDraft}>{saveBusy?'Sparar…':'Spara till projektet'}</button><button type="button" onClick={()=>setEditing(false)}>Visa bara resultat</button></div>
          {saveNotice && <p role="status">{saveNotice}</p>}
        </div>}
      </div>}
      {material === 'image-reference' && <div className="aura-live-awaiting aura-live-visual">
        <Camera size={38}/><h3>{event.evidence.path?.split('/').at(-1)}</h3>
        <p>Bildfilen har rapporterats i projektet.</p>
        <small>En verifierad bildhämtning med rätt mål och media-API krävs innan vi kan visa pixlarna här.</small>
      </div>}
      {!material && <div className="aura-live-event-focus" data-outcome={event.evidence.outcome}>
        <div className="aura-live-event-accent">{event.evidence.outcome === 'verified' ? <ShieldCheck size={30} strokeWidth={1.3}/> : <Eye size={30} strokeWidth={1.3}/>}</div>
        <div><strong>{event.title}</strong><p>{event.text}</p>
          {event.evidence.error && <div className="aura-live-event-error">{event.evidence.error}</div>}
          {event.evidence.commit && <span className="aura-live-commit"><GitCommit size={13}/> {event.evidence.commit.slice(0,14)}</span>}
        </div>
      </div>}
      <div className="aura-live-context-actions">
        {material === 'html' && previewReady && <button type="button" onClick={()=>setEditing(value=>!value)}><Code2 size={14}/>{editing?'Dölj källkod':'Redigera arbetskopia'}</button>}
        {material === 'html' && event.evidence.path && <button type="button" onClick={() => onOpenFile(event.evidence.path!)}><FileCode2 size={14}/> Öppna i kodeditorn</button>}
        {url && <a href={url} rel="noopener noreferrer" target="_blank"><ExternalLink size={14}/> Öppna observerad länk <ArrowUpRight size={12}/></a>}
        <button type="button" onClick={() => onInspect(event)}><ShieldCheck size={14}/> Granska belägg</button>
        <span><Clock3 size={12}/> {time(event.at)}</span>
      </div>
    </>}
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
