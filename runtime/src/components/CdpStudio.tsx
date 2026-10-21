import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Camera, CircleAlert, Eye, Globe2, Monitor, RefreshCw, ShieldCheck, Terminal, WifiOff } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import './CdpStudio.css';

type Target = { id: string; title: string; url: string; type: string };
type ObservedElement = { selector?: string; text?: string; role?: string; visible?: boolean };
type PageObservation = { url?: string; title?: string; text?: string; at?: string; targets?: ObservedElement[] };
type CallEntry = { id?: string; providerId?: string; toolName?: string; name?: string; at?: string; timestamp?: string; status?: string; isError?: boolean };

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

function asPage(value: unknown): PageObservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.ok === false) throw new Error(String(source.error || 'CDP_OBSERVATION_FAILED'));
  if (typeof source.url !== 'string') throw new Error('CDP_OBSERVATION_SCHEMA_MISSING_URL');
  return {
    url: source.url.slice(0, 1000),
    title: typeof source.title === 'string' ? source.title.slice(0, 300) : '',
    text: typeof source.text === 'string' ? source.text.slice(0, 2400) : '',
    at: typeof source.at === 'string' ? source.at : undefined,
    targets: Array.isArray(source.targets) ? source.targets.slice(0, 40).map((item: ObservedElement) => ({
      selector: String(item?.selector || '').slice(0, 240),
      text: String(item?.text || '').slice(0, 250),
      role: String(item?.role || '').slice(0, 60),
      visible: item?.visible === true,
    })) : [],
  };
}

function parseMcpResult(raw: any): { payload: any; image: string | null } {
  if (!raw || raw.isError) throw new Error('CDP_TOOL_REPORTED_ERROR');
  const parts = Array.isArray(raw.content) ? raw.content : [];
  const image = parts.find((part: any) => part?.type === 'image' && part?.mimeType === 'image/png');
  const text = parts.find((part: any) => part?.type === 'text')?.text;
  let payload: any = null;
  if (typeof text === 'string') {
    try { payload = JSON.parse(text); }
    catch { throw new Error('CDP_RESPONSE_INVALID_JSON'); }
    if (payload?.ok === false) throw new Error(String(payload?.error || 'CDP_TOOL_FAILED'));
  }
  // Only accept a bounded PNG payload. Never allow arbitrary data: URLs or SVG.
  const base64 = typeof image?.data === 'string' ? image.data : '';
  const safeImage = base64.length > 0 && base64.length <= 8_000_000 && /^[A-Za-z0-9+/=]+$/.test(base64)
    ? 'data:image/png;base64,' + base64 : null;
  return { payload, image: safeImage };
}

