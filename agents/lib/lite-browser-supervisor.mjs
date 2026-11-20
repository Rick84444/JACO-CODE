// Same browser binaries, bridges and authority rules as full JACO. Lite owns
// only the three processes it starts, never attaches to an unrelated listener.
// Optional browser readiness must not keep a model-independent Core from starting.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromeExecutable, chromeLaunchArgs } from './chrome-bootstrap.mjs';

export async function prepareLiteBrowser({env,installDir,project,corePort,workplacePort,workplaceReady,findPort,portFree,platform=process.platform,fsImpl=fs}) {
  const unavailable=reason=>({env:{...env,JACO_LITE_BROWSER_AVAILABLE:'0',JACO_LITE_BROWSER_REASON:reason},reason,start:async()=>{},stop:()=>{}});
  if(env.JACO_ENABLE_CDP==='0')return unavailable('CDP_POLICY');
  if(env.JACO_AURA_LEAN==='1'&&env.JACO_ENABLE_CDP!=='1')return unavailable('AURA_LEAN');
  if(!workplaceReady)return unavailable('WORKPLACE_NOT_READY');
  const novaFile=path.join(installDir,'dist','nova-bridge.mjs'),cdpFile=path.join(installDir,'dist','cdp-bridge.mjs');
  if(!fsImpl.existsSync(novaFile)||!fsImpl.existsSync(cdpFile))return unavailable('BROWSER_BUNDLE_MISSING');
  const chrome=chromeExecutable(env,platform);
  if(!chrome)return unavailable('CHROME_NOT_INSTALLED');
  const reserved=new Set([corePort,workplacePort]);
  const allocate=async(raw,fallback)=>{
    const n=Number(raw||fallback);
    if(!Number.isSafeInteger(n)||n<1||n>65535)throw Error('BROWSER_PORT_INVALID');
    const port=await findPort(n,{check:p=>!reserved.has(p)&&portFree(p)});
    if(reserved.has(port))throw Error('BROWSER_PORT_COLLISION');
    reserved.add(port);return port;
  };
  let ports;
  try{ports={chrome:await allocate(env.CDP_PORT,9222),nova:await allocate(env.NOVA_BRIDGE_PORT,4243),cdp:await allocate(env.JACO_CDP_BRIDGE_PORT,2996)};}catch{return unavailable('BROWSER_PORT_UNAVAILABLE');}
  const next={...env,JACO_LITE_BROWSER_AVAILABLE:'1',JACO_ENABLE_CDP:'1',CDP_PORT:String(ports.chrome),NOVA_BRIDGE_PORT:String(ports.nova),JACO_CDP_BRIDGE_PORT:String(ports.cdp),
    JACO_NOVA_URL:'http://127.0.0.1:'+ports.nova,NOVA_BRIDGE_URL:'http://127.0.0.1:'+ports.nova,
    JACO_CDP_ACTION_DIR:path.join(project,'.jaco','cdp-actions'),
    JACO_CHROME_PROFILE_DIR:env.JACO_CHROME_PROFILE_DIR||path.join(project,'.jaco','Chrome-CDP')};
  let stopping=false,started=false,children=[];
  const stop=()=>{stopping=true;for(const c of [...children].reverse())try{if(!c.closed)c.proc.kill();}catch{}};
  async function start({token,execPath=process.execPath,spawnImpl=spawn,fetchImpl=fetch,report=()=>{}}){
    if(started||stopping)return;
    started=true;
    const browserEnv={...next,PORT:String(corePort),JACO_RUNTIME_URL:'http://127.0.0.1:'+corePort,JACO_GATEWAY_TOKEN:token,GATEWAY_TOKEN:token,JACO_WORKPLACE_REQUIRED:'1',JACO_WORKSPACE_ROOT:project};
    const launch=(id,cmd,args)=>{
      const chromeEnv=Object.fromEntries(Object.entries(browserEnv).filter(([name])=>/^(PATH|HOME|USER|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_.*|DISPLAY|WAYLAND_DISPLAY|XDG_[A-Z_]+|DBUS_SESSION_BUS_ADDRESS|LD_LIBRARY_PATH)$/i.test(name)));
      const proc=spawnImpl(cmd,args,{cwd:project,env:id==='chrome'?chromeEnv:browserEnv,stdio:'ignore',windowsHide:true,shell:false});
      const c={proc,closed:false,id,promise:null};children.push(c);
      c.promise=new Promise(resolve=>{
        proc.once('error',()=>{c.closed=true;resolve();report({component:id,event:'SPAWN_ERROR'});});
        proc.once('close',(code,signal)=>{c.closed=true;resolve();report({component:id,event:'EXIT',code,signal,expected:stopping});});
      });
      return c;
    };
    const wait=async(c,url,accept)=>{
      const deadline=Date.now()+30000;
      while(!stopping&&!c.closed&&Date.now()<deadline){
        try{
          const r=await fetchImpl(url,{...(c.id==='novaBridge'?{headers:{Authorization:'Bearer '+token}}:{}),signal:AbortSignal.timeout(1500),redirect:'error'});
          if(r.ok&&accept(await r.json())&&!c.closed&&!stopping)return true;
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      return false;
    };
    const cleanup=async()=>{
      const owned=[...children].reverse();
      for(const c of owned)try{if(!c.closed)c.proc.kill();}catch{}
      for(const c of owned)if(!c.closed){
        let timer;await Promise.race([c.promise,new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);clearTimeout(timer);
        if(!c.closed)return false; // never start a duplicate on an unknown surviving process
      }
      children=[];
      return true;
    };
    for(let attempt=1;attempt<=3&&!stopping;attempt++){
      try{
        const chromeChild=launch('chrome',chrome,chromeLaunchArgs({root:project,dataRoot:project,env:next,ports},platform));
        if(!await wait(chromeChild,'http://127.0.0.1:'+ports.chrome+'/json/version',d=>typeof d.webSocketDebuggerUrl==='string'))throw Error('CHROME_NOT_READY');
        const nova=launch('novaBridge',execPath,[novaFile]);
        const attested=d=>d.ok===true&&d.browserVerified===true&&d.state==='READY'&&Number.isFinite(d.verificationAgeMs)&&d.verificationAgeMs>=0&&d.verificationAgeMs<=4000;
        if(!await wait(nova,next.NOVA_BRIDGE_URL+'/health',attested))throw Error('NOVA_BROWSER_UNVERIFIED');
        const cdp=launch('cdpBridge',execPath,[cdpFile]);
        if(!await wait(cdp,'http://127.0.0.1:'+ports.cdp+'/health',attested))throw Error('CDP_BROWSER_UNVERIFIED');
        report({component:'browser',event:'READY',attempt,ports});
        // Restart only the owned services, never an action. The existing durable
        // browser action journal/mission receipts own outcome reconciliation.
        await Promise.race(children.map(c=>c.promise));
        if(stopping)return;
        throw Error('BROWSER_OWNED_PROCESS_EXITED');
      }catch(e){
        report({component:'browser',event:'DEGRADED',attempt,reason:String(e.message).slice(0,120)});
        if(!await cleanup()||stopping)return;
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000*attempt));
      }
    }
  }
  return {env:next,start,stop,reason:null};
}
