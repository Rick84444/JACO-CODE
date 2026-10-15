import { toCognitiveEvent } from '../../lib/cognitiveEvents.mjs';

const cursorValue = value => /^\d{1,16}$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;

// Replay comes from the existing mission bus. Workstream events are explicitly volatile.
export function readCognitiveFeed({ bus, workstream, after = 0, limit = 300, secrets = [] }) {
  const all = bus.listEvents(limit + 1).slice().sort((a,b) => a.seq - b.seq);
  const rows = all.slice(-limit);
  const cursor = Math.max(after, ...rows.map(row => row.seq), 0);
  const goals = new Map();
  const events = rows.filter(row => row.seq > after).map(row => {
    if (row.missionId && !goals.has(row.missionId)) {
      goals.set(row.missionId, bus.getMission(row.missionId)?.goal || null);
    }
    return toCognitiveEvent(row, {durable:true, missionGoal:goals.get(row.missionId), secrets});
  }).filter(Boolean);
  const live = workstream.snapshot();
  return {
    schema:'jaco.cognitive-live/v1', cursor,
    historyTruncated:all.length > limit && (after === 0 || rows[0].seq > after + 1),
    events:[...events, ...(live.events || []).map(row => toCognitiveEvent(row,{secrets})).filter(Boolean)],
    observedAt:new Date().toISOString(),
  };
}

export function createCognitiveStreamHandler({ bus, workstream, intervalMs = 1500, secrets = [] }) {
  return (req, res) => {
    let after = cursorValue(req.get('last-event-id') || req.query.after);
    let closed = false, timer, heartbeat;
    const seenVolatile = new Set();
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(timer); clearInterval(heartbeat);
      req.off('aborted', close); res.off('close', close);
      res.end();
    };
    res.status(200).set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-transform',
      'X-Accel-Buffering':'no',
    });
    res.flushHeaders();
    const write = data => {
      if (closed) return;
      if (!res.write(data)) close(); // Slow clients replay from their last received cursor.
    };
    const publish = () => {
      if (closed) return;
      try {
        const packet = readCognitiveFeed({bus, workstream, after, secrets});
        packet.events = packet.events.filter(event => {
          if (event.durable) return true;
          if (seenVolatile.has(event.id)) return false;
          seenVolatile.add(event.id); return true;
        });
        if (seenVolatile.size > 400) {
          const recent = [...seenVolatile].slice(-200); seenVolatile.clear();
          for (const id of recent) seenVolatile.add(id);
        }
        write('id: ' + packet.cursor + '\nevent: observation\ndata: ' + JSON.stringify(packet) + '\n\n');
        after = packet.cursor;
      } catch {
        write('event: source-error\ndata: {"error":"COGNITIVE_SOURCE_UNAVAILABLE"}\n\n');
        close();
      }
    };
    req.on('aborted', close); res.on('close', close);
    publish();
    if (!closed) {
      timer = setInterval(publish, Math.max(100, intervalMs));
      heartbeat = setInterval(() => write(': connection-alive\n\n'), 15000);
      timer.unref?.(); heartbeat.unref?.();
    }
  };
}
