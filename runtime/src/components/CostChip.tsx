import React, { useCallback, useEffect, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';

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

const usd=(v:number|undefined|null,d=2)=>v==null||!Number.isFinite(v)?'–':`${v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})} USD`;
const runway=(m:number|null)=>m==null?'–':m<90?`${m} min`:`${(m/60).toFixed(1)} h`;

// The spending limit, changed right where the cost is shown: click the dollar sign, raise the day or month limit,
// save. The same operator-only PATCH as the budget panel; only the fields changed here are sent.
function LimitEditor({ live, onSaved }: { live: Live; onSaved: () => void }) {
  const { tr } = useUiLanguage();
  const asText = (n: number | null) => n == null ? '' : String(n);
  const [day, setDay] = useState(asText(live.policy.dailyCloudUsd));
  const [month, setMonth] = useState(asText(live.policy.monthlyCloudUsd));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const spentMonth = live.governor.monthlySpentUsd;
  const spentDay = live.governor.dailySpentUsd;
  const monthFull = live.policy.monthlyCloudUsd != null && spentMonth >= live.policy.monthlyCloudUsd;
  const dayFull = live.policy.dailyCloudUsd != null && spentDay >= live.policy.dailyCloudUsd;
  const parse = (text: string) => text.trim() === '' ? null : Number(text);
  const save = async () => {
    const patch: Record<string, number | null> = {};
    const d = parse(day), m = parse(month);
    if ([d, m].some(n => n != null && (!Number.isFinite(n) || n < 0))) { setError(tr('Skriv ett belopp på noll eller mer, eller lämna tomt för ingen gräns.', 'Enter an amount of zero or more, or leave it empty for no limit.')); return; }
    if (d !== live.policy.dailyCloudUsd) patch.dailyCloudUsd = d;
    if (m !== live.policy.monthlyCloudUsd) patch.monthlyCloudUsd = m;
    if (!Object.keys(patch).length) return;
    setState('saving'); setError(null);
    try {
      const response = await fetch('/api/aura/budget', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (!response.ok || !body.success) throw Error(body.error || 'BUDGET_SAVE_FAILED');
      setState('saved'); onSaved();
    } catch (e) { setState('idle'); setError(e instanceof Error ? e.message : String(e)); }
  };
  const add = (n: number) => { setMonth(String(Math.round(((parse(month) ?? spentMonth) + n) * 100) / 100)); setState('idle'); };
  const field = 'w-24 rounded border border-slate-700 bg-[#081018] px-2 py-1 text-right text-xs';
  return <section className="space-y-2 rounded-md border border-slate-700 p-2" aria-label={tr('Utgiftsgräns', 'Spending limit')}>
    <h3 className="font-semibold text-slate-200">{tr('Utgiftsgräns', 'Spending limit')}</h3>
    {(monthFull || dayFull) && <p role="status" className="text-amber-300">{monthFull
      ? tr('Månadens gräns är nådd, så Aura kan inte använda molnmodeller. Höj gränsen för att fortsätta.', 'This month\'s limit is reached, so Aura cannot use cloud models. Raise the limit to continue.')
      : tr('Dagens gräns är nådd. Höj den för att fortsätta i dag.', 'Today\'s limit is reached. Raise it to continue today.')}</p>}
    <label className="flex items-center justify-between gap-2"><span className="text-slate-400">{tr('Per dag', 'Per day')} <span className="text-slate-500">({tr('använt', 'used')} {usd(spentDay)})</span></span>
      <input type="number" min="0" step="any" value={day} placeholder={tr('Ingen gräns', 'No limit')} onChange={e => { setDay(e.target.value); setState('idle'); }} className={field} aria-label={tr('Gräns per dag i USD', 'Limit per day in USD')} /></label>
    <label className="flex items-center justify-between gap-2"><span className="text-slate-400">{tr('Per månad', 'Per month')} <span className="text-slate-500">({tr('använt', 'used')} {usd(spentMonth)})</span></span>
      <input type="number" min="0" step="any" value={month} placeholder={tr('Ingen gräns', 'No limit')} onChange={e => { setMonth(e.target.value); setState('idle'); }} className={field} aria-label={tr('Gräns per månad i USD', 'Limit per month in USD')} /></label>
    <div className="flex items-center gap-1.5">
      {[5, 10, 20].map(n => <button key={n} type="button" onClick={() => add(n)} className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-cyan-600">+{n} USD</button>)}
      <button type="button" disabled={state === 'saving'} onClick={() => void save()} className="ml-auto rounded bg-[#0e639c] px-3 py-1 font-semibold text-white hover:bg-[#1177bb] disabled:opacity-50">{state === 'saving' ? tr('Sparar…', 'Saving…') : tr('Spara', 'Save')}</button>
    </div>
    {state === 'saved' && <p role="status" className="text-emerald-400">{tr('Sparat. Gränsen gäller direkt.', 'Saved. The limit applies right away.')}</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </section>;
}

// Live cost, polled from runtime: token usage priced by JACO's configured/reference rates (not provider invoice),
// and what is still unconfirmed. The governor's conservative counter is shown last and labelled, never as "spent".
export function CostChip({onOpen}:{onOpen?:()=>void}) {
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const recalibrate=async()=>{
    if(!window.confirm("Adjust the governor's counter to the token-based estimated cost? Unknown or expired reservations may still have been charged by the provider.")) return;
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
  const over=live?((live.policy.dailyCloudUsd!=null&&live.governor.dailySpentUsd>=live.policy.dailyCloudUsd)||(live.policy.monthlyCloudUsd!=null&&live.governor.monthlySpentUsd>=live.policy.monthlyCloudUsd)):false;
  const capText=(n:number|null,digits?:number)=>n==null?'no cap':usd(n,digits);
  const tone=error?'warn':over?'bad':data?.runwayMinutes!=null&&data.runwayMinutes<30?'bad':low?'warn':'ok';
  const color=tone==='bad'?'text-red-300 border-red-900':tone==='warn'?'text-amber-300 border-amber-800':'text-slate-200 border-slate-700';
  const label=error?'Cost: no data':live?`Estimated today ${usd(live.today.usd)}${live.policy.dailyCloudUsd==null?'':` of ${usd(live.policy.dailyCloudUsd,0)}`}${over?' (cap reached)':''} · ${usd(live.lastHourUsd)}/h${balance?.ok?` · balance ${usd(balance.usd)}`:''}`:'Cost…';
  const byProvider:Totals['byProvider']=live?.today.byProvider??{};
  const providers=Object.entries(byProvider).sort((a,b)=>b[1].usd-a[1].usd);

  return <div className="relative">
    <button type="button" onClick={()=>setOpen(o=>!o)} aria-expanded={open} aria-label="Show live cost and spending limit"
      title="Token-based estimated cost – not verified against the provider invoice. Refreshes every 5 seconds" className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${color}`}>
      <CircleDollarSign size={14}/><span className="cognitive-cost-full">{label}</span><span className="cognitive-cost-compact">{error?'Cost ?':live?usd(live.today.usd):'Cost…'}</span>
    </button>
    {open&&<div role="dialog" aria-label="Live cost" className="cognitive-cost-popover absolute right-0 z-50 mt-2 w-[22rem] rounded-lg border border-slate-700 bg-[#0e1720] p-3 text-xs shadow-xl space-y-3">
      {error&&<p role="alert" className="text-amber-300">Could not read cost: {error}</p>}
      {live&&<>
        <React.Fragment key={`${live.policy.dailyCloudUsd}-${live.policy.monthlyCloudUsd}`}><LimitEditor live={live} onSaved={()=>void refresh()}/></React.Fragment>
        <section className="space-y-1">
          <h3 className="font-semibold text-slate-200">Estimated (tokens × JACO price)</h3>
          <p className="text-amber-200">Not invoice-verified. Unknown models may use reference prices that differ from the provider's price.</p>
          <div className="flex justify-between"><span className="text-slate-400">Today</span><span>{usd(live.today.usd)} · {live.today.calls} calls</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Last hour</span><span>{usd(live.lastHourUsd)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">This month</span><span>{usd(live.month.usd)} · {live.month.calls} calls</span></div>
          {providers.length>0&&<div className="pt-1 border-t border-slate-800">
            {providers.map(([name,p])=><div key={name} className="flex justify-between text-slate-400"><span>{name}</span><span>{usd(p.usd)} · {p.calls}</span></div>)}
          </div>}
        </section>
        <section className="space-y-1">
          <h3 className="font-semibold text-slate-200">Prepaid balance (DeepSeek)</h3>
          {balance?.ok
            ?<><div className="flex justify-between"><span className="text-slate-400">Remaining</span><span>{usd(balance.usd)}</span></div>
               <div className="flex justify-between"><span className="text-slate-400">Runway at today's rate</span><span>{runway(data?.runwayMinutes??null)}</span></div></>
            :<p className="text-amber-300">Balance could not be read ({balance?.error||'unknown'}).</p>}
          <p className="text-slate-500">The balance is fetched from the provider when possible; it does not verify JACO's estimated token cost.</p>
        </section>
        <section className="space-y-1">
          <h3 className="font-semibold text-slate-200">Unconfirmed</h3>
          <div className="flex justify-between"><span className="text-slate-400">In progress</span><span>{live.pending.count} calls</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Outcome unknown</span><span>{live.unknown.count} calls (≤ {usd(live.unknown.usd)} estimated)</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Expired this month</span><span>{live.month.expiredCalls} · {usd(live.month.expiredUsd)} estimated</span></div>
          <p className="text-slate-500">Estimates assume the maximum response length and are not money that has been charged.</p>
        </section>
        <section className="space-y-1 border-t border-slate-800 pt-2">
          <h3 className="font-semibold text-slate-200">Governor counter (conservative)</h3>
          <div className="flex justify-between"><span className="text-slate-400">Today / month</span><span>{usd(live.governor.dailySpentUsd)} / {usd(live.governor.monthlySpentUsd)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Spend cap per day / month / task</span><span>{capText(live.policy.dailyCloudUsd,0)} / {capText(live.policy.monthlyCloudUsd,0)} / {capText(live.policy.maxCloudUsdPerTask,2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Autonomous calls / 15 min</span><span>{live.autonomousCloudCallsLast15m ?? '–'} / {live.policy.maxAutonomousCloudCallsPer15m == null ? 'no rate limit' : live.policy.maxAutonomousCloudCallsPer15m}</span></div>
          {Math.abs(live.governor.monthlySpentUsd-live.month.usd)>1&&<button type="button" disabled={busy} onClick={()=>void recalibrate()} className="mt-1 w-full rounded border border-cyan-800 px-2 py-1 text-cyan-300 disabled:opacity-50">{busy?'Adjusting…':'Adjust counter to estimate'}</button>}
        </section>
        <div className="flex justify-between items-center text-[10px] text-slate-500">
          <span>Observed {new Date(live.observedAt).toLocaleTimeString('en-US')}</span>
          {onOpen&&<button type="button" className="underline" onClick={()=>{setOpen(false);onOpen();}}>Open budget</button>}
        </div>
      </>}
    </div>}
  </div>;
}
