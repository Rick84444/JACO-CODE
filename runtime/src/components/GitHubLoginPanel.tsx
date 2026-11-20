import React,{useEffect,useState} from 'react';
import {useOptionalUiLanguage} from '../i18n/UiLanguage';
import {readAuraResponse} from '../lib/auraApi.mjs';
type State={state:string;login?:string;gitConfigured?:boolean;code?:string;verificationUrl?:string;reason?:string};
const endpoint='/api/aura/workbench/github/auth';
export function GitHubLoginPanel(){
 const {tr}=useOptionalUiLanguage();
 const [key,setKey]=useState(''),[state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [authRequired,setAuthRequired]=useState(true);
 useEffect(()=>{let active=true;fetch('/api/aura/organization',{cache:'no-store'}).then(readAuraResponse).then(r=>{if(active)setAuthRequired(r.mutationAuthRequired!==false);}).catch(()=>{});return()=>{active=false;};},[]);
 async function query(action?:'start'|'cancel'){
   const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(key?{'x-jaco-operator-token':key}:{})},...(action?{method:'POST',body:JSON.stringify({action})}:{})});
   return await readAuraResponse(response) as State;
 }
 const waiting=['STARTING','WAITING_FOR_USER','VERIFYING'].includes(state?.state||'');
 useEffect(()=>{if(authRequired&&!key)return;let active=true;let inFlight=false;
 const refresh=async()=>{if(inFlight)return;inFlight=true;try{const result=await query();if(active){setState(result);setError('');}}catch(e:any){if(active)setError(e.message);}finally{inFlight=false;}};
 void refresh();const timer=setInterval(()=>{if(!document.hidden&&!busy)void refresh();},waiting?2000:30000);
 return()=>{active=false;clearInterval(timer);};
 },[key,authRequired,waiting,busy]);
 async function act(action:'start'|'cancel'){if(busy)return;setBusy(true);setError('');try{setState(await query(action));}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 return <section aria-label="GitHub"><h3>GitHub / Git</h3>
 <p>{tr('Logga in på GitHub i din egen webbläsare. Välj Google på GitHubs inloggningssida om det alternativet erbjuds. Aura får aldrig ditt lösenord eller OAuth-token i chatten.','Sign in to GitHub in your browser. Choose Google on GitHub if offered. Aura never receives your password or OAuth token in chat.')}</p>
 {authRequired&&<label>{tr('Operatörsnyckel (endast sessionen)','Operator credential (session only)')}<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="JACO_ORG_OPERATOR_TOKEN"/></label>}
 {error&&<p role="alert">{error}</p>}
 {state&&<p role="status">{state.state}{state.login?' · '+state.login:''}{state.gitConfigured?' · Git helper configured':''}{state.reason?' · '+state.reason:''}</p>}
 {state?.code&&<div><p>{tr('Engångskod för GitHub','One-time GitHub code')}: <strong>{state.code}</strong></p><button type="button" onClick={()=>void navigator.clipboard?.writeText(state.code||'').catch(()=>{})}>{tr('Kopiera kod','Copy code')}</button><p><a href="https://github.com/login/device" target="_blank" rel="noopener noreferrer">{tr('Öppna GitHubs säkra inloggning','Open GitHub sign-in')}</a></p></div>}
 <button type="button" disabled={busy||waiting||(authRequired&&!key)||state?.state==='GH_CLI_MISSING'} onClick={()=>void act('start')}>{tr('Logga in och anslut Git','Sign in and connect Git')}</button>
 {waiting&&state?.state!=='VERIFYING'&&<button type="button" disabled={busy} onClick={()=>void act('cancel')}>{tr('Avbryt inloggning','Cancel sign-in')}</button>}
 <p>{tr('Anslutningen använder installerade GitHub CLI och dess credential helper för github.com. Om systemets nyckelring saknas kan GitHub CLI lagra autentisering i sin lokala konfigurationsfil.','Uses the installed GitHub CLI and configures its credential helper for github.com. If the OS credential store is unavailable, GitHub CLI may store authentication in its local configuration file.')}</p>
 </section>;
}
