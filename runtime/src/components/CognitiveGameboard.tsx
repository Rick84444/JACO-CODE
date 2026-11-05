import React, { useCallback, useEffect, useState } from 'react';
import { Activity, GitBranch, Network, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';

interface Tool { identity:string;numericId:number;providerId:string;name:string;status:string;readOnly:boolean;agentAllowed:boolean;metrics:{calls:number|null;failures:number|null;successProbability:number|null} }
interface Move {identity:string;numericId:number;score:number|null;executable:boolean;blockedBy:string[]}
interface Plan {identity:string;numericId:number;objective:string;status:string;nodes:Array<{title:string;status:string;priority:number|null;evidenceRefs:string[]}>;moves:Move[];simulation:{status:string;forecast?:{terminalProbability?:number;score?:number;order?:string[]};reason?:string}}
interface GameboardEntry {revision:number;actorId:string;actorNumericId:number;kind:string;statement:string;target:string|null;evidenceStatus:string;metrics:{confidence:number;informationGain:number;goalImpact:number}|null}
interface Position {exchange?:{revision:number;entries:GameboardEntry[]};schema:string;observedAt:string;graphSource:string;graphError:string|null;agents:Array<{identity:string;numericId:number;status:string}>;tools:Tool[];plans:Plan[];missions:Array<{identity:string;status:string;goal:string}>}
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
  return <section className="h-full overflow-auto bg-[#090f17] text-slate-200 p-4 space-y-4" aria-label="Shared gameboard">
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div><div className="flex items-center gap-2 text-sm font-semibold"><Network size={17} className="text-cyan-400"/>Gameboard</div>
        <p className="mt-1 text-xs text-slate-400">Shared observed agent and tool state · numeric identities · simulated moves</p></div>
      <button type="button" onClick={()=>void refresh()} className="flex items-center gap-2 text-xs border border-slate-700 px-3 py-2 rounded hover:border-cyan-700"><RefreshCw size={13}/>Refresh</button>
    </div>
    {error&&<p className="border border-amber-800 rounded p-2 text-amber-300 text-xs" role="alert">Could not read a new position: {error}. The last observed data is shown, if any.</p>}
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
      <span><Activity size={13} className="inline mr-1"/>Aura planning: {position?.graphSource||'Not observed'}</span>
      <span><Wrench size={13} className="inline mr-1"/>{position?.tools.length??'–'} registered tools</span>
      <span>{position?.agents.length??'–'} workers</span>
      <span>{position?.observedAt?new Date(position.observedAt).toLocaleTimeString('en-US'):'No observation'}</span>
    </div>
    {position?.graphError&&<p className="text-xs text-amber-300">Strategic graph unavailable: {position.graphError}. Tools and scenario calculation can still be used.</p>}
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-2">
        <h3 className="text-xs font-semibold flex gap-2 items-center"><GitBranch size={15}/>Missions and forecasts</h3>
        {position?.plans.length?position.plans.slice(0,6).map(plan=><div key={plan.identity} className="border-t border-slate-800 pt-2 text-xs space-y-1">
          <div className="font-medium break-words">{plan.objective||plan.identity}</div>
          <div className="text-slate-500">#{intId(plan.numericId)} · {plan.status} · {plan.nodes.length} steps</div>
          {plan.simulation?.status==='SIMULATED'
            ?<div className="text-cyan-300">Simulated terminal probability: {probability(plan.simulation.forecast?.terminalProbability)}</div>
            :<div className="text-slate-500">No verifiable simulation for this plan</div>}
          <div className="text-slate-400">Eligible simulated moves: {plan.moves.filter(m=>m.executable).length}</div>
        </div>):<p className="text-slate-500 text-xs">No planning graph observed for Aura. {position?.missions.length?position.missions.length+' local missions are on the bus.':''}</p>}
      </div>
      <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-2">
        <h3 className="text-xs font-semibold flex gap-2 items-center"><Wrench size={15}/>Tool identities</h3>
        {!position?.tools.length&&<p className="text-xs text-slate-500">No tools advertised. An ID entry does not confirm that a tool works.</p>}
        <div className="max-h-56 overflow-auto space-y-1">
          {position?.tools.slice(0,80).map(tool=><div key={tool.identity} className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-slate-800/60">
            <span className="truncate" title={tool.identity}>{tool.providerId}.{tool.name}</span>
            <span className="text-slate-500 shrink-0" title={tool.identity}>#{intId(tool.numericId)} · {tool.status}</span>
          </div>)}
        </div>
      </div>
    </div>

    <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-2">
      <h3 className="text-xs font-semibold flex gap-2 items-center"><Network size={15}/>Agents' mathematical messages</h3>
      <p className="text-xs text-slate-400">Revision {position?.exchange?.revision??'–'}. Contributions are self-reported until separate evidence is verified. No moves are run from this view.</p>
      {position?.exchange?.entries?.length?position.exchange.entries.slice(-12).reverse().map(entry=><div className="text-xs border-t border-slate-800 pt-2 space-y-0.5" key={entry.revision}>
        <div className="text-slate-200">{entry.kind} · #{intId(entry.actorNumericId)} · rev {entry.revision}</div>
        <div className="text-slate-400 break-words">{entry.statement}</div>
        {entry.metrics&&<div className="text-cyan-300">Information gain {probability(entry.metrics.informationGain)} · goal impact {probability(entry.metrics.goalImpact)} · confidence {probability(entry.metrics.confidence)}</div>}
        <div className="text-[10px] text-amber-300">{entry.evidenceStatus}</div>
      </div>):<p className="text-xs text-slate-500">No mathematical observations published yet.</p>}
    </div>
    <div className="rounded-lg border border-cyan-900/70 bg-[#0b1b24] p-3 space-y-3">
      <h3 className="text-xs font-semibold flex gap-2 items-center"><ShieldCheck size={15} className="text-cyan-400"/>Simulate tool chain</h3>
      <p className="text-xs text-slate-400">Pure scenario analysis – no agent runs and no files change. All numeric assumptions are hypothetical, not measured tool performance.</p>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-xs space-y-1 block"><span>First move/tool</span><input list="gameboard-tools" value={first} onChange={e=>setFirst(e.target.value)} placeholder="Example: git.git_status" maxLength={180} className="w-full rounded border border-slate-700 bg-[#070f16] p-2"/></label>
        <label className="text-xs space-y-1 block"><span>Next move (optional)</span><input list="gameboard-tools" value={second} onChange={e=>setSecond(e.target.value)} placeholder="Verify result" maxLength={180} className="w-full rounded border border-slate-700 bg-[#070f16] p-2"/></label>
        <datalist id="gameboard-tools">{toolNames.map(name=><option key={name} value={name}/>)}</datalist>
        <label className="text-xs space-y-1 block"><span>Assumed success rate: {probability(confidence)}</span><input aria-label="Assumed success rate" className="w-full" type="range" min="0.05" max="1" step="0.05" value={confidence} onChange={e=>setConfidence(Number(e.target.value))}/></label>
        <label className="text-xs space-y-1 block"><span>Assumed risk: {probability(risk)}</span><input aria-label="Assumed risk" className="w-full" type="range" min="0" max="1" step="0.05" value={risk} onChange={e=>setRisk(Number(e.target.value))}/></label>
      </div>
      <button type="button" disabled={!first.trim()||loading} onClick={()=>void simulate()} className="rounded bg-cyan-800 px-4 py-2 text-xs font-medium disabled:opacity-50">{loading?'Calculating…':'Simulate without execution'}</button>
      {simulationError&&<p role="alert" className="text-xs text-red-300">{simulationError}</p>}
      {simulation&&<div className="border-t border-cyan-950 pt-3 text-xs"><div className="text-cyan-300 font-semibold">Simulated terminal probability: {probability(simulation.result.terminalProbability)}</div><p className="text-slate-400 mt-1">Executed: no · Verified: no · {simulation.result.order.length} planned steps</p></div>}
    </div>
  </section>;
}
