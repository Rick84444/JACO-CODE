import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';

// Use a Claude, ChatGPT or Gemini subscription as the brain. The vendor's own CLI holds the sign-in; JACO only
// asks it whether it is signed in, starts its web sign-in, and shows the result (GET /api/aura/workbench/brains,
// POST /api/aura/workbench/brains/:id/login). JACO never sees or stores the subscription token.
interface Brain {
  id: 'claude' | 'codex' | 'gemini'; providerId: string; label: string; plan: string;
  installed: boolean; loggedIn: boolean; registered: boolean; loginKind: 'browser' | 'terminal'; loginHint: string | null; detail?: string;
}
interface Login { state: 'WAITING' | 'TERMINAL'; url?: string | null; command?: string }

// Simplified marks, flat and quiet; they are not the vendors' official artwork.
const Logo: React.FC<{ id: Brain['id'] }> = ({ id }) => {
  if (id === 'claude') return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" stroke="#d97757" strokeWidth="2.4" strokeLinecap="round">
      {[0, 45, 90, 135].map(a => <line key={a} x1="12" y1="3" x2="12" y2="21" transform={`rotate(${a} 12 12)`} />)}
    </svg>
  );
  if (id === 'gemini') return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="#8ab4f8">
      <path d="M12 2c.6 5.6 4.4 9.4 10 10-5.6.6-9.4 4.4-10 10-.6-5.6-4.4-9.4-10-10 5.6-.6 9.4-4.4 10-10z" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="#d4d4d4" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" /><circle cx="12" cy="12" r="3.2" />
    </svg>
  );
};

const INSTALL: Record<Brain['id'], string> = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  codex: 'npm i -g @openai/codex',
  gemini: 'npm i -g @google/gemini-cli',
};

