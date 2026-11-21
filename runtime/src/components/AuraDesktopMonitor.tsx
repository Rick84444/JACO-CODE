import React, { useEffect, useRef, useState } from 'react';
import { Camera, Monitor, RefreshCw } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';

// This is an OBSERVATION panel, not a separate remote controller. The images
// come from the canonical Nova mission's existing Laser Vision PNG receipts.
// Chrome Remote Desktop or local Hyper-V VMConnect provide continuous viewing and operator takeover.
export function AuraDesktopMonitor({
  active, missionId, missionStatus,
}: { active: boolean; missionId: string | null; missionStatus: string | null }) {
  const { tr } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<{ src: string; sha256: string; at: string; sessionId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentUrl = useRef<string | null>(null);
  const lastHash = useRef<string | null>(null);
  const [takeover, setTakeover] = useState<'idle'|'pending'|'ready'>('idle');
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [takeoverError, setTakeoverError] = useState<string | null>(null);

  // A takeover belongs to one durable mission only. Never inherit a prior
  // mission's quiescent state when the operator starts a new mission.
  useEffect(() => { setTakeover('idle'); setTakeoverError(null); }, [missionId]);

  useEffect(() => {
    if (takeover === 'idle' || !missionId || missionStatus !== 'ACTIVE' || !active) return;
    let disposed = false;
    let checking = false;
    const inspect = async () => {
      if (disposed || checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const result = await fetch('/api/aura/desktop/takeover/' + encodeURIComponent(missionId) + '/status', {
          credentials:'same-origin', cache:'no-store',
        });
        const state = await result.json();
        if (!result.ok || state.success !== true) throw Error(String(state.error || 'TAKEOVER_STATUS_UNAVAILABLE'));
        if (disposed) return;
        setTakeover(state.ready === true ? 'ready' : 'pending');
        if (state.paused !== true) setTakeoverError('DESKTOP_MISSION_NOT_PAUSED');
        else setTakeoverError(null);
      } catch (error: any) {
        if (!disposed) {
          setTakeover('pending');
          setTakeoverError(String(error?.message || error));
        }
      } finally { checking = false; }
    };
    void inspect();
    const timer = window.setInterval(() => { void inspect(); }, 1200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [active, missionId, missionStatus, takeover]);

  const setOperatorPause = async (pause: boolean) => {
    if (!missionId || takeoverBusy) return;
    setTakeoverBusy(true);setTakeoverError(null);
    try {
      const route = '/api/aura/workbench/missions/' + encodeURIComponent(missionId) + (pause ? '/pause' : '/resume');
      const response = await fetch(route, {
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({note:pause ? 'Operator requests manual desktop takeover' : 'Operator returns desktop control to Aura'}),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw Error(String(result.error || 'MISSION_PAUSE_FAILED'));
      setTakeover(pause ? 'pending' : 'idle');
    } catch (error: any) {setTakeoverError(String(error?.message || error));}
    finally {setTakeoverBusy(false);}
  };

  useEffect(() => {
    if (!open || !active || !missionId || missionStatus !== 'ACTIVE') return;
    let disposed = false;
    let inFlight = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch('/api/aura/desktop/live-frame', {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          if (!disposed) {
            setFrame(null);
            lastHash.current = null;
            if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
            currentUrl.current = null;
            setError(String(payload.error || 'DESKTOP_FRAME_UNAVAILABLE'));
          }
          return;
        }
        const sha256 = response.headers.get('X-JACO-Frame-SHA256') || '';
        const receivedMission = response.headers.get('X-JACO-Mission-Id');
        const at = response.headers.get('X-JACO-Frame-Observed-At') || '';
        const sessionId = Number(response.headers.get('X-JACO-Windows-Session-Id'));
        if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw Error('DESKTOP_FRAME_SESSION_UNVERIFIED');
        if (receivedMission !== missionId || !/^[a-f0-9]{64}$/.test(sha256)) {
          throw Error('DESKTOP_FRAME_MISSION_MISMATCH');
        }
        const bytes = await response.blob();
        if (disposed) return;
        setError(null);
        if (lastHash.current !== sha256) {
          const src = URL.createObjectURL(bytes);
          if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
          currentUrl.current = src;
          lastHash.current = sha256;
          setFrame({ src, sha256, at, sessionId });
        }
      } catch (reason: any) {
        if (!disposed && reason?.name !== 'AbortError') {
          setFrame(null);
          lastHash.current = null;
          if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
          currentUrl.current = null;
          setError(String(reason?.message || 'DESKTOP_FRAME_UNAVAILABLE'));
        }
      } finally {
        inFlight = false;
        controller = null;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => { disposed = true; controller?.abort(); window.clearInterval(timer); };
  }, [open, active, missionId, missionStatus]);

  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);
  const toggle = () => {
    setOpen(previous => !previous);
    setError(null);
  };
  const canShow = Boolean(missionId && missionStatus === 'ACTIVE');
  return <section aria-label={tr('Auras Windows-skärm', 'Aura Windows screen')} className="rounded-lg border border-neutral-700 bg-neutral-950 p-2 my-2">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Monitor size={15} aria-hidden="true"/>
      <strong>{tr('Windows Desktop', 'Windows Desktop')}</strong>
      <button type="button" disabled={!canShow} onClick={toggle}
        aria-expanded={open} className="rounded border border-neutral-600 px-2 py-1 disabled:opacity-40">
        <Camera size={13} className="inline mr-1" aria-hidden="true"/>
        {open ? tr('Dölj skärmbild', 'Hide screenshot') : tr('Visa skärmbild', 'View screenshot')}
      </button>
      {open && canShow && <span className="text-neutral-400"><RefreshCw size={12} className="inline" aria-hidden="true"/> {tr('Uppdaterar observerad bild', 'Refreshing observed frame')}</span>}
      {canShow && <button type="button" disabled={takeoverBusy}
        onClick={() => { void setOperatorPause(takeover === 'idle'); }}
        className="rounded border border-neutral-600 px-2 py-1 disabled:opacity-40">
        {takeover === 'idle' ? tr('Ta över', 'Take control') : takeover === 'ready' ? tr('Återuppta Aura', 'Resume Aura') : tr('Väntar på aktivt verktyg', 'Waiting for active tool')}
      </button>}
    </div>
    {takeover !== 'idle' && <div className="mt-2 text-xs" role="status">
      {takeover === 'ready' ? <span>
        {tr('Auras uppdrag är pausat och inga aktiva skrivbordsåtgärder observeras inom JACO. Öppna Chrome Remote Desktop för att ta över.', 'Aura is paused and JACO observes no active desktop actions. Open Chrome Remote Desktop to take control.')}
        {' '}<a href="https://remotedesktop.google.com/access" target="_blank" rel="noopener noreferrer" className="underline">Chrome Remote Desktop</a>
      </span> : tr('Paus begärd. Väntar på att Auras pågående verktygsanrop och skrivbordslås ska avslutas.', 'Pause requested. Waiting for Aura tools and desktop lock to quiesce.')}
    </div>}
    {takeoverError && <p role="alert" className="mt-1 text-xs text-red-400">{takeoverError}</p>}
    {open && <div className="mt-2">
      {frame ? <div>
        <img src={frame.src} alt={tr('Senaste verifierade Windows-skärmbild från Laser Vision', 'Latest verified Windows screenshot from Laser Vision')} className="max-w-full rounded border border-neutral-700"/>
        <small className="text-neutral-400">{tr('Observerad', 'Observed')}: {new Date(frame.at).toLocaleTimeString()} · Windows Session {frame.sessionId} · SHA-256: {frame.sha256.slice(0, 12)}</small>
      </div> : <p role="status" className="text-neutral-400 text-xs">{error || tr('Väntar på en färsk bild från Auras uppdrag.', 'Waiting for a fresh frame from Aura mission.')}</p>}
      <p className="text-neutral-400 text-xs mt-1">
        {tr('Detta är verifierade stillbilder, inte video. Använd Chrome Remote Desktop eller lokal VMConnect för kontinuerlig visning och manuellt övertagande av Auras Windows-session.', 'These are verified snapshots, not video. Use Chrome Remote Desktop or local VMConnect to view and manually take over the Aura Windows session.')}
      </p>
    </div>}
  </section>;
}
