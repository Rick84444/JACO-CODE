// GitHub CLI owns the official OAuth device flow and the OS credential store.
// Browser receives a one-time code and public account name only. No token is
// read, returned, logged, or passed as a command-line argument by JACO.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const runFile = promisify(execFile);
const deviceUrl = 'https://github.com/login/device';
export function githubGuiAuth({env=process.env,spawnImpl=spawn,run=runFile,now=Date.now,timeoutMs=900000}={}) {
  let session=null;
  const childEnv={...env,GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_NO_EXTENSION_UPDATE_NOTIFIER:'1',NO_COLOR:'1',CLICOLOR:'0',GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'};
  // Use the CLI's actual account, not a background service token.
  for(const name of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN','GH_DEBUG','DEBUG','GH_HOST','GH_BROWSER','BROWSER','GH_FORCE_TTY'])delete childEnv[name];
  const exec=(file,args)=>run(file,args,{env:childEnv,timeout:15000,windowsHide:true,maxBuffer:16384,encoding:'utf8'});
  const verify=async()=>{
    try{
      const r=await exec('gh',['api','--hostname','github.com','user','--jq','.login']);
      const login=String(r.stdout||'').trim();
      if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))return {state:'UNVERIFIED'};
      let gitConfigured=false;
      try{const c=await exec('git',['config','--get-urlmatch','credential.helper','https://github.com']);gitConfigured=/\bgh(?:\.exe)?["']?\s+auth\s+git-credential\b/i.test(String(c.stdout||''));}catch{}
      return {state:'AUTHENTICATED',login,gitConfigured};
    }catch(e){return {state:e.code==='ENOENT'?'GH_CLI_MISSING':'SIGN_IN_REQUIRED'};}
  };
  const view=()=>session?{state:session.state,...(session.code?{code:session.code,verificationUrl:deviceUrl}:{}),...(session.result||{})}:null;
  const pending=()=>session&&['STARTING','WAITING_FOR_USER','VERIFYING'].includes(session.state);
  const setup=async()=>{try{
    await exec('gh',['auth','setup-git','--hostname','github.com']);
    const result=await verify();
    return {...result,state:result.state==='AUTHENTICATED'&&result.gitConfigured?'CONNECTED':'GIT_HELPER_UNVERIFIED'};
  }catch{return {state:'GIT_SETUP_FAILED'};}};
  async function status(){
    if(pending()||session?.state==='FAILED'||session?.state==='EXPIRED')return view();
    return verify();
  }
  async function start(){
    if(pending())return view();
    // Set state before any await to prevent parallel OAuth requests.
    const s={state:'STARTING',code:null,child:null,result:null};session=s;
    const existing=await verify();
    if(session!==s||s.state!=='STARTING')return view();
    if(existing.state==='AUTHENTICATED'){
      s.state='VERIFYING';s.result=await setup();s.state=s.result.state;return view();
    }
    if(existing.state==='GH_CLI_MISSING'){s.state='FAILED';s.result={reason:'GH_CLI_MISSING'};return view();}
    let child;
    try {
      child=spawnImpl('gh',['auth','login','--hostname','github.com','--web','--git-protocol','https'],{env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
    }catch{s.state='FAILED';s.result={reason:'GH_AUTH_START_FAILED'};return view();}
    s.child=child;
    let tail='';
    const observe=chunk=>{
      if(session!==s||!pending())return;
      tail=(tail+String(chunk)).slice(-4096);
      const code=tail.match(/(?:one-time code:\s*|one-time code\s*\()([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
      if(code){s.code=code.toUpperCase();s.state='WAITING_FOR_USER';}
    };
    child.stderr?.on('data',observe);child.stdout?.on('data',observe);
    const timer=setTimeout(()=>{if(session===s&&pending()){s.state='EXPIRED';s.code=null;try{child.kill();}catch{}}},timeoutMs);timer.unref?.();
    child.once('error',()=>{clearTimeout(timer);if(session===s&&pending()){s.state='FAILED';s.code=null;s.result={reason:'GH_AUTH_START_FAILED'};}});
    child.once('close',async(code)=>{
      clearTimeout(timer);
      if(session!==s||!pending())return;
      s.code=null;tail='';
      if(code!==0){s.state='FAILED';s.result={reason:'GH_AUTH_FAILED'};return;}
      s.state='VERIFYING';s.result=await setup();s.state=s.result.state;
    });
    return view();
  }
  function cancel(){
    if(session&&pending()&&session.state!=='VERIFYING'){session.state='CANCELLED';session.code=null;try{session.child?.kill();}catch{}}
    return view();
  }
  return {status,start,cancel};
}
