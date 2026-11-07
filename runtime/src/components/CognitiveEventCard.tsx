import React from 'react';
import { Check, X, CircleHelp, ChevronRight, FileCode2, CircleAlert, ArrowUpRight, Search, GitBranch, Play, Target, ShieldCheck } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';

const labels:Record<string,string>={verified:'Verified result',unverified:'Not verified',failed:'Step failed',unknown:'Unknown outcome',observed:'Observed'};
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
        {evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer"><ArrowUpRight size={12}/>Open result</a>}
        {event.planId && ['goal','decision','plan'].includes(event.category) && <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('jaco:open-plan',{detail:event.planId}))}><GitBranch size={12}/>Gameboard</button>}
        {onInspect && <button type="button" onClick={()=>onInspect(event)}>Show evidence<ChevronRight size={12}/></button>}
        <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>
    </div>
  </article>;
};

export function CognitiveEvidence({events,selected,onSelect,onOpenFile}:{events:CognitiveEvent[];selected?:CognitiveEvent|null;onSelect:(event:CognitiveEvent)=>void;onOpenFile:(path:string)=>void}) {
  const results=events.filter(e=>['result','verification','blocked'].includes(e.category));
  const verified=results.filter(e=>e.evidence.outcome==='verified').length;
  return <div className="cognitive-evidence">
    <div className="cognitive-section-kicker">Decisions & evidence</div>
    <h2>What has actually been observed.</h2>
    <p className="cognitive-muted">Every result can be traced back to its event. An executed step still needs to be verified.</p>
    <div className="cognitive-evidence-count"><ShieldCheck size={16}/><strong>{verified}</strong> verified results in the displayed stream</div>
    {selected && <section className="cognitive-selected-evidence" aria-label="Selected evidence">
      <div className="cognitive-section-kicker">Selected event</div>
      <h3>{selected.title}</h3><p>{selected.text}</p>
      <dl>
        <dt>Outcome</dt><dd>{labels[selected.evidence.outcome]}</dd>
        <dt>Source</dt><dd>{selected.durable ? 'Durable mission history' : 'Runtime observation from this process'}</dd>
        <dt>Time</dt><dd>{new Date(selected.at).toLocaleString('en-US')}</dd>
        <dt>Event</dt><dd>{selected.id}</dd>
        {selected.missionGoal && <><dt>Mission</dt><dd>{selected.missionGoal}</dd></>}
        {selected.evidence.commit && <><dt>Git-commit</dt><dd>{selected.evidence.commit}</dd></>}
        {selected.evidence.exitCode !== null && <><dt>Exit code</dt><dd>{selected.evidence.exitCode}</dd></>}
      </dl>
      {selected.evidence.error && <pre>{selected.evidence.error}</pre>}
    </section>}
    {results.length===0 ? <div className="cognitive-empty-detail"><ShieldCheck size={28}/><p>No results have been observed yet.</p><span>Evidence appears here when the runtime reports it.</span></div>
      : results.slice().reverse().map(event=><CognitiveEventCard key={event.id} event={event} onInspect={onSelect} onOpenFile={onOpenFile}/>)}
  </div>;
}