function when(value: string | undefined) {
  if (!value) return 'Okänd tid';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Okänd tid' : parsed.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function CdpStudio() {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<PageObservation | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [activeView, setActiveView] = useState<'browser' | 'elements' | 'events'>('browser');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastProbe, setLastProbe] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const locked = useRef(false);

  const invoke = useCallback(async (toolName: string) => {
    const response = await fetch('/api/aura/workbench/mcp/call', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'cdp', toolName, arguments: {} }),
      signal: AbortSignal.timeout(20000), cache: 'no-store',
    }).then(readAuraResponse);
    return parseMcpResult(response.result);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (locked.current) return;
    locked.current = true;
    if (!silent) setBusy('refresh');
    setError(null);
    try {
      const [{ payload }, history] = await Promise.all([
        invoke('nova_targets'),
        fetch('/api/aura/workbench/mcp/calls', { cache: 'no-store', signal: AbortSignal.timeout(12000) })
          .then(readAuraResponse).catch(() => null),
      ]);
      const list = Array.isArray(payload?.tabs) ? payload.tabs : [];
      setTargets(list.slice(0, 60).filter((target: any) => typeof target?.id === 'string' && typeof target?.url === 'string')
        .map((target: any) => ({ id: target.id, title: String(target.title || '').slice(0, 300), url: target.url.slice(0, 1000), type: String(target.type || 'page') })));
      setSelectedId(current => list.some((item: any) => item?.id === current) ? current : (list[0]?.id || null));
      if (Array.isArray(history?.calls)) setCalls(history.calls.filter((item: CallEntry) => item?.providerId === 'cdp').slice(-30).reverse());
      setLastProbe(new Date().toISOString());
    } catch (cause) {
      // Old observations are not erased or incorrectly reported as current.
      setError(errorText(cause));
    } finally {
      locked.current = false;
      if (!silent) setBusy(null);
    }
  }, [invoke]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 10000);
    return () => window.clearInterval(timer);
  }, [auto, refresh]);

  const run = async (name: 'nova_observe' | 'nova_screenshot') => {
    if (busy) return;
    setBusy(name); setError(null);
    try {
      const value = await invoke(name);
      if (name === 'nova_observe') {
        const next = asPage(value.payload);
        setPage(next);
        setActiveView('elements');
      } else {
        if (!value.image) throw new Error('CDP_PNG_SCREENSHOT_MISSING_OR_TOO_LARGE');
        setImage(value.image);
        setActiveView('browser');
      }
      setLastProbe(new Date().toISOString());
    } catch (cause) {
      setError(errorText(cause));
    } finally { setBusy(null); }
  };

  const selected = targets?.find(item => item.id === selectedId) || null;
  const observed = page?.url ? (() => { try { return new URL(page.url).host; } catch { return page.url; } })() : null;
  const visibleElements = page?.targets?.filter(item => item.visible).length ?? null;

  return <div className="aura-cdp-studio" data-testid="aura-cdp-studio">
    <div className="aura-cdp-hero">
      <div className="aura-cdp-hero-label"><Globe2 size={15}/><span>BROWSER CONTROL</span><span className="aura-cdp-readonly">OBSERVERA</span></div>
      <div className="aura-cdp-hero-main"><div><h3>CDP Studio</h3><p>Riktiga webbläsarflikar, sidobservationer och skärmbilder. Inga simulerade körningar.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)} title="Läs om CDP-mål och MCP-händelser"><RefreshCw size={16}/><span>Uppdatera</span></button>
      </div>
      <div className="aura-cdp-meta">
        <span className={error ? 'aura-cdp-indicator-error' : targets?.length ? 'aura-cdp-indicator-ready' : ''}><span className="aura-cdp-led"/> {error ? 'Kan inte nås' : targets === null ? 'Ej kontrollerad' : targets.length ? 'CDP svarar' : 'Inga flikar'}</span>
        <span><Monitor size={13}/> {targets?.length ?? '–'} flikar</span>
        <span>Senast: {when(lastProbe || undefined)}</span>
        <label className="aura-cdp-auto"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)}/> Uppdatera var 10:e sek.</label>
      </div>
    </div>

    {error && <div className="aura-cdp-alert" role="alert"><CircleAlert size={16}/> <span>{error}. Kontrollera att Chrome och JACO:s CDP-/Nova-brygga är anslutna. Tidigare data kan vara föråldrade.</span></div>}

    <div className="aura-cdp-toolbar">
      <button type="button" disabled={Boolean(busy)} onClick={() => void run('nova_observe')}><Eye size={15}/> Observera fäst flik</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void run('nova_screenshot')}><Camera size={15}/> Hämta skärmbild</button>
      <span><ShieldCheck size={13}/> Endast läsning</span>
    </div>

    <div className="aura-cdp-layout">
      <aside className="aura-cdp-targets" aria-label="Observerade webbläsarflikar">
        <div className="aura-cdp-heading">ÖPPNA FLIKAR <span>{targets?.length ?? '–'}</span></div>
        {targets === null ? <p>Hämtar tillåtna Chrome-flikar…</p> : targets.length === 0 ? <p>Inga tillåtna flikar hittades. Chrome behöver vara startad med lokal CDP-anslutning och tillåtna mål.</p> : targets.map(item =>
          <button key={item.id} type="button" className={item.id === selectedId ? 'aura-cdp-target selected' : 'aura-cdp-target'} aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}>
            <Globe2 size={15}/><span><strong>{item.title || 'Namnlös flik'}</strong><small>{item.url}</small></span>
          </button>)}
      </aside>

      <section className="aura-cdp-main" aria-label="CDP inspektionsyta">
        <div className="aura-cdp-pagebar">
          <span className="aura-cdp-url">{selected?.url || page?.url || 'Ingen flik vald'}</span>
          {selected?.url && /^https?:\/\//i.test(selected.url) && <a href={selected.url} target="_blank" rel="noreferrer noopener" title="Öppna den valda fliken i webbläsaren"><ArrowUpRight size={14}/></a>}
        </div>
        <div className="aura-cdp-tabs" role="group" aria-label="Inspektionslägen">
          {([['browser','Skärmbild'],['elements','Sidans element'],['events','Körhändelser']] as const).map(([id,label]) =>
            <button key={id} type="button" aria-pressed={activeView === id} onClick={() => setActiveView(id)}>{label}</button>)}
        </div>
        {activeView === 'browser' && <div className="aura-cdp-browser-view">
          {image ? <img src={image} alt="Faktiskt observerad skärmbild från Nova-bryggans fästa Chrome-flik" className="aura-cdp-screenshot"/> :
            <div className="aura-cdp-placeholder"><Camera size={30}/><strong>Ingen skärmbild observerad</strong><span>Tryck på ”Hämta skärmbild” för att läsa Nova-bryggans fästa flik.</span></div>}
          <div className="aura-cdp-caption"><CircleAlert size={13}/> Valet i fliklistan visar målmetadata. Observation och skärmbild gäller bryggans fästa flik, som kan vara en annan flik.</div>
        </div>}
        {activeView === 'elements' && <div className="aura-cdp-elements">
          {page ? <>
            <div className="aura-cdp-observation"><strong>{page.title || observed || 'Observerad sida'}</strong><small>{page.url}</small><span>{page.targets?.length ?? 0} element · {visibleElements ?? 0} synliga · {when(page.at)}</span></div>
            {page.targets?.length ? page.targets.map((item,i)=><div key={i} className="aura-cdp-element"><span>{item.role || 'element'}</span><code>{item.selector || '–'}</code><small>{item.text || 'Ingen text'}</small><em>{item.visible ? 'Synlig' : 'Ej synlig'}</em></div>) : <p>Inga element observerades i sidans svar.</p>}
            {page.text && <details><summary>Sidans observerade text</summary><pre>{page.text}</pre></details>}
          </> : <div className="aura-cdp-placeholder"><Eye size={28}/><strong>Ingen sidobservation</strong><span>Observera fäst flik för att visa faktisk DOM-relaterad information.</span></div>}
        </div>}
        {activeView === 'events' && <div className="aura-cdp-events">
          {calls.length ? calls.map((entry,i)=><div key={String(entry.id || i)} className="aura-cdp-event"><Activity size={14}/><span><strong>{entry.toolName || entry.name || 'CDP-verktyg'}</strong><small>{entry.isError ? 'Fel rapporterat' : entry.status || 'MCP-anrop registrerat'}</small></span><time>{when(entry.at || entry.timestamp)}</time></div>) :
            <div className="aura-cdp-placeholder"><Terminal size={28}/><strong>Inga CDP-händelser registrerade</strong><span>Här visas bara händelser som finns i MCP-loggen, inte en påhittad körhistorik.</span></div>}
        </div>}
      </section>
    </div>

    <div className="aura-cdp-footer"><WifiOff size={13}/><span>Webbkonsol, nätverksanalys och livevideo kräver nya verifierade läsströmmar från bryggan. De visas inte som fungerande funktioner ännu.</span></div>
  </div>;
}
