import React,{useState} from 'react';
import {PluginLogo} from './McpServersPanel';
import {useOptionalUiLanguage} from '../i18n/UiLanguage';
import {readAuraResponse} from '../lib/auraApi.mjs';
export type FinancialPlugin={id:string;name:string;purpose:string;state:string;docs:string};
export type FinancialStrategy={id:string;title:string;titleSv:string;goal:string;state:string;plugins:FinancialPlugin[];executionVerified:false;financialMutationAllowed:false};
export type FinancialOptions={observed:boolean;plugins:FinancialPlugin[];strategies:FinancialStrategy[]};
export function FinancialOptionsPanel({options,missions=[],onSaved}:{options?:FinancialOptions|null;missions?:{identity:string;goal:string}[];onSaved?:()=>void}){
  const {tr,language}=useOptionalUiLanguage();
  const [selected,setSelected]=useState('');
  const [missionId,setMissionId]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const active=options?.strategies.find(s=>s.id===selected);
  const mission=missions.find(m=>m.identity===missionId);
  const labels:Record<string,[string,string]>={READ_TOOLS_DISCOVERED:['Läsverktyg upptäckta','Read tools discovered'],SETUP_OR_DISCOVERY_REQUIRED:['Anslutning behövs','Setup or discovery needed'],UNOBSERVED:['Ej observerat','Not observed'],AVAILABLE:['Kan konfigureras','Configurable'],ADAPTER_REQUIRED:['Adapter krävs','Adapter required'],OAUTH_REQUIRED:['OAuth krävs','OAuth required'],AUTH_REQUIRED:['Inloggning krävs','Authentication required'],TOOLS_DISCOVERED:['Verktyg upptäckta','Tools discovered'],AGENT_ACCESS_OFF:['Avstängd','Disabled']};
  const label=(state:string)=>labels[state]?tr(...labels[state]):state.replaceAll('_',' ');
  async function apply(){
    if(!active||!mission||busy||!options?.observed)return;
    setBusy(true);setNotice('');setError('');
    try{
      const result=await fetch('/api/aura/workbench/missions/'+encodeURIComponent(mission.identity)+'/steer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),instruction:'Consider financial strategy '+active.id+': '+active.goal+' Preserve the operator goal and current budget and mandate. Use observed, authorized read tools only; if unavailable, report setup needs. No spending, payment, transfer or trading.'})}).then(readAuraResponse);
      if(!result.steering?.revision)throw Error('STRATEGY_NOT_CONFIRMED');
      setNotice(tr('Strategiförslag registrerat. Aura utvärderar det vid nästa planeringssteg.','Strategy suggestion recorded. Aura evaluates it at the next planning step.'));
      onSaved?.();
    }catch(e:any){setError(String(e?.message||'STRATEGY_NOT_CONFIRMED'));}
    finally{setBusy(false);}
  }
  return <details className="rounded-lg border border-neutral-700 p-3 text-xs space-y-2" data-testid="financial-strategy-options">
    <summary className="cursor-pointer font-semibold text-sky-200">{tr('Ekonomiska strategier','Financial strategies')}</summary>
    <p className="text-neutral-400">{tr('Alternativ för Aura, inte godkända transaktioner. Befintlig budget och operatörens mål gäller.','Options for Aura, not authorized transactions. Existing budget and operator goal remain in effect.')}</p>
    {!options?.observed?<p>{tr('Ingen aktuell verktygsobservation.','No current tool observation.')}</p>:<>
      <div className="grid grid-cols-2 gap-2">
        {options.strategies.map(s=><button key={s.id} type="button" aria-pressed={selected===s.id} onClick={()=>{setSelected(s.id);setNotice('');setError('');}} className={'text-left rounded border p-2 '+(selected===s.id?'border-sky-400 bg-sky-950/30':'border-neutral-700')}><strong>{language==='sv'?s.titleSv:s.title}</strong><div className="mt-1 text-neutral-400">{label(s.state)}</div><div className="flex flex-wrap gap-1 mt-2">{s.plugins.slice(0,6).map(p=><PluginLogo key={p.id} id={p.id} name={p.name} size={20}/>)}</div></button>)}
      </div>
      {active&&<div className="rounded border border-neutral-700 p-2 space-y-2">
        <p>{active.goal}</p>
        {active.plugins.map(p=><div key={p.id} className="flex gap-2 items-center"><PluginLogo id={p.id} name={p.name}/><div className="flex-1 min-w-0"><strong>{p.name}</strong><div className="text-neutral-400">{label(p.state)}</div></div><a href={p.docs} target="_blank" rel="noopener noreferrer" className="text-sky-300">{tr('Dokumentation','Docs')}</a></div>)}
        {missions.length>0&&<div className="space-y-2"><select aria-label={tr('Välj aktivt uppdrag','Choose active mission')} className="w-full bg-neutral-900 border border-neutral-700 p-1" value={missionId} onChange={e=>setMissionId(e.target.value)}><option value="">{tr('Välj aktivt uppdrag','Choose active mission')}</option>{missions.map(m=><option key={m.identity} value={m.identity}>{m.goal}</option>)}</select><button type="button" disabled={!mission||busy} onClick={()=>void apply()} className="rounded border border-sky-700 p-2 disabled:opacity-40">{tr('Föreslå strategin till Aura','Suggest strategy to Aura')}</button></div>}
        {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}
      </div>}
    </>}
  </details>;
}
