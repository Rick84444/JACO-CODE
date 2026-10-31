import React, { useCallback, useEffect, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';

interface Totals { usd:number;calls:number;estimatedUsd:number;expiredUsd:number;expiredCalls:number;byProvider:Record<string,{usd:number;calls:number}> }
interface Live {
  observedAt:string;seededAt:string|null;today:Totals;month:Totals;lastHourUsd:number;
  pending:{count:number;usd:number};unknown:{count:number;usd:number};
  governor:{dailySpentUsd:number;monthlySpentUsd:number;reservedUsd:number};
  policy:{dailyCloudUsd:number|null;monthlyCloudUsd:number|null;maxCloudUsdPerTask:number|null;maxAutonomousCloudCallsPer15m:number|null;cloudEnabled:boolean};
  autonomousCloudCallsLast15m?:number;billingVerification?:string;
}
interface Balance { ok:boolean;usd?:number;error?:string;checkedAt?:string }
interface Payload { live:Live;balances:{deepseek?:Balance};runwayMinutes:number|null }

const usd=(v:number|undefined|null,d=2)=>v==null||!Number.isFinite(v)?'–':`${v.toLocaleString('sv-SE',{minimumFractionDigits:d,maximumFractionDigits:d})} USD`;
const runway=(m:number|null)=>m==null?'–':m<90?`${m} min`:`${(m/60).toFixed(1).replace('.',',')} h`;

// Live cost, polled from runtime: token usage priced by JACO's configured/reference rates (not provider invoice),
// and what is still unconfirmed. The governor's conservative counter is shown last and labelled, never as "spent".
export function CostChip({onOpen}:{onOpen?:()=>void}) {
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const recalibrate=async()=>{
    if(!window.confirm('Justera styrsystemets räknare till tokenbaserat beräknad kostnad? Okända eller utgångna reservationer kanske ändå har debiterats av leverantören.')) return;
    setBusy(true);
    try {
      const response=await fetch('/api/aura/budget/recalibrate',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      const body=await response.json();
      if(!response.ok||!body.success) throw Error(body.error||'RECALIBRATE_FAILED');
      await refresh();
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const refresh=useCallback(async()=>{
    try {
      const response=await fetch('/api/aura/budget/live',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      const body=await response.json();
      if(!response.ok||!body.success) throw Error(body.error||'COST_UNAVAILABLE');
      setData(body);setError(null);
    } catch(e){setError(e instanceof Error?e.message:String(e));}
  },[]);
  useEffect(()=>{
    void refresh();
    const timer=setInterval(()=>{if(!document.hidden)void refresh();},5000);
    return ()=>clearInterval(timer);
  },[refresh]);

  const live=data?.live;
  const balance=data?.balances.deepseek;
  const low=balance?.ok&&(balance.usd??0)<1;
  const over=live&&live.policy.dailyCloudUsd!=null?live.today.usd>=live.policy.dailyCloudUsd:false;
  const capText=(n:number|null,digits?:number)=>n==null?'inget tak':usd(n,digits);
  const tone=error?'warn':over?'bad':data?.runwayMinutes!=null&&data.runwayMinutes<30?'bad':low?'warn':'ok';
  const color=tone==='bad'?'text-red-300 border-red-900':tone==='warn'?'text-amber-300 border-amber-800':'text-slate-200 border-slate-700';
  const label=error?'Kostnad: ingen data':live?`Beräknat idag ${usd(live.today.usd)}${live.policy.dailyCloudUsd==null?'':` av ${usd(live.policy.dailyCloudUsd,0)}`}${over?' (taket nått)':''} · ${usd(live.lastHourUsd)}/h${balance?.ok?` · saldo ${usd(balance.usd)}`:''}`:'Kostnad…';
  const byProvider:Totals['byProvider']=live?.today.byProvider??{};
  const providers=Object.entries(byProvider).sort((a,b)=>b[1].usd-a[1].usd);

  return <div className="relative">
    <button type="button" onClick={()=>setOpen(o=>!o)} aria-expanded={open} aria-label="Visa kostnad live"
      title="Tokenbaserat beräknad kostnad – inte verifierad mot leverantörsfaktura. Uppdateras var 5:e sekund" className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${color}`}>
      <CircleDollarSign size={14}/><span className="cognitive-cost-full">{label}</span><span className="cognitive-cost-compact">{error?'Kostnad ?':live?usd(live.today.usd):'Kostnad…'}</span>
    </button>
    {open&&<div role="dialog" aria-label="Kostnad live" className="cognitive-cost-popover absolute right-0 z-50 mt-2 w-[22rem] rounded-lg border border-slate-700 bg-[#0e1720] p-3 text-xs shadow-xl space-y-3">
      {error&&<p role="alert" className="text-amber-300">Kunde inte läsa kostnad: {error}</p>}
      {live&&<>
        <section className="space-y-1">
          <h3 className="font-semibold text-slate-200">Beräknat (tokens × JACO-pris)</h3>
          <p className="text-amber-200">Inte fakturaverifierat. Okända modeller kan använda referenspriser som skiljer sig från leverantörens pris.</p>
          <div className="flex justify-between"><span className="text-slate-400">Idag</span><span>{usd(live.today.usd)} · {live.today.calls} anrop</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Senaste timmen</span><span>{usd(live.lastHourUsd)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Denna månad</span><span>{usd(live.month.usd)} · {live.month.calls} anrop</span></div>
          {providers.length>0&&<div className="pt-1 border-t border-slate-800">
            {providers.map(([name,p])=><div key={name} className="flex justify-between text-slate-400"><span>{name}</span><span>{usd(p.usd)} · {p.calls}</span></div>)}
          </div>}
        </section>
        <section className="space-y-1">
          <h3 className="font-semibold text-slate-200">Förbetalt saldo (DeepSeek)</h3>
          {balance?.ok
            ?<><div className="flex justify-between"><span className="text-slate-400">Kvar</span><span>{usd(balance.usd)}</span></div>
               <div className="flex justify-between"><span className="text-slate-400">Räcker i dagens takt</span><span>{runway(data?.runwayMinutes??null)}</span></div></>
            :<p className="text-amber-300">Saldo kunde inte läsas ({balance?.error||'okänt'}).</p>}
          <p className="text-slate-500">Saldo hämtas från leverantören när möjligt; det verifierar inte JACO:s beräknade tokenkostnad.</p>
        </section>
        <section className="space-y-1">
          <h3 className="font-semibold text-slate-200">Obekräftat</h3>
          <div className="flex justify-between"><span className="text-slate-400">Pågår nu</span><span>{live.pending.count} anrop</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Utfall okänt</span><span>{live.unknown.count} anrop (≤ {usd(live.unknown.usd)} uppskattat)</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Utgångna denna månad</span><span>{live.month.expiredCalls} st · {usd(live.month.expiredUsd)} uppskattat</span></div>
          <p className="text-slate-500">Uppskattningar antar maximal längd på svaret och är inte pengar som dragits.</p>
        </section>
        <section className="space-y-1 border-t border-slate-800 pt-2">
          <h3 className="font-semibold text-slate-200">Styrsystemets räknare (försiktig)</h3>
          <div className="flex justify-between"><span className="text-slate-400">Idag / månad</span><span>{usd(live.governor.dailySpentUsd)} / {usd(live.governor.monthlySpentUsd)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Tak per dag / månad / uppgift</span><span>{capText(live.policy.dailyCloudUsd,0)} / {capText(live.policy.monthlyCloudUsd,0)} / {capText(live.policy.maxCloudUsdPerTask,2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Autonoma anrop / 15 min</span><span>{live.autonomousCloudCallsLast15m ?? '–'} / {live.policy.maxAutonomousCloudCallsPer15m == null ? 'ingen spärr' : live.policy.maxAutonomousCloudCallsPer15m}</span></div>
          {Math.abs(live.governor.monthlySpentUsd-live.month.usd)>1&&<button type="button" disabled={busy} onClick={()=>void recalibrate()} className="mt-1 w-full rounded border border-cyan-800 px-2 py-1 text-cyan-300 disabled:opacity-50">{busy?'Justerar…':'Justera räknaren till beräknat'}</button>}
        </section>
        <div className="flex justify-between items-center text-[10px] text-slate-500">
          <span>Observerat {new Date(live.observedAt).toLocaleTimeString('sv-SE')}</span>
          {onOpen&&<button type="button" className="underline" onClick={()=>{setOpen(false);onOpen();}}>Öppna budget</button>}
        </div>
      </>}
    </div>}
  </div>;
}
