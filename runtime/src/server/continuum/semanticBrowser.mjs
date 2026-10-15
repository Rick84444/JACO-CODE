import { nowIso, sha256, canonicalJson, deepClone } from './util.mjs';

const HIGH_CONSEQUENCE = new Set(['FINANCIAL_COMMITMENT','DELETE','PUBLISH','PERMISSION_ESCALATION','CREDENTIAL_CHANGE']);

function elementKey(el,index){return String(el.stableKey||el.automationId||el.route||`${el.controlType||'node'}:${index}`);}
function compactElement(el,index){return {id:`e_${sha256(elementKey(el,index)).slice(0,10)}`,key:elementKey(el,index),role:String(el.controlType||'').slice(0,80),name:String(el.name||'').slice(0,120),selector:String(el.route||'').slice(0,500),patterns:Array.isArray(el.patterns)?el.patterns.slice(0,12):[],automationId:String(el.automationId||'').slice(0,160)};}

export class SemanticBrowserRuntime {
  constructor({sessions,events,evidence,leases,operator}){this.sessions=sessions;this.events=events;this.evidence=evidence;this.leases=leases;this.operator=operator;this.previousByTarget=new Map();}

  async targets(port){return this.sessions.targets(port);}
  async attach(input){const snapshot=await this.sessions.attach(input);this.previousByTarget.delete(String(snapshot.urlIncludes||''));this.events.append({stream:'browser',type:'browser.continuum_attached',actor:'runtime',data:snapshot});return snapshot;}
  async detach(){await this.sessions.detach();this.previousByTarget.clear();this.events.append({stream:'browser',type:'browser.continuum_detached',actor:'runtime',data:{}});}

  async observeSemantic({label=null,maxElements=120}={}){
    const client=this.sessions.getClient();if(!client)throw new Error('BROWSER_SESSION_NOT_ATTACHED');
    const [surveyResult,observation]=await Promise.all([client.survey(label||undefined).catch(()=>null),client.observe()]);
    const survey=surveyResult||null;
    const page=(survey?.page)||observation?.page||null;const key=String(page?.url||this.sessions.snapshot().urlIncludes||'browser');
    const rawControls=Array.isArray(observation?.controls)?observation.controls:[];
    const syntheticElements=survey?[]:(rawControls.slice(0,Math.max(1,Math.min(Number(maxElements)||120,300))).map((c,i)=>{const[tag,id,,text]=(c||'').split(':');return {id:`e_${sha256(c+i).slice(0,10)}`,key:`${tag||'el'}:${i}`,role:String(tag||'unknown').slice(0,80),name:String(text||'').slice(0,120),selector:id?`#${id}`:`${tag}:nth-of-type(${i+1})`,patterns:['click'],automationId:String(id||'')};}));
    const elements=(survey?((Array.isArray(survey.actionable)?survey.actionable:[]).slice(0,Math.max(1,Math.min(Number(maxElements)||120,300))).map(compactElement)):syntheticElements);
    const warnings=[...(!survey?['SURVEY_UNAVAILABLE_OBSERVE_FALLBACK']:[]),...(survey?.budgetExhausted?['SURVEY_BUDGET_EXHAUSTED']:[]),...(survey&&!survey.semanticMatched&&survey.recognised?['SEMANTIC_DRIFT']:[])];
    const state={schema:'jaco.continuum.semantic-browser-state.v1',stateId:`bst_${sha256(canonicalJson({page,elements,fingerprint:survey?.fingerprint??null,semanticSignature:survey?.semanticSignature??null})).slice(0,20)}`,observedAt:nowIso(),page,fingerprint:survey?.fingerprint||null,semanticSignature:survey?.semanticSignature||null,recognised:Boolean(survey?.recognised),semanticMatched:Boolean(survey?.semanticMatched),reuseAvailable:Boolean(survey?.reuseAvailable),budgetExhausted:Boolean(survey?.budgetExhausted),interactiveCount:elements.length,elements,warnings,rawSummary:{bodyLength:observation?.bodyLength??null,controlsObserved:rawControls.length}};
    const previous=this.previousByTarget.get(key)||null;const delta=this.diff(previous,state);this.previousByTarget.set(key,state);
    const evidence=this.evidence.record({kind:'browser-semantic-state',claim:`Observed ${state.page?.title||state.page?.url||'browser state'}`,source:'chrome-cdp',verified:true,verificationMethod:'CDP survey + DOM observation',data:{state,delta}},'browser-runtime');
    this.events.append({stream:'browser',type:'browser.semantic_observed',entityId:state.stateId,actor:'browser-runtime',data:{url:state.page?.url,interactiveCount:state.interactiveCount,deltaSummary:delta.summary,evidenceRef:evidence.id}});
    return {state,delta,evidenceRef:evidence.id};
  }

