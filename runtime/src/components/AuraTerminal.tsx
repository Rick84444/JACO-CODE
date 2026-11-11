import React, { useEffect, useRef, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { projectAuraTerminal } from '../lib/auraTerminal.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

export function AuraTerminal({events,missionId,connection}:{events:CognitiveEvent[];missionId:string|null;connection:string}) {
  const {tr}=useUiLanguage();
  const [open,setOpen]=useState(true),[follow,setFollow]=useState(true);
  const viewport=useRef<HTMLDivElement>(null);
  const entries=projectAuraTerminal(events,missionId);
  const latest=entries.at(-1), signature=latest ? `${latest.id}:${latest.stdout.length}:${latest.stderr.length}:${latest.done}` : '';
  useEffect(()=>{if(follow&&viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;},[signature,follow,open]);
  return <section className="aura-terminal" data-testid="aura-terminal" aria-label={tr('Auras terminal','Aura terminal')}>
    <header>
      <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Terminal size={14}/> Terminal {open?<ChevronDown size={13}/>:<ChevronUp size={13}/>}</button>
      <span>{connection==='live'?tr('Rapporterade kommandon och utdata','Reported commands and output'):tr('Anslutningen är avbruten – visar senaste observation','Connection interrupted – showing last observation')}</span>
      {open&&<button type="button" aria-pressed={follow} onClick={()=>setFollow(v=>!v)}>{tr('Följ senaste','Follow latest')}</button>}
    </header>
    {open&&<div ref={viewport} className="aura-terminal-output" role="log" aria-live="off" onScroll={()=>{
      const e=viewport.current;if(e&&e.scrollHeight-e.scrollTop-e.clientHeight>48)setFollow(false);
    }}>
      {!entries.length&&<p>{tr('Kommandon visas här när Aura kör dem. Utdata fylls på när runtime rapporterar dem.','Commands appear here when Aura runs them. Output appears as the runtime reports it.')}</p>}
      {entries.map(entry=><article key={entry.id} data-outcome={entry.outcome}>
        <pre className="aura-terminal-command">$ {entry.command||tr('Kommandot saknas i den sparade observationen','Command unavailable in the saved observation')}</pre>
        {entry.stdout&&<pre>{entry.stdout}</pre>}{entry.stderr&&<pre className="aura-terminal-stderr">{entry.stderr}</pre>}
        <small>{entry.done?entry.exitCode===null?tr('Steget avslutat; slutkod saknas','Step finished; exit code unavailable'):`${tr('Slutkod','Exit code')} ${entry.exitCode}`:tr('Startat – inväntar rapporterat resultat','Started – awaiting reported result')}{entry.truncated?` · ${tr('Utdata förkortad','Output truncated')}`:''}</small>
      </article>)}
    </div>}
  </section>;
}
