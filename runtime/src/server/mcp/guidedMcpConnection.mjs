import { SecretStore, credential } from '../../../../agents/lib/secret-store.mjs';
import { HttpMcpClient, mcpCredential, classifyMcpNetworkError } from './httpMcpClient.mjs';
import { guidedMcpPreset, catalogDefinitionMatches, guidedCredentialMatches, stripeSandboxKey } from '../../lib/mcpIntegrationCatalog.mjs';

function proofPayload(result){
  if(!result||result.isError===true)throw Error('MCP_GUIDED_READ_REJECTED');
  if(result.structuredContent&&typeof result.structuredContent==='object')return result.structuredContent;
  const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  try{return JSON.parse(text);}catch{throw Error('MCP_GUIDED_PROOF_INVALID');}
}

function verifyPayload(id,payload){
  if(id==='github-remote'){
    const user=payload?.user||payload;
    if(typeof user?.login!=='string'||!user.login||!(typeof user.id==='number'||typeof user.id==='string'))throw Error('MCP_GUIDED_PROOF_INVALID');
    return {accountObserved:true};
  }
  if(id==='stripe-sandbox'){
    const account=payload?.account||payload;
    if(typeof account?.id!=='string'||!/^acct_[A-Za-z0-9]+$/.test(account.id)||account.livemode===true||payload?.livemode===true)throw Error('MCP_GUIDED_PROOF_INVALID');
    return {accountObserved:true,environment:'SANDBOX'};
  }
  const workspaces=Array.isArray(payload)?payload:payload?.workspaces;
  if(!Array.isArray(workspaces)||!workspaces.every(w=>typeof w?.id==='string'&&w.id))throw Error('MCP_GUIDED_PROOF_INVALID');
  return {workspaceCount:workspaces.length};
}

/** @param {{host:any,store?:any,env?:NodeJS.ProcessEnv,createClient?:(id:string,definition:any,env:any)=>any,now?:()=>number}} options */
export function createGuidedMcpConnection({host,store=new SecretStore(),env=process.env,createClient=(id,definition,probeEnv)=>new HttpMcpClient(id,definition,{env:probeEnv}),now=Date.now}){
  const pending=new Set();
  return async function connect(id,input={}){
    const preset=guidedMcpPreset(id);
    if(!preset)throw Error('MCP_GUIDED_UNSUPPORTED');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['token','allowOpenLogin','replaceCredential'].includes(k)))throw Error('MCP_GUIDED_INPUT_INVALID');
    if(input.allowOpenLogin!==undefined&&typeof input.allowOpenLogin!=='boolean')throw Error('MCP_GUIDED_INPUT_INVALID');
    if(input.replaceCredential!==undefined&&typeof input.replaceCredential!=='boolean')throw Error('MCP_GUIDED_INPUT_INVALID');
    if(input.token!==undefined&&typeof input.token!=='string')throw Error('MCP_GUIDED_INPUT_INVALID');
    if(pending.has(id))throw Error('MCP_GUIDED_BUSY');
    pending.add(id);
    try{
      const before=host.servers()[id];
      const beforeKey=JSON.stringify(before||null);
      if(before&&(!catalogDefinitionMatches(id,before)||before.agentAccess==='off'))throw Error('MCP_GUIDED_EXISTING_CONFIGURATION');
      const submitted=input.token?.trim()||'';
      if(submitted.length>16384||/[\r\n\x00]/.test(submitted))throw Error('MCP_GUIDED_INPUT_INVALID');
      const replacing=input.replaceCredential===true;
      if(replacing&&(!before||!submitted||before.agentAccess!=='read'||!guidedCredentialMatches(id,before)))throw Error('MCP_GUIDED_REPLACEMENT_NOT_SUPPORTED');
      if(before&&submitted&&!replacing)throw Error('MCP_GUIDED_REPLACEMENT_NOT_SUPPORTED');
      if(!before&&submitted&&store.has(preset.credentialRef))throw Error('MCP_GUIDED_CREDENTIAL_EXISTS');
      const prior=replacing?store.get(preset.credentialRef):null;
      const token=replacing?submitted:before?mcpCredential(id,before,env):submitted||store.get(preset.credentialRef)||(id==='stripe-sandbox'?'':credential(preset.tokenEnv,{env,store}));
      if(!token)throw Error('MCP_CREDENTIAL_REQUIRED');
      if(id==='stripe-sandbox'&&!stripeSandboxKey(token))throw Error('MCP_STRIPE_SANDBOX_KEY_REQUIRED');
      // Temporary session: Render's list_workspaces may select its sole workspace
      // in this session. No deployment, resource change or persistent selection.
      const probeDef={transport:'http',url:preset.target,tokenEnv:id==='stripe-sandbox'?'STRIPE_SANDBOX_PROBE_KEY':preset.tokenEnv};
      const client=createClient(id,probeDef,{[probeDef.tokenEnv]:token,NODE_TLS_REJECT_UNAUTHORIZED:env.NODE_TLS_REJECT_UNAUTHORIZED});
      let proof;
      const probeStarted=now();
      try{
        await client.start();
        const tool=client.tools.find(t=>t.name===preset.tool);
        if(!tool||tool.inputSchema?.type!=='object'||(tool.inputSchema.required||[]).length||id!=='render'&&tool.readOnly!==true)throw Error('MCP_GUIDED_PROBE_UNAVAILABLE');
        proof=verifyPayload(id,proofPayload(await client.request('tools/call',{name:preset.tool,arguments:{}},15000)));
      }catch(error){throw Error(classifyMcpNetworkError(error));}
      finally{client.stop();}
      const probeFinished=now();
      const verifiedAt=new Date(probeFinished).toISOString();
      if(JSON.stringify(host.servers()[id]||null)!==beforeKey)throw Error('MCP_GUIDED_CONFIGURATION_CHANGED');
      if(replacing){
        if(!store.replaceIfCurrent(preset.credentialRef,prior,token,{source:'operator-guided-mcp',purpose:preset.name+' MCP credential'}))throw Error('MCP_GUIDED_CREDENTIAL_CHANGED');
        host.resetConnection(id);
      }
      if(!before){
        if(!store.has(preset.credentialRef)){
          if(!store.setIfAbsent(preset.credentialRef,token,{source:'operator-guided-mcp',purpose:preset.name+' MCP credential'}))throw Error('MCP_GUIDED_CREDENTIAL_EXISTS');
        }else if(store.get(preset.credentialRef)!==token)throw Error('MCP_GUIDED_CREDENTIAL_EXISTS');
        try{host.saveServer(id,{name:preset.name,transport:'http',url:preset.target,tokenEnv:preset.credentialRef,icon:preset.icon,agentAccess:'read',allowOpenLogin:input.allowOpenLogin===true});}
        catch{throw Error('MCP_GUIDED_CREDENTIAL_STORED_CONFIG_FAILED');}
      }
      let tools;
      try{tools=await host.start(id);}
      catch{return {id,state:'CONFIGURED_RECONNECT_REQUIRED',verifiedAt,probe:preset.tool,proof,credentialReplaced:replacing,toolCount:null,agentExecutionVerified:false};}
      host.record(id,{tool:preset.tool,actor:'operator',outcome:'ok',error:null,ms:Math.max(0,probeFinished-probeStarted),at:verifiedAt});
      return {id,state:'READ_PROBE_VERIFIED',verifiedAt,probe:preset.tool,proof,credentialReplaced:replacing,toolCount:tools.length,agentExecutionVerified:false};
    }finally{pending.delete(id);}
  };
}
