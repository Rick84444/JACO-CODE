import { readAuraResponse } from '../lib/auraApi.mjs';
import React, { useEffect, useState } from 'react';
import { Loader2, Check, KeyRound, X, RefreshCw } from 'lucide-react';

// Connect a model provider from a URL alone (POST /api/aura/workbench/providers/connect): JACO
// recognises or probes the service, lists its models, picks a default and registers it.
interface Evidence { url: string; status: number | null; ms: number; error?: string }
interface Discovery { id: string; state: 'READY' | 'NEEDS_KEY' | 'KEY_REJECTED' | 'UNREACHABLE'; baseUrl: string; apiKeyEnv: string; models: string[]; defaultModel: string; evidence: Evidence[] }


interface Scanned { id: string; active: boolean; state: 'ACTIVE' | 'NO_KEY' | 'KEY_REJECTED' | 'UNREACHABLE'; defaultModel: string; models: number; ms?: number }
interface KeyResult { state: 'READY' | 'KEY_REJECTED' | 'UNREACHABLE' | 'AMBIGUOUS' | 'UNKNOWN_KEY'; id?: string; models?: string[]; defaultModel?: string; candidates?: string[] }
const STATE_TEXT: Record<Scanned['state'], string> = { ACTIVE: 'active', NO_KEY: 'no key', KEY_REJECTED: 'key rejected', UNREACHABLE: 'not responding' };

