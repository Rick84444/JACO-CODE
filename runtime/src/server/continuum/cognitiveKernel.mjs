import { nowIso, deepClone } from './util.mjs';

export class CognitiveKernel {
  constructor({repository,selfModel,outcomes,compressor,knowledge,graph=null}){this.repository=repository;this.selfModel=selfModel;this.outcomes=outcomes;this.compressor=compressor;this.knowledge=knowledge;this.graph=graph;}

  snapshot(){
    const repository=this.repository.snapshot();
    return deepClone({
      schema:'jaco.cognitive-kernel.v1',
      generatedAt:nowIso(),
      repository:{status:repository.status,snapshotHash:repository.snapshotHash||null,summary:repository.summary||null,updatedAt:repository.updatedAt||null},
      selfModel:this.selfModel.snapshot(),
      knowledge:{verified:this.knowledge.list({limit:1000}).filter(item=>item.verificationStatus==='VERIFIED').length,patternCandidates:this.knowledge.list({kind:'cognitive-pattern-candidate',limit:1000}).length},
      graph:{authority:this.graph?'DERIVED_READ_ONLY':'UNAVAILABLE',schema:this.graph?'jaco.cognitive-graph.projection.v1':null},
      invariants:{canonicalStoresOnly:true,selfModelIsDerived:true,outcomesRequireVerifiedEvidence:true,compressionRequiresIndependentEvidence:true,patternsRequireIndependentHoldout:true},
    });
  }

  graphSnapshot(options={}){if(!this.graph)throw new Error('COGNITIVE_GRAPH_UNAVAILABLE');return this.graph.snapshot(options);}
  graphSearch(query,options={}){if(!this.graph)throw new Error('COGNITIVE_GRAPH_UNAVAILABLE');return this.graph.search(query,options);}
  graphNeighbors(id,options={}){if(!this.graph)throw new Error('COGNITIVE_GRAPH_UNAVAILABLE');return this.graph.neighbors(id,options);}
  refreshRepository(options={}){return this.repository.scan(options);}
  queryRepository(query,options={}){return this.repository.query(query,options);}
  compileHypothesisOutcome(input){return this.outcomes.compileHypothesis(input);}
  compileOutcome(input){return this.outcomes.compileOutcome(input);}
  promoteVerifiedReceipt(input){return this.outcomes.promoteVerifiedReceipt(input);}
  promoteVerifiedDecision(input){return this.outcomes.promoteVerifiedDecision(input);}
  compressKnowledge(input){return this.compressor.compressKnowledge(input);}
  compressTrajectories(input){return this.compressor.compressTrajectories(input);}
  validatePattern(id,input={},actor='verifier'){return this.compressor.validatePattern(id,input,actor);}
}
