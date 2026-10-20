import path from 'node:path';
import { ensureDir, nowIso } from './util.mjs';
import { ContinuumEventStore } from './eventStore.mjs';
import { OperatorControl } from './operatorControl.mjs';
import { MissionLedger } from './missionLedger.mjs';
import { CommitmentGraph } from './commitmentGraph.mjs';
import { EvidenceLedger } from './evidenceLedger.mjs';
import { EconomicGovernor } from './economicGovernor.mjs';
import { ExecutionLeaseManager } from './leaseManager.mjs';
import { RuntimeHub } from './runtimeHub.mjs';
import { KnowledgeStore } from './knowledgeStore.mjs';
import { CognitiveGraphProjection } from './cognitiveGraphProjection.mjs';
import { HypothesisEngine } from './hypothesisEngine.mjs';
import { CapabilityCompiler } from './capabilityCompiler.mjs';
import { CognitiveCompressor } from './cognitiveCompressor.mjs';
import { SemanticRepositoryModel } from './semanticRepositoryModel.mjs';
import { RuntimeSelfModel } from './runtimeSelfModel.mjs';
import { OutcomeKnowledgeCompiler } from './outcomeKnowledgeCompiler.mjs';
import { CognitiveKernel } from './cognitiveKernel.mjs';
import { CognitiveContinuityRuntime } from './cognitiveContinuityRuntime.mjs';
import { SemanticBrowserRuntime } from './semanticBrowser.mjs';
import { ProviderRegistry } from './providerRegistry.mjs';
import { ContinuumModelRouter } from './modelRouter.mjs';
import { ReviewCouncil } from './reviewCouncil.mjs';
import { DeliberationEngine } from './deliberationEngine.mjs';
import { SoftSandboxManager } from './softSandbox.mjs';
import { RiskRouter } from './riskRouter.mjs';
import { RollingFutureWindow } from './futureWindow.mjs';
import { A2ATrustRegistry } from './a2aTrustRegistry.mjs';
import { ContinuumScheduler } from './scheduler.mjs';
import { RevenueOpportunityEngine } from './revenueEngine.mjs';
import { A2AClient } from './a2aClient.mjs';
import { SkillRuntime } from '../skills/skillRuntime.mjs';

