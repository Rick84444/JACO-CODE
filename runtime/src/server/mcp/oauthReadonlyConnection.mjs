// Operator-only Linear OAuth onboarding, built on the existing MCP host and vault.
import {HttpMcpClient} from './httpMcpClient.mjs';
import {ReadonlyMcpOAuthSession} from './oauthReadonlySession.mjs';
import {LINEAR_OAUTH_REF,oauthDefinitionMatches,readonlyOAuthCredentials} from './oauthReadonlyCredentials.mjs';
import {LINEAR_OAUTH} from './oauthReadonly.mjs';

const definition=Object.freeze({name:'Linear',role:'OAuth read-only project management',transport:'http',url:LINEAR_OAUTH.resource,tokenEnv:LINEAR_OAUTH_REF,icon:'mcp',agentAccess:'read'});
const safeCode=e=>/^MCP_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'MCP_OAUTH_CONNECTION_FAILED';
function verifyAccount(result){
  if(!result||result.isError===true)throw Error('MCP_OAUTH_ACCOUNT_PROBE_FAILED');
  let payload=result.structuredContent;
  if(!payload){
    try{payload=JSON.parse(result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n'));}
    catch{throw Error('MCP_OAUTH_ACCOUNT_PROOF_INVALID');}
  }
  const user=payload?.user||payload;
  if(typeof user?.id!=='string'||!user.id||typeof user?.name!=='string'||!user.name)throw Error('MCP_OAUTH_ACCOUNT_PROOF_INVALID');
}

/** @param {{host:any,credentials?:any,fetchImpl?:typeof fetch,now?:()=>number,onChange?:()=>void}} options */
export function createReadonlyOAuthConnection({host,credentials=readonlyOAuthCredentials,fetchImpl=fetch,now=Date.now,onChange=()=>{}}){
  let configurationBefore=null,connectionError=null;
  const snapshot=()=>JSON.stringify(host.readConfig().servers?.linear??null);
  const session=new ReadonlyMcpOAuthSession({fetchImpl,onAuthorized:async(auth,isCurrent)=>{
    // Temporary probe: no account credential is persisted until the read succeeds.
    const client=new HttpMcpClient('linear',definition,{fetchImpl,oauthCredentials:{
      access:async()=>auth.accessToken,
      invalidate:()=>false
    }});
    try{
      await client.start();
      const tool=client.tools.find(t=>t.name==='get_user'&&t.readOnly===true&&t.inputSchema?.type==='object'&&t.inputSchema?.properties?.query?.type==='string'&&(t.inputSchema.required||[]).every(k=>k==='query'));
      if(!tool)throw Error('MCP_OAUTH_ACCOUNT_PROBE_UNAVAILABLE');
      verifyAccount(await client.request('tools/call',{name:'get_user',arguments:{query:'me'}},15000));
    }finally{client.stop();}
    if(!isCurrent())throw Error('MCP_OAUTH_CANCELLED');
    if(snapshot()!==configurationBefore||host.servers().linear)throw Error('MCP_OAUTH_CONFIGURATION_CHANGED');
    credentials.installVerified(auth,new Date(now()).toISOString());
    try{host.saveServer('linear',definition);}
    catch{throw Error('MCP_OAUTH_VAULT_SAVED_CONFIG_FAILED');}
    try{await host.start('linear');connectionError=null;}
    catch(e){connectionError=safeCode(e);}
    finally{onChange();}
  }});
  function status(){
    const config=host.servers().linear;
    const scoped=oauthDefinitionMatches('linear',config);
    const auth=credentials.status();
    const flow=session.status();
    const row=scoped?host.status().find(p=>p.id==='linear'):null;
    const verifiedAt=scoped?auth.verifiedAt:null;
    return {provider:'linear',state:flow.state,error:flow.error||connectionError||null,pending:flow.pending,
      existingConfiguration:!!config&&!scoped,credentialState:auth.state,configured:scoped,
      accountVerified:!!verifiedAt,verifiedAt,toolsDiscovered:row?.status==='READY'?row.tools.length:null,
      runtimeReady:row?.status==='READY'&&auth.state==='AUTHORIZED',agentExecutionVerified:false};
  }
  return {
    status,
    async start(){
      if(session.status().pending)throw Error('MCP_OAUTH_BUSY');
      // Keep operator custom configuration and disabled entries intact.
      if(host.servers().linear||host.readConfig().servers?.linear)throw Error('MCP_OAUTH_EXISTING_CONFIGURATION');
      if(credentials.status().state!=='NOT_CONFIGURED')throw Error('MCP_OAUTH_DISCONNECT_FIRST');
      configurationBefore=snapshot();connectionError=null;
      return session.start();
    },
    cancel(){session.cancel();return status();},
    disconnect(){
      const config=host.servers().linear;
      const saved=host.readConfig().servers?.linear;
      if(config&&!oauthDefinitionMatches('linear',config)||saved&&!oauthDefinitionMatches('linear',saved))throw Error('MCP_OAUTH_EXISTING_CONFIGURATION');
      session.cancel();
      // Local removal only. Provider revocation is a distinct operator action.
      credentials.store.delete(LINEAR_OAUTH_REF);
      if(config)host.removeServer('linear');
      else if(saved){const c=host.readConfig();delete c.servers.linear;host.writeConfig(c);}
      connectionError=null;onChange();
      return status();
    }
  };
}
