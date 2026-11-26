// Open only the reviewed provider account page, never a challenge URL or credential.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pluginLoginPreset} from '../../lib/mcpIntegrationCatalog.mjs';
const exec=promisify(execFile);
const safeEnv=new Set(['PATH','Path','HOME','USERPROFILE','SYSTEMROOT','SystemRoot','WINDIR','APPDATA','LOCALAPPDATA','TEMP','TMP','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','LANG','TERMUX_VERSION','PREFIX']);
export function createPluginLogin({host,execute=exec,platform=process.platform,env=process.env,now=Date.now}={}){
  const last=new Map();
  return async function openPluginLogin(id){
    if(typeof id!=='string'||!/^[a-z][a-z0-9-]{1,40}$/.test(id))throw Error('PLUGIN_ID_INVALID');
    const servers=host.servers();
    const def=Object.hasOwn(servers,id)?servers[id]:null;
    const preset=pluginLoginPreset(id,def);
    if(!preset||def.allowOpenLogin!==true)throw Error('PLUGIN_LOGIN_NOT_APPROVED');
    const state=host.status().find(s=>s.id===id);
    if(!state)throw Error('PLUGIN_NOT_CONFIGURED');
    if(state.status==='READY'&&state.credentialConfigured!==false)return {plugin:id,state:'ALREADY_CONNECTED',opened:false};
    const at=now();
    if(last.has(id)&&at-last.get(id)<60000)throw Error('PLUGIN_LOGIN_RATE_LIMITED');
    last.set(id,at);
    const url=preset.loginUrl;
    // Static reviewed URLs only. The launcher never inherits provider keys or shell instructions.
    const [program,args]=platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:
      platform==='darwin'?['open',[url]]:platform==='android'||env.TERMUX_VERSION?['termux-open-url',[url]]:['xdg-open',[url]];
    const childEnv=Object.fromEntries(Object.entries(env).filter(([k,v])=>safeEnv.has(k)&&typeof v==='string'));
    try{await execute(program,args,{env:childEnv,windowsHide:true,timeout:10000,maxBuffer:16384,shell:false});}
    catch{throw Error('PLUGIN_BROWSER_OPEN_FAILED');}
    return {plugin:id,state:'BROWSER_OPEN_REQUEST_ACCEPTED',opened:true,authenticated:false,humanConsentRequired:true,
      note:'The OS accepted the launch request; browser rendering and authentication are unverified. The operator completes any sign-in or consent. Retry MCP discovery afterwards.'};
  };
}
