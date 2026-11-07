import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, X } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';
import { readAuraResponse } from '../lib/auraApi.mjs';

type MemoryEntry = {
  id:string; title:string; kind:string; status:string; confidence:number|null; updatedAt:string|null;
  decisionSummary:string; evidenceRefs:string[]; dependencies:string[]; failureModes:string[];
  missionIds:string[]; source:string;
};
type Activity = { latestWriteSequence:number; entries:MemoryEntry[]; changes:Array<{id:string;at:string;sequence:number;title:string}>; source:string };

// This is the local persisted Continuum knowledge store, not chat-history text or fabricated thoughts.
// Reads only; updates come from real knowledge.created/updated receipts.
export function LocalMemoryPanel({ compact = false, missionIds = [] }: {compact?:boolean;missionIds?:string[]}) {
  const { tr } = useUiLanguage();
  const [activity, setActivity] = useState<Activity|null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [saving, setSaving] = useState(false);
  const sequence = useRef<number|null>(null);
  useEffect(() => {
    let active = true;
    let clearPulse:ReturnType<typeof setTimeout>|null = null;
    async function poll() {
      try {
        const payload = await fetch('/api/aura/workbench/local-memory', {cache:'no-store'}).then(readAuraResponse);
        if (payload.success === false || payload.schema !== 'jaco.local-memory-activity/v1') throw Error(payload.error || 'MEMORY_SOURCE_INVALID');
        if (!active) return;
        const observed = Number(payload.latestWriteSequence || 0);
        if (sequence.current !== null && observed > sequence.current) {
          setSaving(true);
          if (clearPulse) clearTimeout(clearPulse);
          clearPulse = setTimeout(() => { if(active) setSaving(false); }, 2800);
        }
        sequence.current = Math.max(sequence.current || 0, observed);
        setActivity(payload); setError('');
      } catch (err) {
        if (active) setError(String((err as Error)?.message || err));
      }
    }
    void poll();
    const timer = window.setInterval(() => {void poll();}, 3000);
    return () => {active=false; window.clearInterval(timer); if(clearPulse) clearTimeout(clearPulse);};
  }, []);
  const items = useMemo(() => {
    const all = activity?.entries || [];
    const inPlan = missionIds.length ? all.filter(item => item.missionIds.some(id => missionIds.includes(id))) : [];
    return inPlan.length ? inPlan : all;
  }, [activity, missionIds]);
  const selected = items.find(item => item.id === selectedId) || items[0] || null;
  const title = saving ? tr('Saving to Memory', 'Saving to Memory') : tr('Lokalt minne', 'Local Memory');
  const avatar = <img src="/branding/memory-tree.png" alt="" aria-hidden="true" width={compact?24:40} height={compact?24:40}
    className={saving ? 'rounded-full shadow-[0_0_18px_#16ef85] animate-pulse' : 'rounded-full shadow-[0_0_10px_#16ef8555]'} />;
  return <section data-testid={compact?'memory-chat':'memory-gameboard'} className={compact?'relative':'rounded-lg border border-emerald-900/60 bg-[#07140f] p-3 text-emerald-50'}>
    <button type="button" onClick={() => setOpen(v=>!v)} aria-expanded={open}
      aria-label={tr('Öppna lokala minnet', 'Open local memory')}
      className={'flex items-center gap-2 text-left '+(compact?'rounded-md px-2 py-1 text-xs hover:bg-emerald-950':'w-full')}>
      {avatar}
      <span className={compact?'text-emerald-300':'flex-1'}>
        <strong className={compact?'text-xs':'text-sm'}>{title}</strong>
        {!compact && <span className="block text-xs text-emerald-200/70">
          {activity?.changes[0] ? activity.changes[0].title : tr('Kunskap sparad på din dator', 'Knowledge stored on your computer')}
        </span>}
      </span>
      {!compact && <ChevronDown size={15}/>}
    </button>
    {open && <div role="region" aria-label={tr('Minnets innehåll och beslut', 'Memory content and decisions')}
      className={compact?'absolute right-0 top-full z-50 mt-1 w-[min(86vw,420px)] max-h-[70vh] overflow-auto rounded-lg border border-emerald-800 bg-[#07140f] p-3 text-slate-100 shadow-xl':'mt-3 border-t border-emerald-900 pt-3'}>
      <div className="mb-2 flex justify-between items-center gap-2"><h3 className="text-sm font-semibold text-emerald-200">{tr('Sparad kunskap', 'Saved knowledge')}</h3>
        <button type="button" onClick={()=>setOpen(false)} aria-label={tr('Stäng minnet','Close memory')}><X size={15}/></button></div>
      <p className="mb-2 text-xs text-slate-400">{tr('Visar registrerade beslut, resultat och belägg från det lokala Continuum-minnet – inte modellens dolda tankesteg.', 'Shows recorded decisions, outcomes and evidence from local Continuum memory, not hidden model thoughts.')}</p>
      {error && <p role="alert" className="text-xs text-amber-300">{tr('Minnet kan inte läsas just nu', 'Memory is temporarily unavailable')}: {error.slice(0,180)}</p>}
      {!error && !items.length && <p className="text-xs text-slate-400">{tr('Inga sparade kunskapsposter ännu.', 'No persisted knowledge entries yet.')}</p>}
      {items.length > 0 && <div className="grid gap-2">
        <div className="flex flex-wrap gap-1">{items.slice(0, 12).map(item=><button key={item.id} type="button" onClick={()=>setSelectedId(item.id)}
          className={'rounded border px-2 py-1 text-left text-xs '+(selected?.id===item.id?'border-emerald-400 text-emerald-200':'border-slate-700 text-slate-300')}>{item.title.slice(0,70)||item.kind}</button>)}</div>
        {selected && <article data-testid="memory-detail" className="rounded-md border border-emerald-900 bg-black/35 p-2 text-xs text-slate-200">
          <div className="flex items-center gap-2 text-emerald-300"><BookOpen size={14}/><strong>{selected.title}</strong></div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
            <dt className="text-slate-400">{tr('Status','Status')}</dt><dd>{selected.status}</dd>
            <dt className="text-slate-400">{tr('Sparad','Saved')}</dt><dd>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : tr('Okänd tid','Unknown time')}</dd>
            <dt className="text-slate-400">{tr('Källa','Source')}</dt><dd>{selected.source}</dd>
            <dt className="text-slate-400">{tr('Kunskaps-ID','Knowledge ID')}</dt><dd className="break-all">{selected.id}</dd>
          </dl>
          <h4 className="mt-3 font-semibold text-emerald-200">{tr('Beslutssammanfattning','Decision summary')}</h4>
          <p className="mt-1 whitespace-pre-wrap break-words">{selected.decisionSummary || tr('Ingen beslutsmotivering har sparats.', 'No decision rationale was persisted.')}</p>
          {selected.dependencies.length > 0 && <p className="mt-2"><strong>{tr('Beroenden','Dependencies')}:</strong> {selected.dependencies.join(', ')}</p>}
          {selected.failureModes.length > 0 && <p className="mt-2"><strong>{tr('Begränsningar','Failure modes')}:</strong> {selected.failureModes.join(', ')}</p>}
          {selected.evidenceRefs.length > 0 && <div className="mt-2"><strong>{tr('Belägg','Evidence references')}:</strong>
            <ul className="mt-1 list-inside list-disc break-all">{selected.evidenceRefs.map(ref=><li key={ref}>{ref}</li>)}</ul></div>}
        </article>}
      </div>}
    </div>}
  </section>;
}
