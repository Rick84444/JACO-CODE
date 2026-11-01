import { useUiLanguage } from '../i18n/UiLanguage';
import React from 'react';
import { Check, X, CircleHelp, ChevronRight, FileCode2, CircleAlert, ArrowUpRight, Search, GitBranch, Play, Target, ShieldCheck } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';

const labels:Record<string,string>={verified:"Verified result",unverified:"Verification missing",failed:"The step failed",unknown:"Unknown outcome",observed:"Observed"};
const icons:Record<string,React.ElementType>={goal:Target,action:Play,observation:Search,plan:GitBranch,decision:GitBranch,blocked:CircleAlert,result:Check,verification:ShieldCheck,recovered:Check};
export const CognitiveEventCard:React.FC<{event:CognitiveEvent;onInspect?:(event:CognitiveEvent)=>void;onOpenFile?:(path:string)=>void}> = ({event,onInspect,onOpenFile}) => {
  const { t: uiText } = useUiLanguage();
  const evidence=event.evidence;
  const Icon=evidence.outcome==='failed'?X:evidence.outcome==='unknown'?CircleHelp:icons[event.category] || Search;
  const file=evidence.path && !/^(\/|[a-z]:)|(^|\/)\.\.(\/|$)/i.test(evidence.path) ? evidence.path : null;
  return <article className="cognitive-event" data-outcome={evidence.outcome} data-event-id={event.id}>
    <div className="cognitive-event-icon"><Icon size={15} strokeWidth={1.6}/></div>
    <div className="cognitive-event-body">
      <div className="cognitive-event-heading"><span>{uiText(event.title)}</span>{['result','verification'].includes(event.category) && <span className="cognitive-proof" data-outcome={evidence.outcome}>{uiText(labels[evidence.outcome])}</span>}</div>
      <p>{event.category === 'goal' ? event.text : uiText(event.text)}</p>
      <div className="cognitive-event-actions">
        {file && onOpenFile && <button type="button" onClick={()=>onOpenFile(file)}><FileCode2 size={12}/>{file.split('/').at(-1)}</button>}
        {evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer"><ArrowUpRight size={12}/>{uiText("Open result")}</a>}
        {onInspect && <button type="button" onClick={()=>onInspect(event)}>{uiText("View evidence")}<ChevronRight size={12}/></button>}
        <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>
    </div>
  </article>;
};

export function CognitiveEvidence({events,selected,onSelect,onOpenFile}:{events:CognitiveEvent[];selected?:CognitiveEvent|null;onSelect:(event:CognitiveEvent)=>void;onOpenFile:(path:string)=>void}) {
  const { t: uiText } = useUiLanguage();
  const results=events.filter(e=>['result','verification','blocked'].includes(e.category));
  const verified=results.filter(e=>e.evidence.outcome==='verified').length;
  return <div className="cognitive-evidence">
    <div className="cognitive-section-kicker">{uiText("Decisions & evidence")}</div>
    <h2>{uiText("What was observed.")}</h2>
    <p className="cognitive-muted">{uiText("Each result links to its source event. Completed steps still need verification.")}</p>
    <div className="cognitive-evidence-count"><ShieldCheck size={16}/><strong>{verified}</strong> {' '}{uiText("verified results in this view")}</div>
    {selected && <section className="cognitive-selected-evidence" aria-label={uiText("Selected evidence")}>
      <div className="cognitive-section-kicker">{uiText("Selected event")}</div>
      <h3>{uiText(selected.title)}</h3><p>{selected.category === 'goal' ? selected.text : uiText(selected.text)}</p>
      <dl>
        <dt>{uiText("Outcome")}</dt><dd>{uiText(labels[selected.evidence.outcome])}</dd>
        <dt>{uiText("Source")}</dt><dd>{selected.durable ? uiText("Saved task history") : uiText("System observation from this process")}</dd>
        <dt>{uiText("Time")}</dt><dd>{new Date(selected.at).toLocaleString('sv-SE')}</dd>
        <dt>{uiText("Event")}</dt><dd>{selected.id}</dd>
        {selected.missionGoal && <><dt>{uiText("Task")}</dt><dd>{selected.missionGoal}</dd></>}
        {selected.evidence.commit && <><dt>{uiText("Git commit")}</dt><dd>{selected.evidence.commit}</dd></>}
        {selected.evidence.exitCode !== null && <><dt>{uiText("Exit code")}</dt><dd>{selected.evidence.exitCode}</dd></>}
      </dl>
      {selected.evidence.error && <pre>{selected.evidence.error}</pre>}
    </section>}
    {results.length===0 ? <div className="cognitive-empty-detail"><ShieldCheck size={28}/><p>{uiText("No results observed yet.")}</p><span>{uiText("Evidence appears when reported by JACO.")}</span></div>
      : results.slice().reverse().map(event=><CognitiveEventCard key={event.id} event={event} onInspect={onSelect} onOpenFile={onOpenFile}/>)}
  </div>;
}
