import React from 'react';
import { Check, X, CircleHelp, ChevronRight, FileCode2, CircleAlert, ArrowUpRight, Search, GitBranch, Play, Target, ShieldCheck } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';

const labelWords:Record<string,[string,string]>={verified:['Kontrollerat resultat','Verified result'],unverified:['Inte kontrollerat','Not verified'],failed:['Steget misslyckades','Step failed'],unknown:['Okänt utfall','Unknown outcome'],observed:['Observerat','Observed']};
const icons:Record<string,React.ElementType>={goal:Target,action:Play,observation:Search,plan:GitBranch,decision:GitBranch,blocked:CircleAlert,result:Check,verification:ShieldCheck,recovered:Check};
export const CognitiveEventCard:React.FC<{event:CognitiveEvent;onInspect?:(event:CognitiveEvent)=>void;onOpenFile?:(path:string)=>void}> = ({event,onInspect,onOpenFile}) => {
  const {tr,language}=useOptionalUiLanguage();
  const labels=Object.fromEntries(Object.entries(labelWords).map(([k,[sv,en]])=>[k,tr(sv,en)]));
  const evidence=event.evidence;
  const Icon=evidence.outcome==='failed'?X:evidence.outcome==='unknown'?CircleHelp:icons[event.category] || Search;
  // The tree in the green circle is Aura's memory: shown where she saves something.
  const memory=event.category==='memory';
  const file=evidence.path && !/^(\/|[a-z]:)|(^|\/)\.\.(\/|$)/i.test(evidence.path) ? evidence.path : null;
  return <article className="cognitive-event" data-outcome={evidence.outcome} data-event-id={event.id}>
    <div className="cognitive-event-icon">{memory?<img src="/branding/aura-memory.png" alt="" aria-hidden="true" width={22} height={22} className="aura-memory-mark"/>:<Icon size={15} strokeWidth={1.6}/>}</div>
    <div className="cognitive-event-body">
      <div className="cognitive-event-heading"><span>{event.title}</span>{['result','verification'].includes(event.category) && <span className="cognitive-proof" data-outcome={evidence.outcome}>{labels[evidence.outcome]}</span>}</div>
      <p>{event.text}</p>
      <div className="cognitive-event-actions">
        {file && onOpenFile && <button type="button" onClick={()=>onOpenFile(file)}><FileCode2 size={12}/>{file.split('/').at(-1)}</button>}
        {evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer"><ArrowUpRight size={12}/>{tr('Öppna resultatet','Open result')}</a>}
        {event.planId && ['goal','decision','plan','memory'].includes(event.category) && <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('jaco:open-plan',{detail:event.planId}))}><GitBranch size={12}/>Gameboard</button>}
        {onInspect && <button type="button" onClick={()=>onInspect(event)}>{tr('Visa bevis','Show evidence')}<ChevronRight size={12}/></button>}
        <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString(language==='sv'?'sv-SE':'en-US',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>
    </div>
  </article>;
};

export function CognitiveEvidence({events,selected,onSelect,onOpenFile}:{events:CognitiveEvent[];selected?:CognitiveEvent|null;onSelect:(event:CognitiveEvent)=>void;onOpenFile:(path:string)=>void}) {
  const {tr,language}=useOptionalUiLanguage();
  const labels=Object.fromEntries(Object.entries(labelWords).map(([k,[sv,en]])=>[k,tr(sv,en)]));
  const results=events.filter(e=>['result','verification','blocked'].includes(e.category));
  const verified=results.filter(e=>e.evidence.outcome==='verified').length;
  return <div className="cognitive-evidence">
    <div className="cognitive-section-kicker">{tr('Beslut och bevis','Decisions & evidence')}</div>
    <h2>{tr('Det som faktiskt har observerats.','What has actually been observed.')}</h2>
    <p className="cognitive-muted">{tr('Varje resultat går att följa tillbaka till sin händelse. Ett utfört steg måste fortfarande kontrolleras.','Every result can be traced back to its event. An executed step still needs to be verified.')}</p>
    <div className="cognitive-evidence-count"><ShieldCheck size={16}/><strong>{verified}</strong> {tr('kontrollerade resultat i flödet','verified results in the displayed stream')}</div>
    {selected && <section className="cognitive-selected-evidence" aria-label={tr('Valt bevis','Selected evidence')}>
      <div className="cognitive-section-kicker">{tr('Vald händelse','Selected event')}</div>
      <h3>{selected.title}</h3><p>{selected.text}</p>
      <dl>
        <dt>{tr('Utfall','Outcome')}</dt><dd>{labels[selected.evidence.outcome]}</dd>
        <dt>{tr('Källa','Source')}</dt><dd>{selected.durable ? tr('Sparad uppdragshistorik','Saved mission history') : tr('Observation från den pågående körningen','Observation from the running session')}</dd>
        <dt>{tr('Tid','Time')}</dt><dd>{new Date(selected.at).toLocaleString(language==='sv'?'sv-SE':'en-US')}</dd>
        <dt>{tr('Händelse','Event')}</dt><dd>{selected.id}</dd>
        {selected.missionGoal && <><dt>{tr('Uppdrag','Mission')}</dt><dd>{selected.missionGoal}</dd></>}
        {selected.evidence.commit && <><dt>{tr('Git-commit','Git commit')}</dt><dd>{selected.evidence.commit}</dd></>}
        {selected.evidence.exitCode !== null && <><dt>{tr('Slutkod','Exit code')}</dt><dd>{selected.evidence.exitCode}</dd></>}
      </dl>
      {selected.evidence.error && <pre>{selected.evidence.error}</pre>}
    </section>}
    {results.length===0 ? <div className="cognitive-empty-detail"><ShieldCheck size={28}/><p>{tr('Inga resultat har observerats än.','No results have been observed yet.')}</p><span>{tr('Bevisen visas här när de rapporteras.','Evidence appears here when it is reported.')}</span></div>
      : results.slice().reverse().map(event=><CognitiveEventCard key={event.id} event={event} onInspect={onSelect} onOpenFile={onOpenFile}/>)}
  </div>;
}