// The direct ChatGPT path does not use Codex, CLI tokens, or a shared API key.
const ChatGPTPlanPreview: React.FC = () => {
  const { tr } = useOptionalUiLanguage();
  const [status,setStatus] = useState<any>(null);
  const [url,setUrl] = useState('');
  const [model,setModel] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const endpoint='/api/aura/workbench/chatgpt-plan';
  const refresh = useCallback(async () => {
    try {
      const r=await fetch(endpoint,{cache:'no-store'}).then(readAuraResponse);
      setStatus(r);
      if (r.state !== 'waiting') setUrl('');
    } catch {setStatus({success:false,error:'SIWC_STATUS_UNAVAILABLE'});}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(status?.state!=='waiting') return;
    const timer=setInterval(()=>void refresh(),2500);
    return ()=>clearInterval(timer);
  },[status?.state,refresh]);
  const action=async (name:string, body?:object)=>{
    setBusy(true);setError('');
    try {
      const r=await fetch(endpoint+'/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(readAuraResponse);
      if(!r.success)throw new Error(r.error||'SIWC_OPERATION_FAILED');
      if(name==='login'){
        const u=new URL(r.url);
        if(u.origin!=='https://auth.openai.com'||u.pathname!=='/api/accounts/authorize')throw new Error('SIWC_URL_INVALID');
        setUrl(u.href);
      }
      if(name==='models')setModel(r.models?.[0]?.id||'');
      if(name==='disconnect'){setModel('');setUrl('');}
    }catch(e:any){setError(String(e?.message||'SIWC_OPERATION_FAILED'));}
    finally{await refresh();setBusy(false);}
  };
  const btn="rounded bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 px-2.5 py-1 text-[11px]";
  return <section className="rounded border border-[#505153] p-2 space-y-2 text-xs">
    <div className="font-semibold">ChatGPT — {tr('direkt prenumerationsanslutning','direct plan access')}</div>
    {!status ? <div>{tr('Kontrollerar…','Checking…')}</div> : !status.success ?
      <div className="text-neutral-400">{tr('Lokal förhandsversion: aktiveras på egen dator med JACO_LOCAL_SIWC=1.','Local preview: enable on your own computer with JACO_LOCAL_SIWC=1.')}</div> :
      <>
        <div className="text-neutral-400">{tr('Lokal session. Ingen automatisk modellstyrning.','Local session. No automatic model routing.')}</div>
        <div>{status.connected?tr('Behörighet mottagen','Permission granted'):status.state==='waiting'?tr('Väntar på inloggning','Waiting for sign-in'):tr('Inte ansluten','Not connected')}</div>
        {!status.connected && status.state!=='waiting' && <button disabled={busy} className={btn} onClick={()=>void action('login')}>{tr('Fortsätt med ChatGPT','Continue with ChatGPT')}</button>}
        {url && status.state==='waiting' && <a className="block text-[#3794ff]" href={url} target="_blank" rel="noopener noreferrer">{tr('Öppna OpenAI:s inloggning','Open OpenAI sign-in')}</a>}
        {status.connected && <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy} className={btn} onClick={()=>void action('models')}>{tr('Hämta modeller','Discover models')}</button>
          {!!status.models?.length && <><select className="bg-[#202124] p-1 rounded" value={model} onChange={e=>setModel(e.target.value)}><option value="">—</option>{status.models.map((m:any)=><option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <button disabled={busy||!model} className={btn} onClick={()=>void action('test',{model})}>{tr('Testa (använder kvot)','Test (uses plan quota)')}</button></>}
        </div>}
        {status.verifiedAt && <div className="text-emerald-300">{tr('Modellsvar verifierat','Model response verified')}: {status.verifiedAt}</div>}
        {(status.state!=='disconnected') && <button disabled={busy} className={btn} onClick={()=>void action('disconnect')}>{tr('Koppla från lokalt','Disconnect locally')}</button>}
      </>}
    {(error||status?.success&&status?.error) && <div className="text-red-300">{error||status.error}</div>}
  </section>;
};

export const BrainLogin: React.FC<{ onChanged?: () => void | Promise<void> }> = ({ onChanged }) => {
  const { tr } = useOptionalUiLanguage();
  const [brains, setBrains] = useState<Brain[] | null>(null);
  const [error, setError] = useState('');
  const [logins, setLogins] = useState<Partial<Record<Brain['id'], Login>>>({});
  const [busy, setBusy] = useState<string>('');
  const known = useRef<Set<string>>(new Set());
  // The parent passes a new function on every render; a ref keeps refresh() stable so polling does not loop.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const refresh = useCallback(async () => {
    try {
      const body = await fetch('/api/aura/workbench/brains').then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'BRAINS_FAILED');
      const list: Brain[] = body.brains;
      setBrains(list); setError('');
      // A sign-in status changed; update the surrounding UI without activating any provider.
      const newly = list.filter(b => b.loggedIn && !known.current.has(b.id));
      list.forEach(b => b.loggedIn ? known.current.add(b.id) : known.current.delete(b.id));
      if (newly.length) {
        setLogins(cur => { const next = { ...cur }; newly.forEach(b => delete next[b.id]); return next; });
        await changed.current?.();
      }
    } catch (e: any) { setError(String(e?.message || e)); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // While a web sign-in is open, look for it to finish every two seconds, for at most three minutes.
  const waiting = Object.keys(logins).length > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), 2000);
    const stop = setTimeout(() => setLogins({}), 180_000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [waiting, refresh]);

  const login = async (b: Brain) => {
    setBusy(b.id); setError('');
    try {
      const body = await fetch(`/api/aura/workbench/brains/${b.id}/login`, { method: 'POST' }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error === 'CLI_NOT_INSTALLED' ? tr('Programmet är inte installerat.', 'The program is not installed.') : (body.error || 'LOGIN_FAILED'));
      setLogins(cur => ({ ...cur, [b.id]: body.login }));
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(''); }
  };

  const row = (b: Brain) => {
    const l = logins[b.id];
    const safeUrl = l?.url && /^https:\/\//.test(l.url) ? l.url : null;
    return (
      <li key={b.id} className="flex items-start gap-2.5 py-2 border-t border-[#3c3d3f] first:border-t-0 first:pt-0 last:pb-0">
        <div className="mt-0.5 shrink-0"><Logo id={b.id} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-100">{b.label}</span>
            <span className="text-[10px] text-neutral-400 truncate">{b.plan}</span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-0.5 break-words">
            {b.id === 'claude'
              ? tr('Använd Claude Code i terminalen. Tredjepartsabonnemang kräver godkänd integration.', 'Use Claude Code in the terminal. Third-party subscription access requires an approved integration.')
              : b.loggedIn
              ? <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="w-3 h-3" />{tr('Inloggning observerad. Modellåtkomst inte verifierad.', 'Sign-in observed. Model access not verified.')}</span>
              : !b.installed
                ? <>{tr('Programmet saknas. Installera: ', 'Program not found. Install: ')}<code className="text-neutral-300">{INSTALL[b.id]}</code></>
                : l?.state === 'WAITING'
                  ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{tr('Väntar på inloggning i webbläsaren…', 'Waiting for sign-in in the browser…')}</span>
                  : l?.state === 'TERMINAL' || b.loginKind === 'terminal'
                    ? <>{tr('Kör ', 'Run ')}<code className="text-neutral-300">{b.loginHint}</code>{tr(' i en terminal och välj inloggning med Google. Välj sedan Kontrollera.', ' in a terminal and choose Google sign-in. Then choose Check.')}</>
                    : tr('Inte inloggad.', 'Not signed in.')}
          </div>
          {safeUrl && !b.loggedIn && (
            <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-[11px] text-[#3794ff] hover:underline">
              {tr('Öppna inloggningssidan', 'Open the sign-in page')}
            </a>
          )}
        </div>
        {b.id !== 'claude' && !b.loggedIn && b.installed && (
          <button type="button" disabled={busy === b.id || l?.state === 'WAITING'}
            onClick={() => void (b.loginKind === 'terminal' ? refresh() : login(b))}
            className="shrink-0 bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-2.5 py-1 text-[11px] font-semibold">
            {busy === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : b.loginKind === 'terminal' ? tr('Kontrollera', 'Check') : tr('Logga in', 'Sign in')}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="border border-[#505153] bg-[#292a2c] rounded p-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">{tr('Leverantörskonton och CLI-status', 'Provider accounts and CLI status')}</div>
        <button type="button" onClick={() => void refresh()} aria-label={tr('Kontrollera igen', 'Check again')} className="text-neutral-300 hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      <ChatGPTPlanPreview />
      {brains ? <ul>{brains.map(row)}</ul> : <div className="text-[11px] text-neutral-400">{tr('Kontrollerar…', 'Checking…')}</div>}
      {error && <div className="text-[11px] text-red-300 break-words">{error}</div>}
      <div className="text-[10px] text-neutral-400">{tr('CLI-inloggning aktiverar inte automatiskt en modell. Gemini för privatkonto använder Antigravity; direkt Gemini API finns via Google AI Studio.', 'CLI sign-in does not automatically activate a model. Individual Gemini accounts use Antigravity; the direct Gemini API is available through Google AI Studio.')}</div>
    </div>
  );
};
