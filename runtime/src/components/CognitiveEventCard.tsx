import React from 'react';
import { Check, X, CircleHelp, ChevronRight, FileCode2, CircleAlert, ArrowUpRight, Search, GitBranch, Play, Target, ShieldCheck } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';

const labels:Record<string,string>={verified:'Verifierat resultat',unverified:'Verifiering saknas',failed:'Steget misslyckades',unknown:'Okänt utfall',observed:'Observerat'};
const icons:Record<string,React.ElementType>={goal:Target,action:Play,observation:Search,plan:GitBranch,decision:GitBranch,blocked:CircleAlert,result:Check,verification:ShieldCheck,recovered:Check};
export const CognitiveEventCard:React.FC<{event:CognitiveEvent;onInspect?:(event:CognitiveEvent)=>void;onOpenFile?:(path:string)=>void}> = ({event,onInspect,onOpenFile}) => {
  const evidence=event.evidence;
  const Icon=evidence.outcome==='failed'?X:evidence.outcome==='unknown'?CircleHelp:icons[event.category] || Search;
  const file=evidence.path && !/^(\/|[a-z]:)|(^|\/)\.\.(\/|$)/i.test(evidence.path) ? evidence.path : null;
  return <article className="cognitive-event" data-outcome={evidence.outcome} data-event-id={event.id}>
    <div className="cognitive-event-icon"><Icon size={15} strokeWidth={1.6}/></div>
    <div className="cognitive-event-body">
      <div className="cognitive-event-heading"><span>{event.title}</span>{['result','verification'].includes(event.category) && <span className="cognitive-proof" data-outcome={evidence.outcome}>{labels[evidence.outcome]}</span>}</div>
      <p>{event.text}</p>
      <div className="cognitive-event-actions">
        {file && onOpenFile && <button type="button" onClick={()=>onOpenFile(file)}><FileCode2 size={12}/>{file.split('/').at(-1)}</button>}
        {evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer"><ArrowUpRight size={12}/>Öppna resultat</a>}
        {onInspect && <button type="button" onClick={()=>onInspect(event)}>Visa belägg<ChevronRight size={12}/></button>}
        <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>
    </div>
  </article>;
};

export function CognitiveEvidence({events,selected,onSelect,onOpenFile}:{events:CognitiveEvent[];selected?:CognitiveEvent|null;onSelect:(event:CognitiveEvent)=>void;onOpenFile:(path:string)=>void}) {
  const results=events.filter(e=>['result','verification','blocked'].includes(e.category));
  const verified=results.filter(e=>e.evidence.outcome==='verified').length;
  return <div className="cognitive-evidence">
    <div className="cognitive-section-kicker">Beslut & belägg</div>
    <h2>Det som faktiskt observerats.</h2>
    <p className="cognitive-muted">Varje resultat går att följa tillbaka till sin händelse. Ett utfört steg behöver fortfarande verifieras.</p>
    <div className="cognitive-evidence-count"><ShieldCheck size={16}/><strong>{verified}</strong> verifierade resultat i det visade flödet</div>
    {selected && <section className="cognitive-selected-evidence" aria-label="Valt belägg">
      <div className="cognitive-section-kicker">Vald händelse</div>
      <h3>{selected.title}</h3><p>{selected.text}</p>
      <dl>
        <dt>Utfall</dt><dd>{labels[selected.evidence.outcome]}</dd>
        <dt>Källa</dt><dd>{selected.durable ? 'Beständig uppdragshistorik' : 'Runtime-observation från denna process'}</dd>
        <dt>Tidpunkt</dt><dd>{new Date(selected.at).toLocaleString('sv-SE')}</dd>
        <dt>Händelse</dt><dd>{selected.id}</dd>
        {selected.missionGoal && <><dt>Uppdrag</dt><dd>{selected.missionGoal}</dd></>}
        {selected.evidence.commit && <><dt>Git-commit</dt><dd>{selected.evidence.commit}</dd></>}
        {selected.evidence.exitCode !== null && <><dt>Exitkod</dt><dd>{selected.evidence.exitCode}</dd></>}
      </dl>
      {selected.evidence.error && <pre>{selected.evidence.error}</pre>}
    </section>}
    {results.length===0 ? <div className="cognitive-empty-detail"><ShieldCheck size={28}/><p>Inga resultat har observerats ännu.</p><span>Beläggen kommer hit när runtime rapporterar dem.</span></div>
      : results.slice().reverse().map(event=><CognitiveEventCard key={event.id} event={event} onInspect={onSelect} onOpenFile={onOpenFile}/>)}
  </div>;
}
