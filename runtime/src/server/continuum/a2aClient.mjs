import { nowIso, sha256, canonicalJson } from './util.mjs';
import { assertPeerUrl, bearerFromEnv, guardedRequest, validateAgentCard } from './outboundGuard.mjs';

function normalizeBase(v){const u=assertPeerUrl(v);return u.origin+u.pathname.replace(/\/$/,'');}
function rpcError(raw){return JSON.stringify(raw?.error||raw||{}).slice(0,500);}

// Outbound A2A v1.0 client. Peers come only from the trust registry (discover first); a card in a request body is
// never trusted. Bearers go only to the origin that served the discovered card.
export class A2AClient {
  constructor(events,evidence,trust=null){this.events=events;this.evidence=evidence;this.trust=trust;}

  async discover(baseUrl,{bearerEnv=null}={}){
    const base=normalizeBase(baseUrl);const cardUrl=new URL('/.well-known/agent-card.json',base);const bearer=bearerFromEnv(bearerEnv);
    const response=await guardedRequest(cardUrl,{headers:bearer?{authorization:`Bearer ${bearer}`}:{}});
    if(!response.ok)throw new Error(`A2A_DISCOVERY_HTTP_${response.status}`);
    const card=response.json;const errors=validateAgentCard(card);if(errors.length)throw new Error(`A2A_AGENT_CARD_INVALID:${errors.slice(0,5).join('; ')}`);
    const signed=Array.isArray(card.signatures)&&card.signatures.length>0;
    // What is verified is that this URL served this card. Who operates the peer is not verified: signatures are not checked.
    const ev=this.evidence.record({kind:'a2a-agent-card',claim:`Agent Card "${card.name}" served at ${cardUrl}`,source:String(cardUrl),verified:true,verificationMethod:'HTTP response from guarded outbound request; peer identity not verified',data:{name:card.name,version:card.version,protocolVersion:card.supportedInterfaces?.[0]?.protocolVersion,skills:card.skills||[],extensions:card.capabilities?.extensions||[],securitySchemes:Object.keys(card.securitySchemes||{}),cardHash:`sha256:${sha256(canonicalJson(card))}`,identityVerified:false,signed,signatureVerified:false}},'a2a-client');
    const peer=this.trust?.observe(base,card,ev.id,'a2a-client')||null;
    this.events.append({stream:'a2a',type:'a2a.agent_discovered',actor:'a2a-client',data:{name:card.name,baseUrl:String(base),evidenceRef:ev.id,peerId:peer?.id||null,identityVerified:false}});
    return {card,evidenceRef:ev.id,peer,discoveredAt:nowIso()};
  }

  #peer({peerId=null,baseUrl=null}={}){
    if(!this.trust)throw new Error('A2A_TRUST_REGISTRY_REQUIRED');
    const peer=peerId?this.trust.get(peerId):(baseUrl?this.trust.findByBase(normalizeBase(baseUrl)):null);
    if(!peer)throw new Error('A2A_PEER_NOT_DISCOVERED: call /a2a/discover first');
    const iface=(peer.interfaces||[]).find(x=>String(x.protocolBinding).toUpperCase()==='JSONRPC'&&String(x.protocolVersion)==='1.0');
    if(!iface)throw new Error('A2A_PEER_HAS_NO_JSONRPC_1_0_INTERFACE');
    return {peer,url:assertPeerUrl(iface.url)};
  }

  async #call(target,method,params,{bearerEnv=null,timeoutMs=30000}={}){
    const {peer,url}=target;const bearer=bearerFromEnv(bearerEnv);
    if(bearer&&url.origin!==new URL(peer.baseUrl).origin)throw new Error('A2A_BEARER_ORIGIN_MISMATCH: bearer is only sent to the origin that served the card');
    const id=`jaco-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response=await guardedRequest(url,{method:'POST',headers:{'content-type':'application/json','A2A-Version':'1.0',...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:{jsonrpc:'2.0',id,method,params},timeoutMs,maxBytes:1024*1024});
    const raw=response.json||{};
    if(!response.ok||raw.error||raw.result===undefined)throw new Error(`A2A_${method.toUpperCase()}_FAILED:${response.status}:${rpcError(raw)}`);
    return {id,url,result:raw.result};
  }

  async sendMessage({peerId=null,baseUrl=null,message,bearerEnv=null,metadata={},configuration={}}={}){
    const target=this.#peer({peerId,baseUrl});
    try{
      const {id,url,result}=await this.#call(target,'SendMessage',{message,configuration,metadata},{bearerEnv});
      const ev=this.evidence.record({kind:'a2a-outbound-receipt',claim:`A2A SendMessage accepted by ${target.peer.name}`,source:String(url),verified:true,verificationMethod:'JSON-RPC success response; acceptance is not completion',data:{requestId:id,peerId:target.peer.id,result}},'a2a-client');
      this.trust.markOutcome(target.peer.id,{success:true,evidenceRefs:[ev.id]});
      this.events.append({stream:'a2a',type:'a2a.message_sent',entityId:id,actor:'a2a-client',data:{agent:target.peer.name,evidenceRef:ev.id,peerId:target.peer.id}});
      return {result,evidenceRef:ev.id,peerId:target.peer.id};
    }catch(error){try{this.trust.markOutcome(target.peer.id,{success:false,evidenceRefs:[]});}catch{}throw error;}
  }

  async getTask({peerId=null,baseUrl=null,taskId,historyLength,bearerEnv=null}={}){
    if(!taskId)throw new Error('A2A_TASK_ID_REQUIRED');
    const {result}=await this.#call(this.#peer({peerId,baseUrl}),'GetTask',{id:String(taskId),...(historyLength!==undefined?{historyLength}:{})},{bearerEnv});
    return {task:result};
  }

  async cancelTask({peerId=null,baseUrl=null,taskId,bearerEnv=null}={}){
    if(!taskId)throw new Error('A2A_TASK_ID_REQUIRED');
    const target=this.#peer({peerId,baseUrl});
    const {url,result}=await this.#call(target,'CancelTask',{id:String(taskId)},{bearerEnv});
    this.events.append({stream:'a2a',type:'a2a.task_cancel_requested',entityId:String(taskId),actor:'a2a-client',data:{peerId:target.peer.id,state:result?.status?.state??null,url:String(url)}});
    return {task:result};
  }
}
