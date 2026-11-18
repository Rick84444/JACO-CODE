import { useEffect, useRef, useState } from 'react';
import { mergeCognitiveEvents } from '../lib/cognitiveEvents.mjs';

export interface CognitiveEvent {
  id:string; at:string; type:string; category:string; title:string; text:string;
  durable:boolean; seq:number|null; missionId:string|null; missionGoal:string|null; actionId:string|null; planId?:string|null;
  toolType?:string|null; nodeKey?:string|null;
  terminal?:{phase:string;command:string;stdout:string;stderr:string;exitCode:number|null;truncated:boolean};
  evidence:{outcome:string;path:string|null;url:string|null;commit:string|null;exitCode:number|null;error:string|null};
}

// The live stream holds one of the browser's six connections to JACO for as long as it is open. With several JACO
// tabs open every connection was taken, and the visible tab showed "Runtime unreachable" and hung (2026-11-07). A tab
// nobody is looking at therefore closes its stream and opens it again when it is shown; the server replays the
// recent events on connect, so nothing is lost.
export function useCognitiveLive() {
  const [events,setEvents] = useState<CognitiveEvent[]>([]);
  const [connection,setConnection] = useState<'connecting'|'live'|'reconnecting'|'unavailable'>('connecting');
  const [lastObservedAt,setLastObservedAt] = useState<string|null>(null);
  const [historyTruncated,setHistoryTruncated] = useState(false);
  const observedAt = useRef<string|null>(null);
  useEffect(() => {
    let active = true;
    let source: EventSource | null = null;
    const observation = (event:MessageEvent) => {
      if (!active || event.currentTarget !== source || document.hidden) return;
      try {
        const packet=JSON.parse(event.data);
        if(packet.schema !== 'jaco.cognitive-live/v1' || !Array.isArray(packet.events) || typeof packet.observedAt !== 'string' || !Number.isFinite(Date.parse(packet.observedAt))) throw Error('INVALID_LIVE_PACKET');
        setEvents(previous=>mergeCognitiveEvents(previous,packet.events));
        setLastObservedAt(packet.observedAt);
        observedAt.current=packet.observedAt;
        if(packet.historyTruncated) setHistoryTruncated(true);
        setConnection('live');
      } catch { setConnection('unavailable'); }
    };
    const open = () => {
      if (source || !active) return;
      setConnection('connecting');
      const next = new EventSource('/api/aura/workbench/live');
      next.onopen = () => { if (active && source === next) setConnection('connecting'); };
      next.addEventListener('observation', observation);
      next.addEventListener('source-error', () => { if(active && source === next) setConnection('unavailable'); });
      next.onerror = () => { if(active && source === next) setConnection('reconnecting'); };
      source = next;
    };
    const close = () => { const previous = source; source = null; previous?.close(); observedAt.current = null; };
    const onVisibility = () => { if (document.hidden) { close(); setConnection('reconnecting'); } else open(); };
    if (!document.hidden) open();
    document.addEventListener('visibilitychange', onVisibility);
    // An open TCP connection is insufficient evidence of new observations.
    const watchdog=window.setInterval(()=>{
      if(source && observedAt.current && Date.now()-Date.parse(observedAt.current)>12000) setConnection('reconnecting');
    },4000);
    return () => { active=false; clearInterval(watchdog); document.removeEventListener('visibilitychange', onVisibility); close(); };
  },[]);
  return {events,connection,lastObservedAt,historyTruncated};
}
