import React,{useEffect,useRef,useState} from 'react';
import {RefreshCw,ExternalLink,Workflow} from 'lucide-react';
import {readAuraResponse} from '../lib/auraApi.mjs';
import {useOptionalUiLanguage} from '../i18n/UiLanguage';

type Run={id:number;workflow:string;title:string;status:string;conclusion:string|null;branch:string;sha:string|null;event:string;updatedAt:string|null;url:string};
type Snapshot={repository:string;observedAt:string;runs:Run[];url:string};

export function GitHubActionsPanel(){
  const {tr,language}=useOptionalUiLanguage();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [error,setError]=useState('');
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function refresh(){
    if(pending.current)return;
    const controller=new AbortController();
    pending.current=controller;setBusy(true);setError('');setSnapshot(null);
    const timer=setTimeout(()=>controller.abort(),30000);
    try{
      const value=await fetch('/api/aura/workbench/git/actions',{cache:'no-store',signal:controller.signal}).then(readAuraResponse);
      if(typeof value.repository!=='string'||!Array.isArray(value.runs))throw Error('GITHUB_ACTIONS_INVALID_RESPONSE');
      setSnapshot(value);
    }catch(e:any){setError(String(e?.message||'GITHUB_ACTIONS_UNAVAILABLE'));}
    finally{clearTimeout(timer);pending.current=null;setBusy(false);}
  }
  const stateLabel=(run:Run)=>run.conclusion==='success'?tr('Godkänd','Passed'):run.conclusion==='failure'?tr('Misslyckad','Failed'):run.status==='in_progress'?tr('Pågår','Running'):run.status==='queued'?tr('Köad','Queued'):run.conclusion||run.status;
  const verifiedLink=(value:string,id?:number)=>{
    if(!snapshot||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(snapshot.repository))return undefined;
    const expected='https://github.com/'+snapshot.repository+'/actions'+(id===undefined?'':'/runs/'+id);
    return value===expected?expected:undefined;
  };
  return <details className="rounded border border-[#505153] bg-[#262729] p-2" open={open} onToggle={e=>{
    const next=e.currentTarget.open;setOpen(next);
    if(next&&!snapshot&&!error)void refresh();
    if(!next){pending.current?.abort();setSnapshot(null);}
  }}>
    <summary className="cursor-pointer text-xs font-semibold"><span className="inline-flex items-center gap-1.5"><Workflow className="w-3.5 h-3.5"/>GitHub Actions</span></summary>
    {open&&<div className="space-y-2 pt-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-neutral-300 break-all">{snapshot?.repository||tr('Projektets origin','Project origin')}</span>
        <button type="button" onClick={()=>void refresh()} disabled={busy} aria-label={tr('Uppdatera Actions','Refresh Actions')} className="p-1 rounded hover:bg-[#45474a] disabled:opacity-50"><RefreshCw className={'w-4 h-4 '+(busy?'animate-spin':'')}/></button>
      </div>
      {busy&&<p role="status" className="text-neutral-400">{tr('Hämtar körningar…','Fetching runs…')}</p>}
      {error&&<p role="alert" className="text-amber-300 break-words">{error==='GITHUB_CLI_NOT_INSTALLED'?tr('Installera GitHub CLI (gh) på JACO-värden.','Install GitHub CLI (gh) on the JACO host.'):error==='GITHUB_ORIGIN_UNAVAILABLE'||error==='GIT_ORIGIN_UNAVAILABLE'?tr('Ingen GitHub-origin kunde läsas från projektet.','No GitHub origin could be read from the project.'):tr('Kunde inte läsa Actions. Kontrollera GitHub-inloggning och behörigheter.','Could not read Actions. Check GitHub sign-in and permissions.')}</p>}
      {snapshot&&<>
        <div className="text-neutral-400">{tr('Kontrollerad','Checked')}: {new Date(snapshot.observedAt).toLocaleString(language==='sv'?'sv-SE':'en-US')}</div>
        {snapshot.runs.length===0&&<p>{tr('Inga körningar hittades.','No runs were observed.')}</p>}
        <ul className="space-y-1.5 max-h-80 overflow-y-auto">
          {snapshot.runs.map(run=><li key={run.id} className="border border-[#45474a] rounded p-2 space-y-1">
            <div className="flex justify-between items-start gap-2">
              <strong className="break-words min-w-0">{run.workflow||run.title}</strong>
              <span className={'shrink-0 '+(run.conclusion==='success'?'text-emerald-300':run.conclusion==='failure'?'text-red-300':'text-neutral-300')}>{stateLabel(run)}</span>
            </div>
            <div className="text-neutral-300 break-words">{run.title}</div>
            <div className="text-neutral-400 break-all">{run.branch}{run.sha?' · '+run.sha.slice(0,7):''}{run.event?' · '+run.event:''}</div>
            {run.updatedAt&&<div className="text-neutral-400">{new Date(run.updatedAt).toLocaleString(language==='sv'?'sv-SE':'en-US')}</div>}
            {verifiedLink(run.url,run.id)&&<a href={verifiedLink(run.url,run.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#66adff]">{tr('Körning och loggar','Run and logs')}<ExternalLink className="w-3 h-3"/></a>}
          </li>)}
        </ul>
        {verifiedLink(snapshot.url)&&<a href={verifiedLink(snapshot.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#66adff]">{tr('Alla Actions på GitHub','All Actions on GitHub')}<ExternalLink className="w-3 h-3"/></a>}
      </>}
      <p className="text-neutral-400">{tr('Status från GitHub. Ingen körning startas här.','Status from GitHub. No workflow is started here.')}</p>
    </div>}
  </details>;
}
