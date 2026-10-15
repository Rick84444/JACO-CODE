#!/usr/bin/env node
// JACO A2A v1.0 server: official @a2a-js/sdk JSON-RPC transport, durable principal-scoped task store,
// and a Continuum executor. Execution truth lives in the Continuum Runtime Hub; this process only reports it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import { AgentCard } from '@a2a-js/sdk';
import { DefaultRequestHandler } from '@a2a-js/sdk/server';
import { jsonRpcHandler } from '@a2a-js/sdk/server/express';
import { ContinuumA2ACoreClient } from './a2a-core-client.mjs';
import { DurablePrincipalTaskStore } from './a2a-task-store.mjs';
import { ContinuumAgentExecutor } from './a2a-executor.mjs';

const VERSION='0.22.0';
const HOST=process.env.JACO_A2A_HOST||'127.0.0.1';
const PORT=Number(process.env.JACO_A2A_PORT||2998);
const CORE=(process.env.JACO_BASE_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const CORE_TOKEN=process.env.JACO_CONTINUUM_TOKEN||process.env.JACO_GATEWAY_TOKEN||process.env.GATEWAY_TOKEN||'';
const CORE_IS_CONTINUUM=Boolean(process.env.JACO_CONTINUUM_TOKEN);
const PUBLIC_URL=(process.env.JACO_A2A_PUBLIC_URL||`http://${HOST}:${PORT}`).replace(/\/$/,'');
const isLoopback=['127.0.0.1','localhost','::1'].includes(HOST);
if(!Number.isInteger(PORT)||PORT<0||PORT>65535)throw new Error('invalid JACO_A2A_PORT');

// Peer-bound credentials: each token maps to one principal, and tasks are scoped to that principal.
// JACO_A2A_PEERS / JACO_A2A_PEERS_FILE: [{"principal":"peer-a","tokenSha256":"<hex>"}]. JACO_A2A_BEARER stays as principal "operator".
const sha=(v)=>crypto.createHash('sha256').update(String(v)).digest();
function loadPeers(){
  const raw=process.env.JACO_A2A_PEERS_FILE?fs.readFileSync(process.env.JACO_A2A_PEERS_FILE,'utf8'):(process.env.JACO_A2A_PEERS||'[]');
  const peers=JSON.parse(raw).map(p=>{const principal=String(p?.principal||'').trim();const digest=Buffer.from(String(p?.tokenSha256||''),'hex');if(!principal||digest.length!==32)throw new Error('JACO_A2A_PEERS entries need principal and a 64-hex tokenSha256');return {principal,digest};});
  if(process.env.JACO_A2A_BEARER)peers.push({principal:'operator',digest:sha(process.env.JACO_A2A_BEARER)});
  if(new Set(peers.map(p=>p.principal)).size!==peers.length)throw new Error('JACO_A2A_PEERS principals must be unique');
  return peers;
}
const PEERS=loadPeers();
if(!isLoopback&&!PEERS.length)throw new Error('Refusing non-loopback A2A bind without JACO_A2A_BEARER or JACO_A2A_PEERS');
const OPEN_LOOPBACK=isLoopback&&!PEERS.length;
// A loopback bind is not private when a tunnel publishes it: a non-loopback public URL requires credentials.
if(OPEN_LOOPBACK&&!['127.0.0.1','localhost','[::1]'].includes(new URL(PUBLIC_URL).hostname))throw new Error('Refusing to publish A2A at '+PUBLIC_URL+' without JACO_A2A_BEARER or JACO_A2A_PEERS');

function userFor(req){
  if(OPEN_LOOPBACK)return {isAuthenticated:true,userName:'loopback-local'};
  const header=String(req.headers.authorization||'');if(!header.startsWith('Bearer '))return null;
  const digest=sha(header.slice(7));const peer=PEERS.find(p=>crypto.timingSafeEqual(p.digest,digest));
  return peer?{isAuthenticated:true,userName:peer.principal}:null;
}

const bearerSecurity=PEERS.length>0;
const cardJson={
  name:'JACO Cognitive Runtime',
  description:'JACO Continuum A2A v1.0 boundary. Inbound work is queued into the Runtime Hub; execution requires JACO leases, policy gates and evidence. Task state is reported from the hub; completion carries evidence references.',
  supportedInterfaces:[{url:PUBLIC_URL,protocolBinding:'JSONRPC',protocolVersion:'1.0'}],
  version:VERSION,
  capabilities:{streaming:false,pushNotifications:false,extendedAgentCard:false,extensions:[{uri:'https://www.mimirpower.com/a2a/extensions/review-proof/v1',description:'Verified peer/self review findings and evidence references',required:false},{uri:'https://www.mimirpower.com/a2a/extensions/forecast-calibration/v1',description:'Probabilistic forecast/calibration metadata; synthetic simulations remain labeled synthetic',required:false},{uri:'https://www.mimirpower.com/a2a/extensions/soft-sandbox/v1',description:'Signals when work is constrained to an isolated JACO soft-sandbox workspace',required:false}]},
  securitySchemes:bearerSecurity?{jacoBearer:{httpAuthSecurityScheme:{scheme:'Bearer',description:'Operator-issued, peer-bound JACO A2A bearer'}}}:{},
  securityRequirements:bearerSecurity?[{schemes:{jacoBearer:{list:[]}}}]:[],
  defaultInputModes:['application/json','text/plain'],defaultOutputModes:['application/json','text/plain'],
  skills:[
    {id:'jaco_continuum_task',name:'JACO Continuum Task',description:'Submit bounded work to the JACO Runtime Hub. Submission is not proof of execution or completion.',tags:['jaco','continuum','a2a','evidence'],examples:['Submit a research or verified-execution task with explicit requirements.'],inputModes:['application/json','text/plain'],outputModes:['application/json']},
    {id:'jaco_review_request',name:'Independent Review',description:'Request bounded peer review. Findings are not rewarded until independently validated by evidence.',tags:['review','evidence','peer-review'],examples:['Review a task result for code quality or unjustified claims.'],inputModes:['application/json','text/plain'],outputModes:['application/json']},
    {id:'jaco_forecast_request',name:'Probabilistic Forecast',description:'Request a probabilistic forecast contribution for the rolling 90-day future window.',tags:['forecast','calibration','future'],examples:['Estimate probabilities for explicit outcomes and resolution date.'],inputModes:['application/json','text/plain'],outputModes:['application/json']},
    {id:'jaco_revenue_signal',name:'Verified Demand Signal',description:'Submit a demand or bounty signal (metadata.demandSignal) for economic evaluation; JACO does not credit revenue without external evidence.',tags:['marketplace','demand','revenue'],examples:['Report a verified bounty with source evidence.'],inputModes:['application/json','text/plain'],outputModes:['application/json']}
  ]
};
const card=AgentCard.fromJSON(cardJson);

const core=new ContinuumA2ACoreClient({baseUrl:CORE,token:CORE_TOKEN,isContinuum:CORE_IS_CONTINUUM});
const taskStore=new DurablePrincipalTaskStore({port:PORT,core});
const executor=new ContinuumAgentExecutor({core,taskStore});
const requestHandler=new DefaultRequestHandler(card,taskStore,executor);

const app=express();
app.disable('x-powered-by');
app.get('/health',(_req,res)=>res.set('cache-control','no-store').json({success:true,product:'JACO Continuum A2A Adapter',version:VERSION,protocol:'1.0',sdk:'@a2a-js/sdk',core:CORE,taskStore:'durable-principal-scoped',evidenceState:'RUNTIME_HANDSHAKE_REQUIRED_FOR_EXECUTION'}));
// Served from the wire form: the SDK card handler would stringify the internal oneof representation.
app.get('/.well-known/agent-card.json',(_req,res)=>res.set('cache-control','public, max-age=300').json(AgentCard.toJSON(card)));
app.post('/',(req,res,next)=>{const user=userFor(req);if(!user)return res.status(401).set('www-authenticate','Bearer').json({error:'A2A_AUTH_REQUIRED'});req.jacoUser=user;next();},
  jsonRpcHandler({requestHandler,userBuilder:async(req)=>req.jacoUser}));
app.use((_req,res)=>res.status(404).json({error:'NOT_FOUND'}));

const server=app.listen(PORT,HOST,()=>console.error(`[JACO A2A] http://${HOST}:${server.address().port} protocol=1.0 sdk=@a2a-js/sdk peers=${OPEN_LOOPBACK?'loopback-open':PEERS.length}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
