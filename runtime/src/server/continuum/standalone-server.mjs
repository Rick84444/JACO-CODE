#!/usr/bin/env node
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContinuumRuntime } from './continuumRuntime.mjs';
import { CoreBrowserSessionsAdapter } from './coreBrowserAdapter.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const releaseRoot=path.resolve(here,'..','..','..');
const workspaceRoot=path.resolve(process.env.JACO_CONTINUUM_WORKSPACE||releaseRoot);
const HOST=process.env.JACO_CONTINUUM_HOST||'127.0.0.1';const PORT=Number(process.env.JACO_CONTINUUM_PORT||3020);
const TOKEN=process.env.JACO_CONTINUUM_TOKEN||'';const substrate=process.env.JACO_SUBSTRATE_URL||'http://127.0.0.1:3000';const substrateToken=process.env.JACO_SUBSTRATE_TOKEN||process.env.GATEWAY_TOKEN||'';
const loopback=['127.0.0.1','localhost','::1'].includes(HOST);if(!loopback&&!TOKEN)throw new Error('Refusing non-loopback Continuum bind without JACO_CONTINUUM_TOKEN');
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('invalid JACO_CONTINUUM_PORT');
const browserSessions=new CoreBrowserSessionsAdapter({baseUrl:substrate,token:substrateToken});const runtime=new ContinuumRuntime({workspaceRoot,browserSessions});