  diff(previous,current){
    if(!previous)return {schema:'jaco.continuum.browser-delta.v1',fromStateId:null,toStateId:current.stateId,changed:true,summary:{initial:true,added:current.elements.length,removed:0,changed:0},page:{from:null,to:current.page},added:current.elements,removed:[],changedElements:[]};
    const before=new Map(previous.elements.map(e=>[e.key,e])),after=new Map(current.elements.map(e=>[e.key,e]));
    const added=[],removed=[],changedElements=[];
    for(const [key,el] of after){if(!before.has(key))added.push(el);else if(canonicalJson(before.get(key))!==canonicalJson(el))changedElements.push({before:before.get(key),after:el});}
    for(const [key,el] of before)if(!after.has(key))removed.push(el);
    const pageChanged=canonicalJson(previous.page)!==canonicalJson(current.page);return {schema:'jaco.continuum.browser-delta.v1',fromStateId:previous.stateId,toStateId:current.stateId,changed:pageChanged||added.length>0||removed.length>0||changedElements.length>0,summary:{initial:false,pageChanged,added:added.length,removed:removed.length,changed:changedElements.length},page:{from:previous.page,to:current.page},added,removed,changedElements};
  }

  recommendedBatchSize({confidence=0.5,consequence='REVERSIBLE',semanticDrift=false,unknownPage=false}={}){
    if(HIGH_CONSEQUENCE.has(consequence))return 1;if(semanticDrift||unknownPage)return 2;if(confidence>=0.95)return 40;if(confidence>=0.85)return 20;if(confidence>=0.7)return 8;return 2;
  }

  async executeBatch({leaseId,actions,confidence=0.7,stopOn=['verification_failed','refusal','page_semantic_drift'],checkpointEvery=null}={}){
    this.operator.assertExecutionAllowed();const client=this.sessions.getClient();if(!client)throw new Error('BROWSER_SESSION_NOT_ATTACHED');if(!Array.isArray(actions)||!actions.length)throw new Error('actions are required');
    const allowed=Math.min(actions.length,this.recommendedBatchSize({confidence,consequence:actions.some(a=>HIGH_CONSEQUENCE.has(a.consequence))?'PUBLISH':'REVERSIBLE'}));const receipts=[];let stopped=null;let previousSemantic=null;
    for(let i=0;i<allowed;i++){
      this.operator.assertExecutionAllowed();const item=actions[i]||{};const consequence=String(item.consequence||'REVERSIBLE');this.leases.authorize(leaseId,{action:`browser.${item.type}`,consequence});
      if(HIGH_CONSEQUENCE.has(consequence)&&item.operatorCheckpoint!==true){stopped={index:i,reason:`OPERATOR_CHECKPOINT_REQUIRED:${consequence}`};break;}
      if((consequence!=='REVERSIBLE'||['click','navigate'].includes(item.type))&&!item.postcondition&&item.requireSemanticVerification!==false){stopped={index:i,reason:'SEMANTIC_POSTCONDITION_REQUIRED'};break;}
      const receipt=await client.executeVerified(item);const ev=this.evidence.record({kind:'browser-action-receipt',claim:`Browser ${item.type} ${receipt.verified?'verified':'not verified'}`,source:'browser-hands-off',verified:Boolean(receipt.verified),verificationMethod:receipt.verification?.level||'UNVERIFIED',data:receipt},'browser-runtime');
      receipts.push({index:i,receipt,evidenceRef:ev.id});this.leases.consume(leaseId,{action:`browser.${item.type}`,consequence,verified:Boolean(receipt.verified),receiptRef:ev.id});
      if(receipt.refusal&&stopOn.includes('refusal')){stopped={index:i,reason:`REFUSAL:${receipt.refusal}`};break;}if(!receipt.verified&&stopOn.includes('verification_failed')){stopped={index:i,reason:'VERIFICATION_FAILED'};break;}
      if(checkpointEvery&&((i+1)%Number(checkpointEvery)===0)){const obs=await this.observeSemantic({label:`batch-checkpoint-${i+1}`});if(previousSemantic&&obs.delta.summary?.pageChanged&&stopOn.includes('page_semantic_drift')){stopped={index:i,reason:'PAGE_CHANGED_AT_CHECKPOINT',stateId:obs.state.stateId};break;}previousSemantic=obs.state;}
    }
    const result={schema:'jaco.continuum.browser-batch-receipt.v1',startedActions:receipts.length,requestedActions:actions.length,allowedBatchSize:allowed,completed:!stopped&&receipts.length===Math.min(actions.length,allowed),stopped,receipts,finishedAt:nowIso()};
    this.events.append({stream:'browser',type:'browser.batch_finished',actor:'browser-runtime',data:{requested:actions.length,executed:receipts.length,completed:result.completed,stopped}});return result;
  }

  status(){return {session:this.sessions.snapshot(),previousStates:this.previousByTarget.size};}
}
