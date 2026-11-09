import React, { useCallback, useEffect, useState } from 'react';
import { Activity, GitBranch, Network, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';

interface Tool { identity:string;numericId:number;providerId:string;name:string;status:string;readOnly:boolean;agentAllowed:boolean;metrics:{calls:number|null;failures:number|null;successProbability:number|null} }
interface Move {identity:string;numericId:number;score:number|null;executable:boolean;blockedBy:string[]}
interface Plan {identity:string;numericId:number;objective:string;status:string;nodes:Array<{title:string;status:string;priority:number|null;evidenceRefs:string[]}>;moves:Move[];simulation:{status:string;forecast?:{terminalProbability?:number;score?:number;order?:string[]};reason?:string}}
interface GameboardEntry {revision:number;actorId:string;actorNumericId:number;kind:string;statement:string;target:string|null;evidenceStatus:string;metrics:{confidence:number;informationGain:number;goalImpact:number}|null}
interface Mission {identity:string;status:string;goal:string;phase:string|null;source:string;updatedAt:string|null;actionCount:number;verifiedActions:number;lastError:string|null;evidenceStatus:string;reviewAvailable:boolean}
interface ActivityEntry {id:string;numericId:number;type:string;at:string|null;missionId:string|null;taskType:string|null;outcome:'VERIFIED'|'FAILED'|'BLOCKED'|'OBSERVED';error:string|null;evidenceRef:string}
interface Position {exchange?:{revision:number;entries:GameboardEntry[]};schema:string;observedAt:string;graphSource:string;graphError:string|null;agents:Array<{identity:string;numericId:number;status:string}>;tools:Tool[];plans:Plan[];missions:Mission[];operatorGoal:{statement:string;status:string;source:string}|null;activity:ActivityEntry[];next:{code:string;missionId:string|null;text:string}}
interface ScenarioResult {status:string;executed:boolean;verified:boolean;result:{terminalProbability:number;score:number;order:string[]}}
const intId=(value:number)=>String(value).padStart(15,'0');
const probability=(v:number|undefined)=>Number.isFinite(v)?(Number(v)*100).toFixed(1)+' %':'Unknown';
const asError=(e:unknown)=>e instanceof Error?e.message:String(e);

export function CognitiveGameboard() {
  const [position,setPosition]=useState<Position|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [first,setFirst]=useState('');
  const [second,setSecond]=useState('');
  const [confidence,setConfidence]=useState(0.8);
  const [risk,setRisk]=useState(0.2);
  const [simulation,setSimulation]=useState<ScenarioResult|null>(null);
  const [simulationError,setSimulationError]=useState<string|null>(null);
  const refresh=useCallback(async()=>{
    try {
      const response=await fetch('/api/aura/workbench/gameboard',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(!response.ok||!data.success||data.schema!=='jaco.gameboard-fabric/v1') throw Error(data.error||'GAMEBOARD_UNAVAILABLE');
      setPosition(data);setError(null);
    } catch(e){setError(asError(e));}
  },[]);
  useEffect(()=>{void refresh();const interval=window.setInterval(()=>void refresh(),10000);return()=>window.clearInterval(interval);},[refresh]);
  const simulate=async()=>{
    if(!first) return;
    setLoading(true);setSimulationError(null);
    try {
      const steps=[{
        id:'move-1',title:first,goalImpact:0.7,verificationGain:0.6,informationGain:0.7,
        confidence,risk,effort:0.4,
      }];
      if(second) steps.push({
        id:'move-2',title:second,dependencies:['move-1'],goalImpact:0.9,verificationGain:0.9,
        informationGain:0.2,confidence,risk,effort:0.6,
      } as typeof steps[number]);
      const response=await fetch('/api/aura/workbench/gameboard/simulate',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({goalId:'scenario:tool-chain',missionId:'scenario:local',steps}),
      });
      const data=await response.json();
      if(!response.ok||!data.success||data.status!=='SIMULATED')throw Error(data.error||'SIMULATION_FAILED');
      setSimulation(data);
    }catch(e){setSimulationError(asError(e));}finally{setLoading(false);}
  };
  const toolNames=(position?.tools||[]).map(tool=>tool.identity);
  return <section className="h-full overflow-auto bg-[#1a1b1d] text-neutral-200 p-4 space-y-4" aria-label="Shared gameboard">
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div><div className="flex items-center gap-2 text-sm font-semibold"><Network size={17} className="text-neutral-200"/>Gameboard</div>
        <p className="mt-1 text-xs text-neutral-300">Live goal, mission execution, receipts and separate simulations</p></div>
      <button type="button" onClick={()=>void refresh()} className="flex items-center gap-2 text-xs border border-neutral-600 px-3 py-2 rounded hover:border-neutral-600"><RefreshCw size={13}/>Refresh</button>
    </div>
    {error&&<p className="border border-amber-800 rounded p-2 text-amber-300 text-xs" role="alert">Could not read a new position: {error}. The last observed data is shown, if any.</p>}
    <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-300">
      <span><Activity size={13} className="inline mr-1"/>Aura planning: {position?.graphSource==='OBSERVED'?'Graph observed':position?.graphSource==='OBSERVED_EMPTY'?'Graph pending':position?.graphSource==='UNAVAILABLE'?'Planner unavailable':'Not observed'}</span>
      <span><Wrench size={13} className="inline mr-1"/>{position?.tools.length??'–'} advertised tools</span>
      <span>{position?.agents.length??'–'} workers</span>
      <span>{position?.observedAt?new Date(position.observedAt).toLocaleTimeString('en-US'):'No observation'}</span>
    </div>
    {position?.graphError&&<p className="text-xs text-amber-300">Strategic graph unavailable: {position.graphError}. Tools and scenario calculation can still be used.</p>}
    <section data-testid="gameboard-operational-position" className="rounded-lg border border-neutral-600 bg-[#222326] p-4 space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-neutral-300">Aura · current goal and execution</div>
      <h2 className="text-sm font-semibold leading-relaxed">{position?.operatorGoal?.statement || position?.missions.find(m=>m.status==='ACTIVE')?.goal || 'No active operator goal observed'}</h2>
      <p className="text-xs text-neutral-400">{position?.operatorGoal
        ? 'Goal recorded by Aura. A goal is not a plan or a verified result.'
        : 'The runtime has not reported a primary operator goal.'}</p>
      <div data-testid="gameboard-next-action" className="rounded border border-neutral-700 bg-black/20 p-2 text-xs">
        <strong className="text-neutral-200">Next observable checkpoint</strong>
        <p className="mt-1 text-neutral-300">{position?.next?.text || 'Awaiting runtime observation.'}</p>
      </div>
      {position?.missions.length ? <div data-testid="gameboard-mission-list" className="space-y-2">
        {position.missions.slice(0,6).map(m=><article key={m.identity} className="rounded border border-neutral-700 bg-[#1b1c1e] p-2 text-xs space-y-1">
          <div className="flex flex-wrap justify-between gap-2">
            <strong className="text-neutral-100">{m.goal}</strong>
            <span className={m.status==='BLOCKED'||m.status==='FAILED'?'text-rose-300':m.status==='ACTIVE'?'text-blue-300':'text-neutral-400'}>{m.status}{m.phase?' · '+m.phase:''}</span>
          </div>
          <div className="text-neutral-400">{m.actionCount} action receipts · <span className="text-emerald-300">{m.verifiedActions} verified</span> · {m.evidenceStatus}</div>
          {m.lastError&&<p className="text-rose-300 break-words">Last failed action: {m.lastError}</p>}
          <div className="flex justify-between items-center gap-2 text-[10px] text-neutral-500">
            <span>Mission {m.identity}</span>
            {m.reviewAvailable
              ? <button type="button" className="rounded border border-neutral-600 px-2 py-1 text-neutral-200 hover:bg-neutral-700" onClick={()=>window.dispatchEvent(new CustomEvent('jaco:open-mission-evidence',{detail:m.identity}))}>Review execution &amp; evidence</button>
              : <span className="text-neutral-500">No mission worktree review available</span>}
          </div>
        </article>)}
      </div>:<p data-testid="gameboard-no-mission" className="text-xs text-amber-300">No durable mission observed. Goal registration alone does not prove execution.</p>}
    </section>
    <section data-testid="gameboard-durable-evidence" className="rounded-lg border border-neutral-700 bg-[#292a2c] p-3 space-y-2">
      <h3 className="text-xs font-semibold flex gap-2 items-center"><Activity size={15}/>Durable execution timeline</h3>
      <p className="text-xs text-neutral-300">Events from the Mission Bus. Only verified action receipts are marked VERIFIED. Registration and planning are observations.</p>
      {position?.activity?.length ? <div className="max-h-64 overflow-auto space-y-2">{position.activity.slice(0,15).map(event=>
        <div key={event.id} className="text-xs border-t border-neutral-700 pt-2">
          <div className="flex flex-wrap justify-between gap-2"><strong>{event.taskType||event.type}</strong>
            <span className={event.outcome==='VERIFIED'?'text-emerald-300':event.outcome==='FAILED'||event.outcome==='BLOCKED'?'text-rose-300':'text-neutral-400'}>{event.outcome}</span></div>
          <div className="text-neutral-400">{event.at?new Date(event.at).toLocaleString():'Time unknown'} · {event.type} · {event.evidenceRef}{event.missionId?' · '+event.missionId:''}</div>
          {event.error&&<p className="text-rose-300 break-words">{event.error}</p>}
        </div>)}</div>:<p className="text-xs text-neutral-400">No durable mission events observed.</p>}
    </section>
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-neutral-700 bg-[#2a2b2d] p-3 space-y-2">
        <h3 className="text-xs font-semibold flex gap-2 items-center"><GitBranch size={15}/>Missions and forecasts</h3>
        {position?.plans.length?position.plans.slice(0,6).map(plan=><div key={plan.identity} className="border-t border-neutral-700 pt-2 text-xs space-y-1">
          <div className="font-medium break-words">{plan.objective||plan.identity}</div>
          <div className="text-neutral-400">#{intId(plan.numericId)} · {plan.status} · {plan.nodes.length} steps</div>
          {plan.simulation?.status==='SIMULATED'
            ?<div className="text-neutral-200">Simulated terminal probability: {probability(plan.simulation.forecast?.terminalProbability)}</div>
            :<div className="text-neutral-400">No verifiable simulation for this plan</div>}
          <div className="text-neutral-300">Eligible simulated moves: {plan.moves.filter(m=>m.executable).length}</div>
        </div>):<p className="text-neutral-400 text-xs">{position?.operatorGoal?'A goal is registered, but no SEER planning graph has been observed.':'No planning graph observed for Aura.'} {position?.missions.length?position.missions.length+' durable missions are on the bus.':''}</p>}
      </div>
      <div className="rounded-lg border border-neutral-700 bg-[#2a2b2d] p-3 space-y-2">
        <h3 className="text-xs font-semibold flex gap-2 items-center"><Wrench size={15}/>Tool identities</h3>
        {!position?.tools.length&&<p className="text-xs text-neutral-400">No tools advertised. An ID entry does not confirm that a tool works.</p>}
        <div className="max-h-56 overflow-auto space-y-1">
          {position?.tools.slice(0,80).map(tool=><div key={tool.identity} className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-neutral-700/60">
            <span className="truncate" title={tool.identity}>{tool.providerId}.{tool.name}</span>
            <span className="text-neutral-400 shrink-0" title={tool.identity}>#{intId(tool.numericId)} · provider {tool.status} · not execution-verified</span>
          </div>)}
        </div>
      </div>
    </div>

    <div className="rounded-lg border border-neutral-700 bg-[#2a2b2d] p-3 space-y-2">
      <h3 className="text-xs font-semibold flex gap-2 items-center"><Network size={15}/>Agents' mathematical messages</h3>
      <p className="text-xs text-neutral-300">Revision {position?.exchange?.revision??'–'}. Agent hypotheses are separate from Mission Bus receipts. Revision zero does not mean the system has done no work.</p>
      {position?.exchange?.entries?.length?position.exchange.entries.slice(-12).reverse().map(entry=><div className="text-xs border-t border-neutral-700 pt-2 space-y-0.5" key={entry.revision}>
        <div className="text-neutral-200">{entry.kind} · #{intId(entry.actorNumericId)} · rev {entry.revision}</div>
        <div className="text-neutral-300 break-words">{entry.statement}</div>
        {entry.metrics&&<div className="text-neutral-200">Information gain {probability(entry.metrics.informationGain)} · goal impact {probability(entry.metrics.goalImpact)} · confidence {probability(entry.metrics.confidence)}</div>}
        <div className="text-[10px] text-amber-300">{entry.evidenceStatus}</div>
      </div>):<p className="text-xs text-neutral-400">No mathematical observations published yet.</p>}
    </div>
    <details className="rounded-lg border border-neutral-800/70 bg-[#292a2c] p-3 space-y-3">
      <summary className="text-xs font-semibold cursor-pointer flex gap-2 items-center"><ShieldCheck size={15} className="text-neutral-200"/>Optional scenario laboratory · simulation only</summary>
      <p className="text-xs text-neutral-300">Pure scenario analysis – no agent runs and no files change. All numeric assumptions are hypothetical, not measured tool performance.</p>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-xs space-y-1 block"><span>First move/tool</span><input list="gameboard-tools" value={first} onChange={e=>setFirst(e.target.value)} placeholder="Example: git.git_status" maxLength={180} className="w-full rounded border border-neutral-600 bg-[#1a1b1d] p-2"/></label>
        <label className="text-xs space-y-1 block"><span>Next move (optional)</span><input list="gameboard-tools" value={second} onChange={e=>setSecond(e.target.value)} placeholder="Verify result" maxLength={180} className="w-full rounded border border-neutral-600 bg-[#1a1b1d] p-2"/></label>
        <datalist id="gameboard-tools">{toolNames.map(name=><option key={name} value={name}/>)}</datalist>
        <label className="text-xs space-y-1 block"><span>Assumed success rate: {probability(confidence)}</span><input aria-label="Assumed success rate" className="w-full" type="range" min="0.05" max="1" step="0.05" value={confidence} onChange={e=>setConfidence(Number(e.target.value))}/></label>
        <label className="text-xs space-y-1 block"><span>Assumed risk: {probability(risk)}</span><input aria-label="Assumed risk" className="w-full" type="range" min="0" max="1" step="0.05" value={risk} onChange={e=>setRisk(Number(e.target.value))}/></label>
      </div>
      <button type="button" disabled={!first.trim()||loading} onClick={()=>void simulate()} className="rounded bg-neutral-700 px-4 py-2 text-xs font-medium disabled:opacity-50">{loading?'Calculating…':'Simulate without execution'}</button>
      {simulationError&&<p role="alert" className="text-xs text-red-300">{simulationError}</p>}
      {simulation&&<div className="border-t border-neutral-900 pt-3 text-xs"><div className="text-neutral-200 font-semibold">Simulated terminal probability: {probability(simulation.result.terminalProbability)}</div><p className="text-neutral-300 mt-1">Executed: no · Verified: no · {simulation.result.order.length} planned steps</p></div>}
    </details>
  </section>;
}
