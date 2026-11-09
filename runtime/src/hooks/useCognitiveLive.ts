import { useEffect, useRef, useState } from 'react';
import { mergeCognitiveEvents } from '../lib/cognitiveEvents.mjs';

export interface CognitiveEvent {
  id:string; at:string; type:string; category:string; title:string; text:string;
  durable:boolean; seq:number|null; missionId:string|null; missionGoal:string|null; actionId:string|null; planId?:string|null;
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
      if (!active) return;
      try {
        const packet=JSON.parse(event.data);
        if(packet.schema !== 'jaco.cognitive-live/v1' || !Array.isArray(packet.events)) throw Error('INVALID_LIVE_PACKET');
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
      next.onopen = () => { if (active) setConnection('live'); };
      next.addEventListener('observation', observation);
      next.addEventListener('source-error', () => { if(active) setConnection('unavailable'); });
      next.onerror = () => { if(active) setConnection('reconnecting'); };
      source = next;
    };
    const close = () => { source?.close(); source = null; };
    const onVisibility = () => { if (document.hidden) close(); else open(); };
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