// Paste an API key: JACO senses the service from the key, checks it, stores and registers it, then lists
// which providers are active right now (POST /providers/key, GET /providers/scan).
const KeyAndActive: React.FC<{ onChanged: () => void | Promise<void> }> = ({ onChanged }) => {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KeyResult | null>(null);
  const [error, setError] = useState('');
  const [scan, setScan] = useState<Scanned[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [providerChoice, setProviderChoice] = useState('');
  const [catalog, setCatalog] = useState<Array<{ id: string; baseUrl: string }>>([]);

  const refresh = async () => {
    setScanning(true);
    try {
      const body = await fetch('/api/aura/workbench/providers/scan').then(readAuraResponse);
      if (body.success) setScan(body.providers);
    } catch { /* the list just stays as it was */ }
    finally { setScanning(false); }
  };
  useEffect(() => {
    void refresh();
    void fetch('/api/aura/workbench/providers/catalog').then(readAuraResponse)
      .then(data => setCatalog(data.providers || []))
      .catch(() => setError('Could not read the provider list. Try the API address below.'));
  }, []);

  const submit = async (provider = providerChoice) => {
    if (!key.trim() || busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const body = await fetch('/api/aura/workbench/providers/key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key.trim(), ...(provider ? { provider } : {}) }),
      }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'KEY_FAILED');
      setResult(body.result);
      if (body.result.state === 'READY') { setKey(''); await onChanged(); await refresh(); }
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="border border-[#333] bg-[#181818] rounded p-2 space-y-2">
      <div className="text-xs font-semibold">Add API key</div>
      <select value={providerChoice} onChange={e => setProviderChoice(e.target.value)} aria-label="Choose API provider"
        className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs">
        <option value="">Detect automatically</option>
        {catalog.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
      </select>
      <form onSubmit={e => { e.preventDefault(); void submit(); }} className="flex gap-1.5">
        <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} aria-label="API key for the model provider" placeholder="Paste an API key"
          className="flex-1 min-w-0 bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none focus:border-cyan-700" />
        <button type="submit" disabled={busy || !key.trim()} className="bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-3 text-xs font-semibold">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
        </button>
      </form>
      {error && <div className="text-[11px] text-red-300 break-words">{error}</div>}
      {result?.state === 'READY' && <div className="flex items-center gap-1.5 text-[11px] text-emerald-300"><Check className="w-3.5 h-3.5" />{result.id} connected: {result.models?.length ?? 0} models, default {result.defaultModel || '(none)'}</div>}
      {result?.state === 'KEY_REJECTED' && <div className="text-[11px] text-red-300">{result.id} rejected the key. Nothing was saved.</div>}
      {result?.state === 'UNREACHABLE' && <div className="text-[11px] text-amber-300">{result.id} did not respond just now. Nothing was saved; try again.</div>}
      {result?.state === 'UNKNOWN_KEY' && <div className="text-[11px] text-amber-300">The key format is not recognised. Choose a provider above or use a custom API address below.</div>}
      {result?.state === 'AMBIGUOUS' && (
        <div className="space-y-1">
          <div className="text-[11px] text-amber-300">The key matches several providers. Which one is it for? It is sent only to the one you choose.</div>
          <div className="flex flex-wrap gap-1">{result.candidates?.map(c => <button key={c} type="button" onClick={() => void submit(c)} className="text-[11px] rounded-full border border-[#555] px-2.5 py-0.5 hover:text-white">{c}</button>)}</div>
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <div className="text-[11px] text-slate-400">Which are active</div>
        <button type="button" onClick={() => void refresh()} disabled={scanning} aria-label="Rescan" className="text-slate-400 hover:text-white disabled:opacity-40"><RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} /></button>
      </div>
      {scan && (
        <div className="space-y-0.5">
          {scan.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-[11px]">
              <span className={`h-2 w-2 rounded-full shrink-0 ${p.active ? 'bg-emerald-400' : p.state === 'NO_KEY' ? 'bg-slate-600' : 'bg-red-400'}`} />
              <span className="text-slate-200">{p.id}</span>
              <span className="text-slate-500 truncate">{p.active ? `${p.models} models${p.ms != null ? ` · ${p.ms} ms` : ''}` : STATE_TEXT[p.state]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const EXAMPLES = ['deepseek.com', 'groq.com', 'openrouter.ai', 'http://127.0.0.1:11434'];

export const ProviderConnect: React.FC<{ onConnected: () => void | Promise<void> }> = ({ onConnected }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Discovery | null>(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');

  // A supplied custom key is tested against the selected endpoint before storage.
  const connect = async (target = url) => {
    if (!target.trim() || busy) return;
    setBusy(true); setError(''); setFound(null);
    try {
      const body = await fetch('/api/aura/workbench/providers/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target.trim(), ...(key.trim() ? { key: key.trim() } : {}) }),
      }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'CONNECT_FAILED');
      setFound(body.discovery);
      if (body.discovery?.state === 'READY') setKey('');
      if (body.provider) await onConnected();
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
    <KeyAndActive onChanged={onConnected} />
    <div className="border border-[#333] bg-[#181818] rounded p-2 space-y-2">
      <div className="text-xs font-semibold">Connect model</div>
      <form onSubmit={e => { e.preventDefault(); void connect(); }} className="space-y-1.5">
        <div className="flex gap-1.5">
        <input value={url} onChange={e => setUrl(e.target.value)} aria-label="Model provider address" placeholder="Address, e.g. deepseek.com"
          className="flex-1 min-w-0 bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none focus:border-cyan-700" />
        <button type="submit" disabled={busy || !url.trim()} className="bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-3 text-xs font-semibold">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect'}
        </button>
        </div>
        <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}
          aria-label="API key for a custom model provider" placeholder="API key (optional for a local model)"
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs outline-none focus:border-cyan-700" />
        <div className="text-[10px] text-slate-500">The key is sent only to the selected API address and is stored only after a successful model check.</div>
      </form>
      {!found && !busy && (
        <div className="flex flex-wrap gap-1">
          {EXAMPLES.map(x => <button key={x} type="button" onClick={() => { setUrl(x); void connect(x); }} className="text-[10px] rounded-full border border-[#333] px-2 py-0.5 text-slate-400 hover:text-white">{x}</button>)}
        </div>
      )}
      {busy && <div className="text-[11px] text-cyan-300">JACO is probing the address…</div>}
      {error && <div className="text-[11px] text-red-300 break-words">{error}</div>}
      {found && (
        <div className="space-y-1.5 text-[11px]">
          {found.state === 'READY' && <div className="flex items-center gap-1.5 text-emerald-300"><Check className="w-3.5 h-3.5" />{found.id} connected: {found.models.length} models, default {found.defaultModel || '(none)'}</div>}
          {found.state === 'NEEDS_KEY' && <div className="flex items-start gap-1.5 text-amber-300"><KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{found.id} responds but requires an API key.</span></div>}
          {found.state === 'KEY_REJECTED' && <div className="flex items-start gap-1.5 text-red-300"><KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{found.id} rejected the key. Paste a valid one.</span></div>}
          {(found.state === 'NEEDS_KEY' || found.state === 'KEY_REJECTED') && (
            <div className="text-[11px] text-slate-400">Enter the key in the field above and choose Connect. No key is stored before the provider is verified.</div>
          )}
          {found.state === 'UNREACHABLE' && <div className="flex items-start gap-1.5 text-red-300"><X className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>No model API responded at that address. Nothing was registered.</span></div>}
          <details className="text-slate-500">
            <summary className="cursor-pointer">What JACO tried ({found.evidence.length})</summary>
            {found.evidence.map((e, i) => <div key={i} className="font-mono break-all">{e.status ?? e.error ?? '—'} · {e.ms} ms · {e.url}</div>)}
          </details>
        </div>
      )}
    </div>
    </div>
  );
};
