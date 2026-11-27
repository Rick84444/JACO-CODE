import React,{useEffect,useRef,useState} from 'react';
import {useOptionalUiLanguage} from '../i18n/UiLanguage';

const base='/api/aura/workbench/mcp/oauth/linear';
interface Status {
  state:string; pending:boolean; error:string|null; existingConfiguration:boolean;
  credentialState:string; configured:boolean; accountVerified:boolean;
  verifiedAt:string|null; toolsDiscovered:number|null; runtimeReady:boolean;
  agentExecutionVerified:boolean;
}
async function request(action='',signal?:AbortSignal){
  const res=await fetch(base+(action?'/'+action:''),{method:action?'POST':'GET',headers:{'Content-Type':'application/json'},cache:'no-store',signal});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.success!==true)throw Error(data.error||'MCP_OAUTH_STATUS_UNAVAILABLE');
  return data;
}
function authorizationUrl(value:unknown){
  try{
    if(typeof value!=='string')return '';
    const u=new URL(value);
    return u.origin==='https://mcp.linear.app'&&u.pathname==='/authorize'&&!u.username&&!u.password&&!u.hash?u.href:'';
  }catch{return '';}
}

export function LinearOAuthPanel({fresh,onChanged}:{fresh:boolean;onChanged:(notice:string)=>void}){
  const {tr}=useOptionalUiLanguage();
  const [status,setStatus]=useState<Status|null>(null);
  const [error,setError]=useState('');
  const [url,setUrl]=useState('');
  const [busy,setBusy]=useState('');
  const mounted=useRef(false);
  const sequence=useRef(0);
  const notice=useRef(onChanged);
  const previousReady=useRef(false);
  notice.current=onChanged;
  useEffect(()=>{
    mounted.current=true;
    const controller=new AbortController();
    let timer:number|undefined;
    async function poll(){
      const revision=sequence.current;
      try{
        const data=await request('',controller.signal);
        if(!mounted.current||revision!==sequence.current)return;
        setStatus(data);setError('');
        if(!data.pending)setUrl('');
        if(data.runtimeReady&&!previousReady.current)notice.current('Linear: account read verified; tools discovered');
        previousReady.current=data.runtimeReady===true;
      }catch(e:any){
        if(!controller.signal.aborted&&revision===sequence.current){setStatus(null);setUrl('');setError(String(e?.message||'MCP_OAUTH_STATUS_UNAVAILABLE'));}
      }finally{if(!controller.signal.aborted)timer=window.setTimeout(poll,2500);}
    }
    void poll();
    return()=>{mounted.current=false;controller.abort();window.clearTimeout(timer);};
  },[]);
  const mutate=async(action:string)=>{
    if(busy||!fresh)return;
    const revision=++sequence.current;
    setBusy(action);setError('');setUrl('');
    try{
      const data=await request(action);
      if(!mounted.current||revision!==sequence.current)return;
      if(action==='start'){
        const safe=authorizationUrl(data.url);
        if(!safe)throw Error('MCP_OAUTH_AUTHORIZATION_URL_INVALID');
        setUrl(safe);
        setStatus(s=>s?{...s,state:'waiting',pending:true,error:null}:null);
      }else{
        setStatus(data);
        if(action==='disconnect'){previousReady.current=false;notice.current('Linear: local OAuth connection removed');}
      }
    }catch(e:any){if(mounted.current&&revision===sequence.current)setError(String(e?.message||'MCP_OAUTH_CONNECTION_FAILED'));}
    finally{if(mounted.current&&revision===sequence.current)setBusy('');}
  };
  if(error==='MCP_OAUTH_PREVIEW_DISABLED'||error==='LOCAL_UI_ONLY')return <p className="text-xs text-neutral-400">{tr('Kontoinloggning är ännu en lokal förhandsfunktion. Manuell API-nyckel finns nedan.','Account sign-in is a local preview. Manual API-key setup remains available below.')}</p>;
  const message=error||status?.error||'';
  const labels:Record<string,string>={
    MCP_OAUTH_EXISTING_CONFIGURATION:tr('En befintlig anslutning skyddas mot överskrivning.','An existing connection is protected from replacement.'),
    MCP_OAUTH_DISCONNECT_FIRST:tr('Ta först bort den sparade OAuth-sessionen.','Remove the saved OAuth session first.'),
    MCP_OAUTH_ACCOUNT_PROBE_UNAVAILABLE:tr('Leverantören erbjuder inte det förväntade läsverktyget.','The expected read tool was not advertised.'),
    MCP_OAUTH_ACCOUNT_PROOF_INVALID:tr('Kontot kunde inte verifieras. Inga nya autentiseringsuppgifter sparades.','Account verification failed. No new credential was saved.'),
    MCP_OAUTH_RESOURCE_MISMATCH:tr('Leverantörens resursidentitet matchar inte den granskade konfigurationen.','Provider resource identity does not match the reviewed configuration.'),
    MCP_OAUTH_CONTRACT_UNSUPPORTED:tr('Leverantörens inloggningskontrakt behöver granskas.','The provider authorization contract needs review.'),
    MCP_OAUTH_CONSENT_DENIED:tr('Inloggningen godkändes inte. Försök igen när du vill.','Authorization was not approved. Retry when ready.')
  };
  const recoverable=status?.credentialState==='REAUTH_REQUIRED'||status?.credentialState==='VAULT_ERROR';
  const hasSaved=!!status&&(status.configured||status.credentialState!=='NOT_CONFIGURED');
  const disabled=!fresh||!!busy||!status;
  return <section aria-label={tr('Kontoinloggning med Linear','Linear account sign-in')} className="rounded-lg border border-sky-900/80 bg-[#182431] p-3 space-y-3 text-xs">
    <header className="space-y-1"><h4 className="font-semibold text-sky-100">{tr('Anslut ditt Linear-konto','Connect your Linear account')}</h4><p className="text-neutral-300">{tr('Logga in hos Linear. JACO begär endast läsbehörighet, verifierar kontot och sparar sessionen krypterat.','Sign in at Linear. JACO requests read-only access, verifies the account and encrypts the session.')}</p></header>
    <div role="status" className="rounded border border-neutral-600 p-2 text-neutral-200">
      {busy==='start'?tr('Förbereder säker inloggning…','Preparing secure sign-in…'):status?.pending?tr('Väntar på inloggning eller kontoverifiering.','Waiting for sign-in or account verification.'):recoverable?tr('Ny inloggning krävs.','Sign in again.'):status?.credentialState==='REFRESHING'||status?.credentialState==='REFRESH_REQUIRED'?tr('Sessionen behöver förnyas vid nästa anrop.','Session renewal is required on the next call.'):status?.runtimeReady?tr('Kontoläsning verifierad · verktyg upptäckta','Account read verified · tools discovered'):status?.accountVerified?tr('Kontoläsning verifierad · runtime behöver återanslutas','Account read verified · runtime reconnect needed'):status?.existingConfiguration?tr('Befintlig anslutning skyddad','Existing connection protected'):status?tr('Inte ansluten','Not connected'):tr('Kontrollerar anslutningsstatus…','Checking connection status…')}
      {status?.accountVerified&&status.verifiedAt&&<p className="mt-1 text-neutral-400">{tr('Senaste kontokontroll','Last account check')}: {new Date(status.verifiedAt).toLocaleString()}</p>}
      {status?.toolsDiscovered!==null&&status?.toolsDiscovered!==undefined&&<p className="text-neutral-400">{status.toolsDiscovered} {tr('upptäckta läsverktyg','discovered read tools')}</p>}
      {status?.accountVerified&&<p className="text-neutral-400">{tr('Auras uppdragskörning behöver verifieras separat.','Aura mission execution requires separate verification.')}</p>}
    </div>
    {message&&<p role="alert" className="text-amber-200">{labels[message]||tr('Anslutningen kunde inte slutföras. Kontrollera status eller försök igen.','The connection could not complete. Check status or retry.')} <span className="break-all text-neutral-400">({message})</span></p>}
    <div className="flex flex-wrap gap-2">
      {status&&!status.existingConfiguration&&!hasSaved&&!status.pending&&!url&&<button type="button" disabled={disabled} onClick={()=>void mutate('start')} className="rounded-md bg-[#314a66] px-3 py-2 font-semibold disabled:opacity-40">{tr('Anslut med Linear','Connect with Linear')}</button>}
      {url&&<a href={url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-[#314a66] px-3 py-2 font-semibold">{tr('Öppna säker inloggning','Open secure sign-in')}</a>}
      {status?.pending&&<button type="button" disabled={disabled} onClick={()=>void mutate('cancel')} className="rounded border border-neutral-600 px-3 py-2 disabled:opacity-40">{tr('Avbryt','Cancel')}</button>}
      {hasSaved&&!status?.existingConfiguration&&!status?.pending&&<button type="button" disabled={disabled} onClick={()=>{if(window.confirm(tr('Ta bort den lokala Linear-anslutningen? Återkalla även behörigheten hos Linear om du vill avsluta åtkomsten där.','Remove the local Linear connection? Revoke access in Linear as well if you want to end provider-side access.')))void mutate('disconnect');}} className="rounded border border-neutral-600 px-3 py-2 disabled:opacity-40">{tr('Koppla från lokalt','Disconnect locally')}</button>}
    </div>
    {hasSaved&&<a href="https://linear.app/settings" target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">{tr('Hantera behörigheter hos Linear','Manage authorization at Linear')}</a>}
  </section>;
}
