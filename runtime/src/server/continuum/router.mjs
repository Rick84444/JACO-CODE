import express from 'express';
import { ContinuumRuntime } from './continuumRuntime.mjs';

function bodyActor(req){return String(req.get('x-jaco-model-id')||req.body?.actor||'operator').slice(0,120);}
function fail(res,error,status=400){const message=error instanceof Error?error.message:String(error);const code=/not found/i.test(message)?404:/REQUIRED|REFUSED|FORBIDDEN|NOT_ALLOWED|EXPIRED|LATCHED|PAUSED|STOPPED/.test(message)?409:status;return res.status(code).json({success:false,error:{code:message.split(':')[0],message}});}

export function createContinuumRouter({workspaceRoot,browserSessions,requireAuth}){
  const runtime=new ContinuumRuntime({workspaceRoot,browserSessions});
  const router=express.Router();router.use(requireAuth);

  router.get('/status',(_req,res)=>res.json({success:true,status:runtime.status()}));
  router.get('/events',(req,res)=>res.json({success:true,events:runtime.events.list({stream:req.query.stream||null,entityId:req.query.entityId||null,type:req.query.type||null,afterSequence:Number(req.query.afterSequence||0),limit:Number(req.query.limit||200)})}));
  router.get('/integrity',(_req,res)=>res.json({success:true,integrity:runtime.events.verify()}));

  router.post('/operator/pause',(req,res)=>{try{res.json({success:true,state:runtime.pause(bodyActor(req),req.body?.reason)})}catch(e){fail(res,e)}});
  router.post('/operator/resume',(req,res)=>{try{res.json({success:true,state:runtime.resume(bodyActor(req),req.body?.reason)})}catch(e){fail(res,e)}});
  router.post('/operator/emergency-stop',(req,res)=>{try{res.json({success:true,state:runtime.emergencyStop(bodyActor(req),req.body?.reason)})}catch(e){fail(res,e)}});
  router.post('/operator/reset-emergency',(req,res)=>{try{res.json({success:true,state:runtime.operator.resetEmergency(bodyActor(req),req.body?.reason)})}catch(e){fail(res,e)}});

  router.get('/scheduler',(_req,res)=>res.json({success:true,scheduler:runtime.scheduler.snapshot()}));
  router.post('/scheduler/start',(req,res)=>{try{res.json({success:true,scheduler:runtime.scheduler.start({actor:bodyActor(req),intervalMs:req.body?.intervalMs})})}catch(e){fail(res,e)}});
  router.post('/scheduler/stop',(req,res)=>{try{res.json({success:true,scheduler:runtime.scheduler.stop({actor:bodyActor(req),reason:req.body?.reason||'operator stop'})})}catch(e){fail(res,e)}});
  router.post('/scheduler/tick',async(req,res)=>{try{res.json({success:true,result:await runtime.scheduler.tick()})}catch(e){fail(res,e)}});

  router.get('/missions',(req,res)=>res.json({success:true,missions:runtime.missions.list({state:req.query.state||null,limit:Number(req.query.limit||200)})}));
  router.post('/missions',(req,res)=>{try{res.status(201).json({success:true,mission:runtime.missions.create(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/missions/:id',(req,res)=>{try{res.json({success:true,mission:runtime.missions.get(req.params.id),graph:runtime.commitments.graph(req.params.id)})}catch(e){fail(res,e)}});
  router.get('/missions/:id/capsule',(req,res)=>{try{res.json({success:true,capsule:runtime.missionCapsule(req.params.id)})}catch(e){fail(res,e)}});
  router.patch('/missions/:id',(req,res)=>{try{res.json({success:true,mission:runtime.missions.patch(req.params.id,req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/missions/:id/transition',(req,res)=>{try{res.json({success:true,mission:runtime.missions.transition(req.params.id,String(req.body?.state||''),{actor:bodyActor(req),reason:req.body?.reason,evidenceRefs:req.body?.evidenceRefs||[]})})}catch(e){fail(res,e)}});

  router.get('/commitments',(req,res)=>res.json({success:true,commitments:runtime.commitments.list({missionId:req.query.missionId||null,state:req.query.state||null})}));
  router.post('/commitments',(req,res)=>{try{res.status(201).json({success:true,commitment:runtime.commitments.create(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/commitments/:id/transition',(req,res)=>{try{res.json({success:true,commitment:runtime.commitments.transition(req.params.id,String(req.body?.state||''),{actor:bodyActor(req),reason:req.body?.reason,evidenceRefs:req.body?.evidenceRefs||[]})})}catch(e){fail(res,e)}});

  router.get('/evidence',(req,res)=>res.json({success:true,evidence:runtime.evidence.list({verified:req.query.verified===undefined?null:req.query.verified==='true',kind:req.query.kind||null,limit:Number(req.query.limit||200)})}));
  router.post('/evidence',(req,res)=>{try{res.status(201).json({success:true,evidence:runtime.evidence.record(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/evidence/:id/verify',(req,res)=>{try{res.json({success:true,evidence:runtime.evidence.verify(req.params.id,{method:req.body?.method,actor:bodyActor(req),data:req.body?.data})})}catch(e){fail(res,e)}});

  router.get('/leases',(req,res)=>res.json({success:true,leases:runtime.leases.list({activeOnly:req.query.active==='true'})}));
  router.post('/leases',(req,res)=>{try{res.status(201).json({success:true,lease:runtime.leases.issue(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/leases/:id/revoke',(req,res)=>{try{res.json({success:true,lease:runtime.leases.revoke(req.params.id,bodyActor(req),req.body?.reason)})}catch(e){fail(res,e)}});

  router.get('/hub/agents',(_req,res)=>res.json({success:true,agents:runtime.hub.listAgents()}));
  router.post('/hub/agents',(req,res)=>{try{res.status(201).json({success:true,agent:runtime.hub.registerAgent(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/hub/agents/:id/heartbeat',(req,res)=>{try{res.json({success:true,agent:runtime.hub.heartbeat(req.params.id,req.body||{})})}catch(e){fail(res,e)}});
  router.get('/hub/agents/:id/inbox',(req,res)=>{try{res.json({success:true,messages:runtime.hub.inbox(req.params.id,{after:req.query.after||null,limit:Number(req.query.limit||100)})})}catch(e){fail(res,e)}});
  router.post('/hub/messages',(req,res)=>{try{res.status(201).json({success:true,message:runtime.hub.sendMessage(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/hub/tasks',(req,res)=>{try{res.status(201).json({success:true,task:runtime.hub.createTask(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/hub/tasks',(req,res)=>res.json({success:true,tasks:runtime.hub.listTasks({missionId:req.query.missionId||null,status:req.query.status||null})}));
  router.get('/hub/tasks/:id',(req,res)=>{try{const task=runtime.hub.listTasks().find(t=>t.id===req.params.id);if(!task)throw new Error('task not found');res.json({success:true,task})}catch(e){fail(res,e)}});
  router.post('/hub/tasks/:id/claim',(req,res)=>{try{res.json({success:true,task:runtime.hub.claimTask(req.params.id,String(req.body?.agentId||''),String(req.body?.leaseId||''))})}catch(e){fail(res,e)}});
  router.post('/hub/tasks/:id/cancel',(req,res)=>{try{res.json({success:true,task:runtime.hub.cancelTask(req.params.id,{actor:bodyActor(req),reason:req.body?.reason})})}catch(e){fail(res,e)}});
  router.post('/hub/tasks/:id/complete',(req,res)=>{try{res.json({success:true,task:runtime.hub.completeTask(req.params.id,{agentId:req.body?.agentId,status:req.body?.status,evidenceRefs:req.body?.evidenceRefs||[]})})}catch(e){fail(res,e)}});
  router.post('/hub/tasks/:id/reconcile',(req,res)=>{try{res.json({success:true,task:runtime.hub.reconcileUnknownTask(req.params.id,{resolution:req.body?.resolution,evidenceRefs:req.body?.evidenceRefs||[],actor:bodyActor(req)})})}catch(e){fail(res,e)}});

  router.get('/economic',(_req,res)=>res.json({success:true,economic:runtime.economic.snapshot()}));
  router.patch('/economic/policy',(req,res)=>{try{res.json({success:true,economic:runtime.economic.updatePolicy(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/economic/revenue',(req,res)=>{try{res.json({success:true,economic:runtime.economic.recordRevenue(req.body||{})})}catch(e){fail(res,e)}});

  router.get('/revenue/signals',(req,res)=>res.json({success:true,signals:runtime.revenue.listSignals({verified:req.query.verified===undefined?null:req.query.verified==='true',limit:Number(req.query.limit||100)})}));
  router.post('/revenue/signals',(req,res)=>{try{res.status(201).json({success:true,signal:runtime.revenue.recordSignal(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/revenue/opportunities',(req,res)=>res.json({success:true,opportunities:runtime.revenue.rank({verifiedSignalsOnly:req.query.verifiedSignalsOnly==='true',limit:Number(req.query.limit||50)})}));
  router.post('/revenue/opportunities',(req,res)=>{try{res.status(201).json({success:true,opportunity:runtime.revenue.createOpportunity(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/revenue/opportunities/:id/status',(req,res)=>{try{res.json({success:true,opportunity:runtime.revenue.mark(req.params.id,String(req.body?.status||''),{actor:bodyActor(req),evidenceRefs:req.body?.evidenceRefs||[]})})}catch(e){fail(res,e)}});

  router.post('/a2a/discover',async(req,res)=>{try{res.json({success:true,result:await runtime.a2a.discover(req.body?.baseUrl,{bearerEnv:req.body?.bearerEnv||null})})}catch(e){fail(res,e,503)}});
  router.post('/a2a/send',async(req,res)=>{try{res.json({success:true,result:await runtime.a2a.sendMessage(req.body||{})})}catch(e){fail(res,e,503)}});
  router.post('/a2a/tasks/get',async(req,res)=>{try{res.json({success:true,result:await runtime.a2a.getTask(req.body||{})})}catch(e){fail(res,e,503)}});
  router.post('/a2a/tasks/cancel',async(req,res)=>{try{res.json({success:true,result:await runtime.a2a.cancelTask(req.body||{})})}catch(e){fail(res,e,503)}});

  router.get('/knowledge',(req,res)=>{try{const q=String(req.query.q||'');res.json({success:true,knowledge:q?runtime.knowledge.search(q,{limit:Number(req.query.limit||20),includeInactive:req.query.includeInactive==='true'}):runtime.knowledge.list({kind:req.query.kind||null,minConfidence:Number(req.query.minConfidence||0),reusable:req.query.reusable===undefined?null:req.query.reusable==='true',limit:Number(req.query.limit||200)})})}catch(e){fail(res,e)}});
  router.post('/knowledge',(req,res)=>{try{res.status(201).json({success:true,knowledge:runtime.knowledge.put(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/knowledge/:id/status',(req,res)=>{try{res.json({success:true,knowledge:runtime.knowledge.setStatus(req.params.id,String(req.body?.status||''),{reason:req.body?.reason,evidenceRefs:req.body?.evidenceRefs||[]},bodyActor(req))})}catch(e){fail(res,e)}});

  router.post('/hypotheses',(req,res)=>{try{res.status(201).json({success:true,set:runtime.hypotheses.createSet(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/hypotheses',(req,res)=>res.json({success:true,sets:runtime.hypotheses.list()}));
  router.post('/hypotheses/:id/candidates',(req,res)=>{try{res.status(201).json({success:true,candidate:runtime.hypotheses.addCandidate(req.params.id,req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/hypotheses/:id/candidates/:candidateId/evaluate',(req,res)=>{try{res.json({success:true,candidate:runtime.hypotheses.evaluate(req.params.id,req.params.candidateId,req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/hypotheses/:id/select',(req,res)=>{try{res.json({success:true,set:runtime.hypotheses.selectWinner(req.params.id,req.body?.candidateId||null,bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/hypotheses/:id/rank',(req,res)=>{try{res.json({success:true,ranking:runtime.hypotheses.rank(req.params.id)})}catch(e){fail(res,e)}});

  router.post('/capabilities/trajectories',(req,res)=>{try{res.status(201).json({success:true,trajectory:runtime.capabilities.recordTrajectory(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/capabilities',(_req,res)=>res.json({success:true,capabilities:runtime.capabilities.list()}));
  router.post('/capabilities/compile',(req,res)=>{try{res.json({success:true,...runtime.capabilities.compile(String(req.body?.workflowKey||''),{minimumVerifiedSuccesses:Number(req.body?.minimumVerifiedSuccesses||3)},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/capabilities/:id/promote',(req,res)=>{try{res.json({success:true,capability:runtime.capabilities.promote(req.params.id,{evidenceRefs:req.body?.evidenceRefs||[]},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/compression/trajectories',(req,res)=>{try{res.json({success:true,knowledge:runtime.compressor.compressTrajectories({workflowKey:req.body?.workflowKey,minimum:Number(req.body?.minimum||5)})})}catch(e){fail(res,e)}});

  router.get('/cognition/graph',(req,res)=>{try{res.json({success:true,graph:runtime.cognition.graphSnapshot({limit:Number(req.query.limit||200),includeInactive:req.query.includeInactive==='true'})})}catch(e){fail(res,e)}});
  router.get('/cognition/graph/search',(req,res)=>{try{res.json({success:true,result:runtime.cognition.graphSearch(String(req.query.q||''),{limit:Number(req.query.limit||20),includeInactive:req.query.includeInactive==='true'})})}catch(e){fail(res,e)}});
  router.get('/cognition/graph/neighbors',(req,res)=>{try{res.json({success:true,result:runtime.cognition.graphNeighbors(String(req.query.id||''),{depth:Number(req.query.depth||1),limit:Number(req.query.limit||100),includeInactive:req.query.includeInactive==='true'})})}catch(e){fail(res,e)}});
  router.get('/cognition',(_req,res)=>{try{res.json({success:true,cognition:runtime.cognition.snapshot()})}catch(e){fail(res,e)}});
  router.get('/cognition/self-model',(_req,res)=>{try{res.json({success:true,selfModel:runtime.selfModel.snapshot()})}catch(e){fail(res,e)}});
  router.get('/continuity',(_req,res)=>{try{res.json({success:true,continuity:runtime.continuity.snapshot()})}catch(e){fail(res,e)}});
  router.get('/continuity/model-envelope',(_req,res)=>{try{res.json({success:true,envelope:runtime.continuity.modelEnvelope()})}catch(e){fail(res,e)}});
  router.patch('/continuity/state',(req,res)=>{try{res.json({success:true,state:runtime.continuity.applyDelta(req.body||{},bodyActor(req)),envelope:runtime.continuity.modelEnvelope()})}catch(e){fail(res,e)}});
  router.get('/continuity/checkpoints',(req,res)=>{try{res.json({success:true,checkpoints:runtime.continuity.listCheckpoints(Number(req.query.limit||20))})}catch(e){fail(res,e)}});
  router.post('/continuity/checkpoints',(req,res)=>{try{res.status(201).json({success:true,checkpoint:runtime.continuity.checkpoint(req.body?.label||'checkpoint',bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/continuity/checkpoints/:id/restore',(req,res)=>{try{res.json({success:true,state:runtime.continuity.restoreCheckpoint(req.params.id,bodyActor(req)),envelope:runtime.continuity.modelEnvelope()})}catch(e){fail(res,e)}});
  router.post('/cognition/repository/scan',(req,res)=>{try{res.json({success:true,repository:runtime.cognition.refreshRepository({maxFiles:Number(req.body?.maxFiles||5000),maxFileBytes:Number(req.body?.maxFileBytes||768*1024),actor:bodyActor(req)})})}catch(e){fail(res,e)}});
  router.get('/cognition/repository/search',(req,res)=>{try{res.json({success:true,files:runtime.cognition.queryRepository(String(req.query.q||''),{limit:Number(req.query.limit||25)})})}catch(e){fail(res,e)}});
  router.get('/cognition/repository/dependencies',(req,res)=>{try{res.json({success:true,dependencies:runtime.repository.dependencies(String(req.query.path||''))})}catch(e){fail(res,e)}});
  router.post('/cognition/outcomes/hypothesis',(req,res)=>{try{res.json({success:true,...runtime.cognition.compileHypothesisOutcome({...req.body,actor:bodyActor(req)})})}catch(e){fail(res,e)}});
  router.post('/cognition/outcomes',(req,res)=>{try{res.json({success:true,...runtime.cognition.compileOutcome({...req.body,actor:bodyActor(req)})})}catch(e){fail(res,e)}});
  router.post('/cognition/promotions/receipt',(req,res)=>{try{res.status(201).json({success:true,...runtime.cognition.promoteVerifiedReceipt({...req.body,actor:bodyActor(req)})})}catch(e){fail(res,e)}});
  router.post('/cognition/promotions/decision',(req,res)=>{try{res.status(201).json({success:true,...runtime.cognition.promoteVerifiedDecision({...req.body,actor:bodyActor(req)})})}catch(e){fail(res,e)}});
  router.post('/cognition/compression/knowledge',(req,res)=>{try{res.json({success:true,pattern:runtime.cognition.compressKnowledge({...req.body,actor:bodyActor(req)})})}catch(e){fail(res,e)}});
  router.post('/cognition/compression/trajectories',(req,res)=>{try{res.json({success:true,patterns:runtime.cognition.compressTrajectories({...req.body,actor:bodyActor(req)})})}catch(e){fail(res,e)}});
  router.post('/cognition/patterns/:id/validate',(req,res)=>{try{res.json({success:true,pattern:runtime.cognition.validatePattern(req.params.id,{evidenceRefs:req.body?.evidenceRefs||[]},bodyActor(req))})}catch(e){fail(res,e)}});

  router.get('/browser/targets',async(req,res)=>{try{res.json({success:true,targets:await runtime.browser.targets(Number(req.query.port||9222))})}catch(e){fail(res,e,503)}});
  router.post('/browser/attach',async(req,res)=>{try{res.json({success:true,session:await runtime.browser.attach({port:req.body?.port,urlIncludes:req.body?.urlIncludes})})}catch(e){fail(res,e,503)}});
  router.post('/browser/detach',async(_req,res)=>{try{await runtime.browser.detach();res.json({success:true})}catch(e){fail(res,e)}});
  router.post('/browser/observe',async(req,res)=>{try{res.json({success:true,...await runtime.browser.observeSemantic(req.body||{})})}catch(e){fail(res,e,503)}});
  router.post('/browser/batch',async(req,res)=>{try{res.json({success:true,result:await runtime.browser.executeBatch(req.body||{})})}catch(e){fail(res,e,409)}});

  router.get('/providers',(_req,res)=>res.json({success:true,providers:runtime.providers.list(),policy:runtime.providers.state?.policy||null}));
  router.post('/providers',(req,res)=>{try{res.status(201).json({success:true,provider:runtime.models.registerProvider(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.patch('/providers/policy',(req,res)=>{try{res.json({success:true,policy:runtime.models.updateProviderPolicy(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  // Reasoning goes through the router so every cloud call passes the economic gate and lands in the
  // event log. Planners and other callers must never talk to a provider directly.
  router.post('/models/reason',async(req,res)=>{try{res.json({success:true,result:await runtime.models.reason(req.body||{})})}catch(e){fail(res,e)}});

  router.get('/reviews',(req,res)=>res.json({success:true,reviews:runtime.reviews.list({status:req.query.status||null,targetAgentId:req.query.targetAgentId||null,reviewerAgentId:req.query.reviewerAgentId||null})}));
  router.get('/reviews/scores',(_req,res)=>res.json({success:true,scores:runtime.reviews.scores()}));
  router.post('/reviews',(req,res)=>{try{res.status(201).json({success:true,review:runtime.reviews.submit(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/reviews/:id/validate',(req,res)=>{try{res.json({success:true,review:runtime.reviews.validate(req.params.id,{validatorAgentId:req.body?.validatorAgentId||bodyActor(req),evidenceRefs:req.body?.evidenceRefs||[],valid:req.body?.valid!==false,fixVerified:Boolean(req.body?.fixVerified)})})}catch(e){fail(res,e)}});
  router.post('/reviews/audit-idle',(req,res)=>{try{res.json({success:true,findings:runtime.reviews.auditIdle(String(req.body?.reviewerAgentId||'jaco-seer'),{staleAfterMs:Number(req.body?.staleAfterMs||120000)})})}catch(e){fail(res,e)}});

  router.get('/deliberations',(_req,res)=>res.json({success:true,deliberations:runtime.deliberations.list()}));
  router.post('/deliberations',(req,res)=>{try{res.status(201).json({success:true,deliberation:runtime.deliberations.create(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/deliberations/:id',(req,res)=>{try{res.json({success:true,deliberation:runtime.deliberations.get(req.params.id),assessment:runtime.deliberations.assess(req.params.id),goalIntegrity:runtime.deliberations.goalIntegrity(req.params.id)})}catch(e){fail(res,e)}});
  router.post('/deliberations/:id/positions',(req,res)=>{try{res.status(201).json({success:true,position:runtime.deliberations.addPosition(req.params.id,req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/deliberations/:id/challenges',(req,res)=>{try{res.status(201).json({success:true,challenge:runtime.deliberations.challenge(req.params.id,req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/deliberations/:id/conclude',(req,res)=>{try{res.json({success:true,deliberation:runtime.deliberations.conclude(req.params.id,{actor:bodyActor(req),claim:req.body?.claim,evidenceRefs:req.body?.evidenceRefs||[],forceNoConclusion:Boolean(req.body?.forceNoConclusion)})})}catch(e){fail(res,e)}});
  router.post('/deliberations/:id/extend',(req,res)=>{try{res.json({success:true,deliberation:runtime.deliberations.extend(req.params.id,{actor:bodyActor(req),reason:req.body?.reason,additionalMs:req.body?.additionalMs})})}catch(e){fail(res,e)}});

  router.get('/sandboxes',(_req,res)=>res.json({success:true,sandboxes:runtime.sandboxes.list()}));
  router.post('/sandboxes',(req,res)=>{try{res.status(201).json({success:true,sandbox:runtime.sandboxes.create(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/sandboxes/:id',(req,res)=>{try{res.json({success:true,sandbox:runtime.sandboxes.get(req.params.id),diff:runtime.sandboxes.diff(req.params.id)})}catch(e){fail(res,e)}});
  router.post('/sandboxes/:id/write',(req,res)=>{try{res.json({success:true,file:runtime.sandboxes.write(req.params.id,req.body?.path,req.body?.content,bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/sandboxes/:id/snapshot',(req,res)=>{try{res.json({success:true,snapshot:runtime.sandboxes.snapshot(req.params.id,bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/sandboxes/:id/close',(req,res)=>{try{res.json({success:true,sandbox:runtime.sandboxes.close(req.params.id,{actor:bodyActor(req),reason:req.body?.reason})})}catch(e){fail(res,e)}});
  router.get('/risk',(_req,res)=>res.json({success:true,policy:runtime.risk.policySnapshot()}));
  router.patch('/risk/policy',(req,res)=>{try{res.json({success:true,policy:runtime.risk.updatePolicy(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/risk/agents/:id/enforce',(req,res)=>{try{res.json({success:true,result:runtime.risk.enforce(req.params.id,{actor:bodyActor(req),sourcePaths:req.body?.sourcePaths||[]})})}catch(e){fail(res,e)}});

  router.get('/future',(_req,res)=>res.json({success:true,future:runtime.future.snapshot(),aggregates:runtime.future.aggregateForecasts()}));
  router.post('/future/observations',(req,res)=>{try{res.status(201).json({success:true,observation:runtime.future.ingestObservation(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/future/forecasts',(_req,res)=>res.json({success:true,forecasts:runtime.future.listForecasts()}));
  router.post('/future/forecasts',(req,res)=>{try{res.status(201).json({success:true,forecast:runtime.future.forecast(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.patch('/future/forecasts/:id',(req,res)=>{try{res.json({success:true,forecast:runtime.future.updateForecast(req.params.id,req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/future/forecasts/:id/resolve',(req,res)=>{try{res.json({success:true,forecast:runtime.future.resolve(req.params.id,{outcome:req.body?.outcome,evidenceRefs:req.body?.evidenceRefs||[]},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/future/scenarios',(_req,res)=>res.json({success:true,scenarios:runtime.future.listScenarios()}));
  router.post('/future/scenarios',(req,res)=>{try{res.status(201).json({success:true,scenario:runtime.future.createScenario(req.body||{},bodyActor(req))})}catch(e){fail(res,e)}});
  router.post('/future/scenarios/:id/simulate',(req,res)=>{try{res.json({success:true,result:runtime.future.simulate(req.params.id,{runs:req.body?.runs,seed:req.body?.seed},bodyActor(req))})}catch(e){fail(res,e)}});
  router.get('/future/calibration',(req,res)=>res.json({success:true,calibration:runtime.future.calibration(req.query.agentId||null)}));

  router.get('/a2a/peers',(_req,res)=>res.json({success:true,peers:runtime.a2aTrust.list()}));
  router.get('/a2a/peers/match',(req,res)=>res.json({success:true,peers:runtime.a2aTrust.match({skillId:req.query.skillId||null,tags:String(req.query.tags||'').split(',').filter(Boolean),minimumTrust:Number(req.query.minimumTrust||0)})}));
  router.post('/a2a/peers/:id/trust',(req,res)=>{try{res.json({success:true,peer:runtime.a2aTrust.setOperatorTrust(req.params.id,req.body?.value,bodyActor(req))})}catch(e){fail(res,e)}});

  router.post('/models/reason',async(req,res)=>{try{res.json({success:true,result:await runtime.models.reason(req.body||{})})}catch(e){fail(res,e,503)}});
  router.get('/models/local',async(_req,res)=>{try{res.json({success:true,models:await runtime.models.listLocalModels()})}catch(e){fail(res,e,503)}});

  return {router,runtime};
}