const enc=(v)=>Buffer.from(JSON.stringify(v));
function send(res,status,body,headers={}){const d=enc(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':d.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...headers});res.end(d);}
function auth(req){if(!TOKEN)return loopback;const h=String(req.headers.authorization||'');const x=String(req.headers['x-jaco-continuum-token']||'');const got=h.startsWith('Bearer ')?h.slice(7):x;if(!got)return false;const a=Buffer.from(got),b=Buffer.from(TOKEN);return a.length===b.length&&timingSafeEqual(a,b);}
async function body(req,max=2*1024*1024){let n=0;const parts=[];for await(const c of req){n+=c.length;if(n>max)throw new Error('BODY_TOO_LARGE');parts.push(c);}const t=Buffer.concat(parts).toString('utf8');return t?JSON.parse(t):{};}
const actor=(req,b)=>String(req.headers['x-jaco-model-id']||b?.actor||'operator').slice(0,120);
const ok=(res,data,status=200)=>send(res,status,{success:true,...data});const fail=(res,e,status=400)=>{const m=e instanceof Error?e.message:String(e);send(res,/not found/i.test(m)?404:status,{success:false,error:{code:m.split(':')[0],message:m}})};
const id=(url,prefix)=>decodeURIComponent(url.pathname.slice(prefix.length));

async function handle(req,res){
 const url=new URL(req.url||'/',`http://${req.headers.host||`${HOST}:${PORT}`}`);
 if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{success:true,product:'JACO Cognitive Runtime Continuum',version:'0.22.0',releaseId:'jaco-code-0.22.0',status:'READY',bind:`${HOST}:${PORT}`,executionSubstrate:substrate,truth:'Continuum control plane ready; substrate capabilities require separate evidence'});
 if(req.method==='GET'&&url.pathname==='/api/runtime/identity')return send(res,200,{success:true,product:'JACO Cognitive Runtime',version:'0.22.0',releaseId:'jaco-code-0.22.0',canonicalGui:'JACO Autonomous IDE (substrate)',primaryPort:PORT,controlPlane:'CONTINUUM_SIDECAR',executionSubstrate:substrate,evidence:'RUNTIME_SELF_REPORT'});
 if(!auth(req))return send(res,401,{success:false,error:{code:'CONTINUUM_AUTH_REQUIRED',message:'Bearer or x-jaco-continuum-token required'}},{'www-authenticate':'Bearer'});
 let b={};if(!['GET','HEAD'].includes(req.method||'')){try{b=await body(req)}catch(e){return fail(res,e,400)}}
 try{
  if(req.method==='GET'&&url.pathname==='/api/continuum/status'){const substrateProbe=await browserSessions.probe();return ok(res,{status:{...runtime.status(),substrate:substrateProbe}})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/integrity')return ok(res,{integrity:runtime.events.verify()});
  if(req.method==='GET'&&url.pathname==='/api/continuum/events')return ok(res,{events:runtime.events.list({stream:url.searchParams.get('stream'),entityId:url.searchParams.get('entityId'),type:url.searchParams.get('type'),afterSequence:Number(url.searchParams.get('afterSequence')||0),limit:Number(url.searchParams.get('limit')||200)})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/operator/pause')return ok(res,{state:runtime.pause(actor(req,b),b.reason)});
  if(req.method==='POST'&&url.pathname==='/api/continuum/operator/resume')return ok(res,{state:runtime.resume(actor(req,b),b.reason)});
  if(req.method==='POST'&&url.pathname==='/api/continuum/operator/emergency-stop')return ok(res,{state:runtime.emergencyStop(actor(req,b),b.reason)});
  if(req.method==='POST'&&url.pathname==='/api/continuum/operator/reset-emergency')return ok(res,{state:runtime.operator.resetEmergency(actor(req,b),b.reason)});
  if(req.method==='GET'&&url.pathname==='/api/continuum/scheduler')return ok(res,{scheduler:runtime.scheduler.snapshot()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/scheduler/start')return ok(res,{scheduler:runtime.scheduler.start({actor:actor(req,b),intervalMs:b.intervalMs})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/scheduler/stop')return ok(res,{scheduler:runtime.scheduler.stop({actor:actor(req,b),reason:b.reason||'operator stop'})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/scheduler/tick')return ok(res,{result:await runtime.scheduler.tick()});
  if(req.method==='GET'&&url.pathname==='/api/continuum/missions')return ok(res,{missions:runtime.missions.list({state:url.searchParams.get('state'),limit:Number(url.searchParams.get('limit')||200)})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/missions')return ok(res,{mission:runtime.missions.create(b,actor(req,b))},201);
  if(req.method==='GET'&&/^\/api\/continuum\/missions\/[^/]+\/capsule$/.test(url.pathname)){const mid=url.pathname.split('/').at(-2);return ok(res,{capsule:runtime.missionCapsule(mid)})}
  if(req.method==='GET'&&/^\/api\/continuum\/missions\/[^/]+$/.test(url.pathname)){const mid=url.pathname.split('/').at(-1);return ok(res,{mission:runtime.missions.get(mid),graph:runtime.commitments.graph(mid)})}
  if(req.method==='POST'&&/^\/api\/continuum\/missions\/[^/]+\/transition$/.test(url.pathname)){const mid=url.pathname.split('/').at(-2);return ok(res,{mission:runtime.missions.transition(mid,String(b.state||''),{actor:actor(req,b),reason:b.reason,evidenceRefs:b.evidenceRefs||[]})})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/commitments')return ok(res,{commitments:runtime.commitments.list({missionId:url.searchParams.get('missionId'),state:url.searchParams.get('state')})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/commitments')return ok(res,{commitment:runtime.commitments.create(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/commitments\/[^/]+\/transition$/.test(url.pathname)){const cid=url.pathname.split('/').at(-2);return ok(res,{commitment:runtime.commitments.transition(cid,String(b.state||''),{actor:actor(req,b),reason:b.reason,evidenceRefs:b.evidenceRefs||[]})})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/evidence')return ok(res,{evidence:runtime.evidence.list({verified:url.searchParams.has('verified')?url.searchParams.get('verified')==='true':null,kind:url.searchParams.get('kind'),limit:Number(url.searchParams.get('limit')||200)})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/evidence')return ok(res,{evidence:runtime.evidence.record(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/evidence\/[^/]+\/verify$/.test(url.pathname)){const eid=url.pathname.split('/').at(-2);return ok(res,{evidence:runtime.evidence.verify(eid,{method:b.method,actor:actor(req,b),data:b.data})})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/leases')return ok(res,{leases:runtime.leases.list({activeOnly:url.searchParams.get('active')==='true'})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/leases')return ok(res,{lease:runtime.leases.issue(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/leases\/[^/]+\/revoke$/.test(url.pathname)){const lid=url.pathname.split('/').at(-2);return ok(res,{lease:runtime.leases.revoke(lid,actor(req,b),b.reason)})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/hub/agents')return ok(res,{agents:runtime.hub.listAgents()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/hub/agents')return ok(res,{agent:runtime.hub.registerAgent(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/hub\/agents\/[^/]+\/heartbeat$/.test(url.pathname)){const aid=url.pathname.split('/').at(-2);return ok(res,{agent:runtime.hub.heartbeat(aid,b)})}
  if(req.method==='GET'&&/^\/api\/continuum\/hub\/agents\/[^/]+\/inbox$/.test(url.pathname)){const aid=url.pathname.split('/').at(-2);return ok(res,{messages:runtime.hub.inbox(aid,{after:url.searchParams.get('after'),limit:Number(url.searchParams.get('limit')||100)})})}
  if(req.method==='POST'&&url.pathname==='/api/continuum/hub/messages')return ok(res,{message:runtime.hub.sendMessage(b,actor(req,b))},201);
  if(req.method==='GET'&&url.pathname==='/api/continuum/hub/tasks')return ok(res,{tasks:runtime.hub.listTasks({missionId:url.searchParams.get('missionId'),status:url.searchParams.get('status')})});
  if(req.method==='GET'&&/^\/api\/continuum\/hub\/tasks\/[^/]+$/.test(url.pathname)){const tid=url.pathname.split('/').at(-1);const task=runtime.hub.listTasks().find(t=>t.id===tid);if(!task)throw new Error('task not found');return ok(res,{task})}
  if(req.method==='POST'&&url.pathname==='/api/continuum/hub/tasks')return ok(res,{task:runtime.hub.createTask(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/hub\/tasks\/[^/]+\/claim$/.test(url.pathname)){const tid=url.pathname.split('/').at(-2);return ok(res,{task:runtime.hub.claimTask(tid,String(b.agentId||''),String(b.leaseId||''))})}
  if(req.method==='POST'&&/^\/api\/continuum\/hub\/tasks\/[^/]+\/cancel$/.test(url.pathname)){const tid=url.pathname.split('/').at(-2);return ok(res,{task:runtime.hub.cancelTask(tid,{actor:actor(req,b),reason:b.reason})})}
  if(req.method==='POST'&&/^\/api\/continuum\/hub\/tasks\/[^/]+\/complete$/.test(url.pathname)){const tid=url.pathname.split('/').at(-2);return ok(res,{task:runtime.hub.completeTask(tid,{agentId:b.agentId,status:b.status,evidenceRefs:b.evidenceRefs||[]})})}
  if(req.method==='POST'&&/^\/api\/continuum\/hub\/tasks\/[^/]+\/reconcile$/.test(url.pathname)){const tid=url.pathname.split('/').at(-2);return ok(res,{task:runtime.hub.reconcileUnknownTask(tid,{resolution:b.resolution,evidenceRefs:b.evidenceRefs||[],actor:actor(req,b)})})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/economic')return ok(res,{economic:runtime.economic.snapshot()});
  if(req.method==='PATCH'&&url.pathname==='/api/continuum/economic/policy')return ok(res,{economic:runtime.economic.updatePolicy(b,actor(req,b))});
  if(req.method==='POST'&&url.pathname==='/api/continuum/economic/revenue')return ok(res,{economic:runtime.economic.recordRevenue(b)});
  if(req.method==='GET'&&url.pathname==='/api/continuum/revenue/signals')return ok(res,{signals:runtime.revenue.listSignals({verified:url.searchParams.has('verified')?url.searchParams.get('verified')==='true':null,limit:Number(url.searchParams.get('limit')||100)})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/revenue/signals')return ok(res,{signal:runtime.revenue.recordSignal(b,actor(req,b))},201);
  if(req.method==='GET'&&url.pathname==='/api/continuum/revenue/opportunities')return ok(res,{opportunities:runtime.revenue.rank({verifiedSignalsOnly:url.searchParams.get('verifiedSignalsOnly')==='true',limit:Number(url.searchParams.get('limit')||50)})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/revenue/opportunities')return ok(res,{opportunity:runtime.revenue.createOpportunity(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/revenue\/opportunities\/[^/]+\/status$/.test(url.pathname)){const oid=url.pathname.split('/').at(-2);return ok(res,{opportunity:runtime.revenue.mark(oid,String(b.status||''),{actor:actor(req,b),evidenceRefs:b.evidenceRefs||[]})})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/knowledge'){const q=String(url.searchParams.get('q')||'');return ok(res,{knowledge:q?runtime.knowledge.search(q,{limit:Number(url.searchParams.get('limit')||20),includeInactive:url.searchParams.get('includeInactive')==='true'}):runtime.knowledge.list({kind:url.searchParams.get('kind'),minConfidence:Number(url.searchParams.get('minConfidence')||0),reusable:url.searchParams.has('reusable')?url.searchParams.get('reusable')==='true':null,limit:Number(url.searchParams.get('limit')||200)})})}
  if(req.method==='POST'&&url.pathname==='/api/continuum/knowledge')return ok(res,{knowledge:runtime.knowledge.put(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/knowledge\/[^/]+\/status$/.test(url.pathname)){const kid=url.pathname.split('/').at(-2);return ok(res,{knowledge:runtime.knowledge.setStatus(kid,String(b.status||''),{reason:b.reason,evidenceRefs:b.evidenceRefs||[]},actor(req,b))})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/hypotheses')return ok(res,{sets:runtime.hypotheses.list()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/hypotheses')return ok(res,{set:runtime.hypotheses.createSet(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/hypotheses\/[^/]+\/candidates$/.test(url.pathname)){const sid=url.pathname.split('/').at(-2);return ok(res,{candidate:runtime.hypotheses.addCandidate(sid,b,actor(req,b))},201)}
  if(req.method==='POST'&&/^\/api\/continuum\/hypotheses\/[^/]+\/candidates\/[^/]+\/evaluate$/.test(url.pathname)){const ps=url.pathname.split('/');return ok(res,{candidate:runtime.hypotheses.evaluate(ps.at(-4),ps.at(-2),b,actor(req,b))})}
  if(req.method==='POST'&&/^\/api\/continuum\/hypotheses\/[^/]+\/select$/.test(url.pathname)){const sid=url.pathname.split('/').at(-2);return ok(res,{set:runtime.hypotheses.selectWinner(sid,b.candidateId||null,actor(req,b))})}
  if(req.method==='GET'&&/^\/api\/continuum\/hypotheses\/[^/]+\/rank$/.test(url.pathname)){const sid=url.pathname.split('/').at(-2);return ok(res,{ranking:runtime.hypotheses.rank(sid)})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/capabilities')return ok(res,{capabilities:runtime.capabilities.list()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/capabilities/trajectories')return ok(res,{trajectory:runtime.capabilities.recordTrajectory(b,actor(req,b))},201);
  if(req.method==='POST'&&url.pathname==='/api/continuum/capabilities/compile')return ok(res,runtime.capabilities.compile(String(b.workflowKey||''),{minimumVerifiedSuccesses:Number(b.minimumVerifiedSuccesses||3)},actor(req,b)));
  if(req.method==='POST'&&/^\/api\/continuum\/capabilities\/[^/]+\/promote$/.test(url.pathname)){const cid=url.pathname.split('/').at(-2);return ok(res,{capability:runtime.capabilities.promote(cid,{evidenceRefs:b.evidenceRefs||[]},actor(req,b))})}
  if(req.method==='POST'&&url.pathname==='/api/continuum/compression/trajectories')return ok(res,{knowledge:runtime.compressor.compressTrajectories({workflowKey:b.workflowKey,minimum:Number(b.minimum||5)})});

  if(req.method==='GET'&&url.pathname==='/api/continuum/cognition/graph')return ok(res,{graph:runtime.cognition.graphSnapshot({limit:Number(url.searchParams.get('limit')||200),includeInactive:url.searchParams.get('includeInactive')==='true'})});
  if(req.method==='GET'&&url.pathname==='/api/continuum/cognition/graph/search')return ok(res,{result:runtime.cognition.graphSearch(String(url.searchParams.get('q')||''),{limit:Number(url.searchParams.get('limit')||20),includeInactive:url.searchParams.get('includeInactive')==='true'})});
  if(req.method==='GET'&&url.pathname==='/api/continuum/cognition/graph/neighbors')return ok(res,{result:runtime.cognition.graphNeighbors(String(url.searchParams.get('id')||''),{depth:Number(url.searchParams.get('depth')||1),limit:Number(url.searchParams.get('limit')||100),includeInactive:url.searchParams.get('includeInactive')==='true'})});
  if(req.method==='GET'&&url.pathname==='/api/continuum/cognition')return ok(res,{cognition:runtime.cognition.snapshot()});
  if(req.method==='GET'&&url.pathname==='/api/continuum/cognition/self-model')return ok(res,{selfModel:runtime.selfModel.snapshot()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/cognition/repository/scan')return ok(res,{repository:runtime.cognition.refreshRepository({maxFiles:Number(b.maxFiles||5000),maxFileBytes:Number(b.maxFileBytes||768*1024),actor:actor(req,b)})});
  if(req.method==='GET'&&url.pathname==='/api/continuum/cognition/repository/search')return ok(res,{files:runtime.cognition.queryRepository(String(url.searchParams.get('q')||''),{limit:Number(url.searchParams.get('limit')||25)})});
  if(req.method==='GET'&&url.pathname==='/api/continuum/cognition/repository/dependencies')return ok(res,{dependencies:runtime.repository.dependencies(String(url.searchParams.get('path')||''))});
  if(req.method==='POST'&&url.pathname==='/api/continuum/cognition/outcomes/hypothesis')return ok(res,runtime.cognition.compileHypothesisOutcome({...b,actor:actor(req,b)}));
  if(req.method==='POST'&&url.pathname==='/api/continuum/cognition/outcomes')return ok(res,runtime.cognition.compileOutcome({...b,actor:actor(req,b)}));
  if(req.method==='POST'&&url.pathname==='/api/continuum/cognition/promotions/receipt')return ok(res,runtime.cognition.promoteVerifiedReceipt({...b,actor:actor(req,b)}),201);
  if(req.method==='POST'&&url.pathname==='/api/continuum/cognition/promotions/decision')return ok(res,runtime.cognition.promoteVerifiedDecision({...b,actor:actor(req,b)}),201);
  if(req.method==='POST'&&url.pathname==='/api/continuum/cognition/compression/knowledge')return ok(res,{pattern:runtime.cognition.compressKnowledge({...b,actor:actor(req,b)})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/cognition/compression/trajectories')return ok(res,{patterns:runtime.cognition.compressTrajectories({...b,actor:actor(req,b)})});
  if(req.method==='POST'&&/^\/api\/continuum\/cognition\/patterns\/[^/]+\/validate$/.test(url.pathname)){const kid=url.pathname.split('/').at(-2);return ok(res,{pattern:runtime.cognition.validatePattern(kid,{evidenceRefs:b.evidenceRefs||[]},actor(req,b))})}

  if(req.method==='GET'&&url.pathname==='/api/continuum/browser/targets')return ok(res,{targets:await runtime.browser.targets(Number(url.searchParams.get('port')||9222))});
  if(req.method==='POST'&&url.pathname==='/api/continuum/browser/attach')return ok(res,{session:await runtime.browser.attach({port:b.port,urlIncludes:b.urlIncludes,targetId:b.targetId})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/browser/detach'){await runtime.browser.detach();return ok(res,{})}
  if(req.method==='POST'&&url.pathname==='/api/continuum/browser/observe')return ok(res,await runtime.browser.observeSemantic(b));
  if(req.method==='POST'&&url.pathname==='/api/continuum/browser/batch')return ok(res,{result:await runtime.browser.executeBatch(b)});

  if(req.method==='GET'&&url.pathname==='/api/continuum/providers')return ok(res,{providers:runtime.providers.list(),policy:runtime.providers.state?.policy||null});
  if(req.method==='POST'&&url.pathname==='/api/continuum/providers')return ok(res,{provider:runtime.models.registerProvider(b,actor(req,b))},201);
  if(req.method==='PATCH'&&url.pathname==='/api/continuum/providers/policy')return ok(res,{policy:runtime.models.updateProviderPolicy(b,actor(req,b))});
  if(req.method==='GET'&&url.pathname==='/api/continuum/reviews')return ok(res,{reviews:runtime.reviews.list({status:url.searchParams.get('status'),targetAgentId:url.searchParams.get('targetAgentId'),reviewerAgentId:url.searchParams.get('reviewerAgentId')})});
  if(req.method==='GET'&&url.pathname==='/api/continuum/reviews/scores')return ok(res,{scores:runtime.reviews.scores()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/reviews')return ok(res,{review:runtime.reviews.submit(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/reviews\/[^/]+\/validate$/.test(url.pathname)){const rid=url.pathname.split('/').at(-2);return ok(res,{review:runtime.reviews.validate(rid,{validatorAgentId:b.validatorAgentId||actor(req,b),evidenceRefs:b.evidenceRefs||[],valid:b.valid!==false,fixVerified:Boolean(b.fixVerified)})})}
  if(req.method==='POST'&&url.pathname==='/api/continuum/reviews/audit-idle')return ok(res,{findings:runtime.reviews.auditIdle(String(b.reviewerAgentId||'jaco-seer'),{staleAfterMs:Number(b.staleAfterMs||120000)})});
  if(req.method==='GET'&&url.pathname==='/api/continuum/deliberations')return ok(res,{deliberations:runtime.deliberations.list()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/deliberations')return ok(res,{deliberation:runtime.deliberations.create(b,actor(req,b))},201);
  if(req.method==='GET'&&/^\/api\/continuum\/deliberations\/[^/]+$/.test(url.pathname)){const did=url.pathname.split('/').at(-1);return ok(res,{deliberation:runtime.deliberations.get(did),assessment:runtime.deliberations.assess(did),goalIntegrity:runtime.deliberations.goalIntegrity(did)})}
  if(req.method==='POST'&&/^\/api\/continuum\/deliberations\/[^/]+\/positions$/.test(url.pathname)){const did=url.pathname.split('/').at(-2);return ok(res,{position:runtime.deliberations.addPosition(did,b,actor(req,b))},201)}
  if(req.method==='POST'&&/^\/api\/continuum\/deliberations\/[^/]+\/challenges$/.test(url.pathname)){const did=url.pathname.split('/').at(-2);return ok(res,{challenge:runtime.deliberations.challenge(did,b,actor(req,b))},201)}
  if(req.method==='POST'&&/^\/api\/continuum\/deliberations\/[^/]+\/conclude$/.test(url.pathname)){const did=url.pathname.split('/').at(-2);return ok(res,{deliberation:runtime.deliberations.conclude(did,{actor:actor(req,b),claim:b.claim,evidenceRefs:b.evidenceRefs||[],forceNoConclusion:Boolean(b.forceNoConclusion)})})}
  if(req.method==='POST'&&/^\/api\/continuum\/deliberations\/[^/]+\/extend$/.test(url.pathname)){const did=url.pathname.split('/').at(-2);return ok(res,{deliberation:runtime.deliberations.extend(did,{actor:actor(req,b),reason:b.reason,additionalMs:b.additionalMs})})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/sandboxes')return ok(res,{sandboxes:runtime.sandboxes.list()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/sandboxes')return ok(res,{sandbox:runtime.sandboxes.create(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/sandboxes\/[^/]+\/write$/.test(url.pathname)){const sid=url.pathname.split('/').at(-2);return ok(res,{file:runtime.sandboxes.write(sid,b.path,b.content,actor(req,b))})}
  if(req.method==='POST'&&/^\/api\/continuum\/sandboxes\/[^/]+\/snapshot$/.test(url.pathname)){const sid=url.pathname.split('/').at(-2);return ok(res,{snapshot:runtime.sandboxes.snapshot(sid,actor(req,b))})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/risk')return ok(res,{policy:runtime.risk.policySnapshot()});
  if(req.method==='PATCH'&&url.pathname==='/api/continuum/risk/policy')return ok(res,{policy:runtime.risk.updatePolicy(b,actor(req,b))});
  if(req.method==='POST'&&/^\/api\/continuum\/risk\/agents\/[^/]+\/enforce$/.test(url.pathname)){const aid=url.pathname.split('/').at(-2);return ok(res,{result:runtime.risk.enforce(aid,{actor:actor(req,b),sourcePaths:b.sourcePaths||[]})})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/future')return ok(res,{future:runtime.future.snapshot(),aggregates:runtime.future.aggregateForecasts()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/future/observations')return ok(res,{observation:runtime.future.ingestObservation(b,actor(req,b))},201);
  if(req.method==='GET'&&url.pathname==='/api/continuum/future/forecasts')return ok(res,{forecasts:runtime.future.listForecasts()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/future/forecasts')return ok(res,{forecast:runtime.future.forecast(b,actor(req,b))},201);
  if(req.method==='PATCH'&&/^\/api\/continuum\/future\/forecasts\/[^/]+$/.test(url.pathname)){const fid=url.pathname.split('/').at(-1);return ok(res,{forecast:runtime.future.updateForecast(fid,b,actor(req,b))})}
  if(req.method==='POST'&&/^\/api\/continuum\/future\/forecasts\/[^/]+\/resolve$/.test(url.pathname)){const fid=url.pathname.split('/').at(-2);return ok(res,{forecast:runtime.future.resolve(fid,{outcome:b.outcome,evidenceRefs:b.evidenceRefs||[]},actor(req,b))})}
  if(req.method==='POST'&&url.pathname==='/api/continuum/future/scenarios')return ok(res,{scenario:runtime.future.createScenario(b,actor(req,b))},201);
  if(req.method==='POST'&&/^\/api\/continuum\/future\/scenarios\/[^/]+\/simulate$/.test(url.pathname)){const sid=url.pathname.split('/').at(-2);return ok(res,{result:runtime.future.simulate(sid,{runs:b.runs,seed:b.seed},actor(req,b))})}
  if(req.method==='GET'&&url.pathname==='/api/continuum/a2a/peers')return ok(res,{peers:runtime.a2aTrust.list()});

  if(req.method==='GET'&&url.pathname==='/api/continuum/models/local')return ok(res,{models:await runtime.models.listLocalModels()});
  if(req.method==='POST'&&url.pathname==='/api/continuum/models/reason')return ok(res,{result:await runtime.models.reason(b)});
  if(req.method==='POST'&&url.pathname==='/api/continuum/a2a/discover')return ok(res,{result:await runtime.a2a.discover(b.baseUrl,{bearerEnv:b.bearerEnv||null})});
  if(req.method==='POST'&&url.pathname==='/api/continuum/a2a/send')return ok(res,{result:await runtime.a2a.sendMessage(b)});
  if(req.method==='POST'&&url.pathname==='/api/continuum/a2a/tasks/get')return ok(res,{result:await runtime.a2a.getTask(b)});
  if(req.method==='POST'&&url.pathname==='/api/continuum/a2a/tasks/cancel')return ok(res,{result:await runtime.a2a.cancelTask(b)});
  return send(res,404,{success:false,error:{code:'NOT_FOUND',message:`No Continuum route for ${req.method} ${url.pathname}`}});
 }catch(e){return fail(res,e,/UNAVAILABLE|ECONOMIC|EMERGENCY|PAUSED|LEASE|CHECKPOINT/.test(e instanceof Error?e.message:String(e))?409:400)}
}
const server=createServer((req,res)=>void handle(req,res).catch(e=>fail(res,e,500)));server.listen(PORT,HOST,()=>console.error(`[JACO Continuum] http://${HOST}:${PORT} substrate=${substrate}`));
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>server.close(()=>process.exit(0)));
