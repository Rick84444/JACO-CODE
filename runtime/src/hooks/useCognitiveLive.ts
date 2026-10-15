import { useEffect, useRef, useState } from 'react';
import { mergeCognitiveEvents } from '../lib/cognitiveEvents.mjs';

export interface CognitiveEvent {
  id:string; at:string; type:string; category:string; title:string; text:string;
  durable:boolean; seq:number|null; missionId:string|null; missionGoal:string|null; actionId:string|null;
  evidence:{outcome:string;path:string|null;url:string|null;commit:string|null;exitCode:number|null;error:string|null};
}

export function useCognitiveLive() {
  const [events,setEvents] = useState<CognitiveEvent[]>([]);
  const [connection,setConnection] = useState<'connecting'|'live'|'reconnecting'|'unavailable'>('connecting');
  const [lastObservedAt,setLastObservedAt] = useState<string|null>(null);
  const [historyTruncated,setHistoryTruncated] = useState(false);
  const observedAt = useRef<string|null>(null);
  useEffect(() => {
    let active = true;
    const source = new EventSource('/api/aura/workbench/live');
    source.onopen = () => { if (active) setConnection('live'); };
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
    source.addEventListener('observation', observation);
    source.addEventListener('source-error', () => { if(active) setConnection('unavailable'); });
    source.onerror = () => { if(active) setConnection('reconnecting'); };
    // An open TCP connection is insufficient evidence of new observations.
    const watchdog=window.setInterval(()=>{
      if(observedAt.current && Date.now()-Date.parse(observedAt.current)>12000) setConnection('reconnecting');
    },4000);
    return () => { active=false; clearInterval(watchdog); source.close(); };
  },[]);
  return {events,connection,lastObservedAt,historyTruncated};
}