export class ContinuumRuntime {
  constructor({workspaceRoot,browserSessions}){
    this.workspaceRoot=workspaceRoot;this.root=ensureDir(path.join(workspaceRoot,'.jaco','continuum'));
    this.events=new ContinuumEventStore(path.join(this.root,'ledger'));
    this.operator=new OperatorControl(this.root,this.events);
    this.evidence=new EvidenceLedger(this.root,this.events);
    this.missions=new MissionLedger(this.root,this.events,this.evidence);
    this.commitments=new CommitmentGraph(this.root,this.events,this.evidence);
    this.economic=new EconomicGovernor(this.root,this.events,this.evidence);
    this.leases=new ExecutionLeaseManager(this.root,this.events,this.operator,this.economic);
    this.hub=new RuntimeHub(this.root,this.events,this.evidence);
    this.knowledge=new KnowledgeStore(this.root,this.events,this.evidence);
    this.hypotheses=new HypothesisEngine(this.root,this.events,this.evidence);
    this.skills=new SkillRuntime({
      workspaceRoot:this.workspaceRoot,
      evidenceValidator:(refs)=>this.evidence.assertRefs(refs,{verified:true}),
      telemetrySink:({type,trace})=>this.events.append({
        stream:'skills',
        type,
        entityId:trace?.executionId||trace?.traceId||null,
        actor:'skill-runtime',
        data:{
          irId:trace?.irId||null,
          status:trace?.status||null,
          familySignature:trace?.familySignature||null,
          metrics:trace?.metrics||{},
          evidenceRefs:trace?.evidenceRefs||[],
        },
      }),
    });
    this.capabilities=new CapabilityCompiler(this.root,this.events,this.knowledge,this.evidence);
    this.repository=new SemanticRepositoryModel({workspaceRoot:this.workspaceRoot,stateRoot:this.root,events:this.events,evidence:this.evidence});
    this.graph=new CognitiveGraphProjection({knowledge:this.knowledge,evidence:this.evidence,repository:this.repository});
    this.outcomes=new OutcomeKnowledgeCompiler({events:this.events,evidence:this.evidence,knowledge:this.knowledge,hypotheses:this.hypotheses});
    this.compressor=new CognitiveCompressor({events:this.events,knowledge:this.knowledge,capabilities:this.capabilities,evidence:this.evidence});
    this.browser=new SemanticBrowserRuntime({sessions:browserSessions,events:this.events,evidence:this.evidence,leases:this.leases,operator:this.operator});
    this.providers=new ProviderRegistry(this.root,this.events);
    this.models=new ContinuumModelRouter({events:this.events,economic:this.economic,operator:this.operator,providers:this.providers});
    this.reviews=new ReviewCouncil(this.root,this.events,this.evidence,this.hub);
    this.deliberations=new DeliberationEngine(this.root,this.events,this.evidence);
    this.sandboxes=new SoftSandboxManager(this.root,this.events,this.evidence,this.workspaceRoot,this.hub);
    this.risk=new RiskRouter(this.root,this.events,this.evidence,this.reviews,this.sandboxes,this.hub);
    this.reviews.setRiskRouter(this.risk);
    this.future=new RollingFutureWindow(this.root,this.events,this.evidence,this.reviews);
    this.a2aTrust=new A2ATrustRegistry(this.root,this.events,this.evidence,this.reviews);
    this.revenue=new RevenueOpportunityEngine(this.root,this.events,this.capabilities,this.knowledge,this.economic,this.evidence);
    this.a2a=new A2AClient(this.events,this.evidence,this.a2aTrust);
    this.scheduler=new ContinuumScheduler({root:this.root,events:this.events,operator:this.operator,hub:this.hub,missions:this.missions,commitments:this.commitments,evidence:this.evidence,browser:this.browser,models:this.models,capabilities:this.capabilities,compressor:this.compressor,reviews:this.reviews,deliberations:this.deliberations,future:this.future,sandboxes:this.sandboxes,risk:this.risk});
    this.selfModel=new RuntimeSelfModel({events:this.events,capabilities:this.capabilities,knowledge:this.knowledge,providers:this.providers,repository:this.repository,browser:this.browser,scheduler:this.scheduler,operator:this.operator});
    this.cognition=new CognitiveKernel({repository:this.repository,selfModel:this.selfModel,outcomes:this.outcomes,compressor:this.compressor,knowledge:this.knowledge,graph:this.graph});
    this.continuity=new CognitiveContinuityRuntime({events:this.events,selfModel:this.selfModel,hypotheses:this.hypotheses,knowledge:this.knowledge});
    this.startedAt=nowIso();
    this.events.append({stream:'runtime',type:'continuum.runtime_initialized',actor:'system',data:{releaseId:'jaco-code-0.22.0',workspaceRoot:this.workspaceRoot}});
  }
  status(){const eventIntegrity=this.events.verify(),missions=this.missions.list({limit:1000}),commitments=this.commitments.list(),repository=this.repository.snapshot();return {schema:'jaco.continuum.status.v2',releaseId:'jaco-code-0.22.0',version:'0.22.0',startedAt:this.startedAt,operator:this.operator.snapshot(),eventIntegrity,counts:{missions:missions.length,activeMissions:missions.filter(m=>m.state==='ACTIVE').length,commitments:commitments.length,activeCommitments:commitments.filter(c=>['ACTIVE','VERIFYING','BLOCKED'].includes(c.state)).length,agents:this.hub.listAgents().length,knowledge:this.knowledge.list({limit:1000}).length,capabilities:this.capabilities.list().length,reviews:this.reviews.list().length,deliberations:this.deliberations.list().length,sandboxes:this.sandboxes.list().filter(s=>s.status==='ACTIVE').length,a2aPeers:this.a2aTrust.list().length},economic:this.economic.snapshot(),browser:this.browser.status(),scheduler:this.scheduler.snapshot(),providers:{count:this.providers.list().length,items:this.providers.list()},repository:{status:repository.status,snapshotHash:repository.snapshotHash||null,summary:repository.summary||null,updatedAt:repository.updatedAt||null},skills:this.skills.skillMachineSnapshot({limit:20}),reviews:{scores:this.reviews.scores().slice(0,20)},future:this.future.snapshot(),risk:this.risk.policySnapshot(),revenue:{signals:this.revenue.listSignals({limit:1000}).length,opportunities:this.revenue.rank({limit:1000}).length},truth:{persistentRuntime:true,chatSessionRequired:false,providerNeutralRouting:true,forcedConclusion:false,peerReviewRewardRequiresIndependentValidation:true,softSandboxIsFilesystemIsolationNotKernelBoundary:true,futureSimulationAlwaysSynthetic:true,futureWindowDays:90,cloudReasoning:this.economic.snapshot().policy.cloudEnabled?'POLICY_ENABLED':'DEFAULT_DENY',financialCommitments:'OPERATOR_APPROVAL_REQUIRED',evidenceReferentialIntegrity:'ENFORCED_ON_CRITICAL_TRANSITIONS',semanticRepositoryModel:true,runtimeSelfModel:'DERIVED_NOT_PARALLEL_STORE',outcomeKnowledgeCompiler:true,cognitiveCompression:'HOLDOUT_GATED',cognitiveKernel:true,cognitiveContinuity:'EVENT_SOURCED_WORKING_STATE_OVER_CANONICAL_STORES',canonicalSkillRuntimeOwner:'CONTINUUM_RUNTIME'}};}
  setDurableMissionSource(source){return this.continuity.setMissionSource(source,{authority:'CONNECTED_DURABLE_NOVA'});}
  missionCapsule(id){return this.missions.capsule(id,{commitments:this.commitments.list({missionId:id}),agentState:this.hub.listAgents().filter(a=>a.currentMissionId===id),economic:this.economic.snapshot(),operator:this.operator.snapshot()});}
  pause(actor='operator',reason){const state=this.operator.pause(actor,reason);this.scheduler.suspend({actor,reason:'runtime paused'});this.leases.revokeAll(actor,'runtime paused');return state;}
  resume(actor='operator',reason){const state=this.operator.resume(actor,reason);if(this.scheduler.snapshot().enabled&&!this.scheduler.snapshot().timerActive)this.scheduler.start({actor,persist:false});return state;}
  emergencyStop(actor='operator',reason){const state=this.operator.emergencyStop(actor,reason);this.scheduler.stop({actor,reason:'emergency stop'});this.leases.revokeAll(actor,'emergency stop');return state;}
  close(){
    try { this.scheduler.stop({actor:'runtime',reason:'runtime shutdown'}); } catch {}
    try { this.leases.revokeAll('runtime','runtime shutdown'); } catch {}
    return this.events.close();
  }
}
