import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContinuumEventStore } from '../../src/server/continuum/eventStore.mjs';
import { EvidenceLedger } from '../../src/server/continuum/evidenceLedger.mjs';
import { HypothesisEngine } from '../../src/server/continuum/hypothesisEngine.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-hypothesis-terminal-evidence-'));

try {
  const events=new ContinuumEventStore(path.join(root,'ledger'));
  const evidence=new EvidenceLedger(root,events);
  const hypotheses=new HypothesisEngine(root,events,evidence);

  const pending=evidence.record({kind:'observation',claim:'preliminary signal only'});
  const terminal=evidence.record({kind:'experiment',claim:'verified contradiction',verified:true,verificationMethod:'test'});
  const falsificationSet=hypotheses.createSet({problem:'Can verified terminal evidence supersede preliminary evidence?',criteria:[{name:'success',weight:1,direction:'max'}]});
  const rejected=hypotheses.addCandidate(falsificationSet.id,{label:'candidate with preliminary evidence'});
  hypotheses.evaluate(falsificationSet.id,rejected.id,{status:'EVALUATED',evidenceRefs:[pending.id],metrics:{success:0.8}});
  const falsified=hypotheses.evaluate(falsificationSet.id,rejected.id,{status:'FALSIFIED',reason:'verified experiment contradicted the hypothesis',evidenceRefs:[terminal.id],metrics:{success:0}});
  assert.equal(falsified.status,'FALSIFIED');
  assert.deepEqual(falsified.terminalEvidenceRefs,[terminal.id]);
  assert.deepEqual(new Set(falsified.evidenceRefs),new Set([pending.id,terminal.id]));
  assert.equal(hypotheses.rank(falsificationSet.id).length,0);
  assert.throws(()=>hypotheses.selectWinner(falsificationSet.id,rejected.id),/not eligible/);

  const pendingForWinner=evidence.record({kind:'observation',claim:'early unverified support'});
  const winnerProof=evidence.record({kind:'experiment',claim:'verified success',verified:true,verificationMethod:'test'});
  const selectionSet=hypotheses.createSet({problem:'Can a verified terminal evaluation be selected with unverified provenance retained?',criteria:[{name:'success',weight:1,direction:'max'}]});
  const winner=hypotheses.addCandidate(selectionSet.id,{label:'eventual winner'});
  hypotheses.evaluate(selectionSet.id,winner.id,{status:'EVALUATED',evidenceRefs:[pendingForWinner.id],metrics:{success:0.6}});
  const verified=hypotheses.evaluate(selectionSet.id,winner.id,{status:'VERIFIED',evidenceRefs:[winnerProof.id],metrics:{success:0.95}});
  assert.deepEqual(verified.terminalEvidenceRefs,[winnerProof.id]);
  assert.deepEqual(new Set(verified.evidenceRefs),new Set([pendingForWinner.id,winnerProof.id]));
  const selected=hypotheses.selectWinner(selectionSet.id,winner.id);
  assert.equal(selected.winnerId,winner.id);
  assert.equal(selected.status,'SELECTED');

  const recovered=new HypothesisEngine(root,events,evidence);
  assert.deepEqual(recovered.get(falsificationSet.id).candidates[0].terminalEvidenceRefs,[terminal.id]);
  assert.deepEqual(recovered.get(selectionSet.id).candidates[0].terminalEvidenceRefs,[winnerProof.id]);

  console.log('HYPOTHESIS_TERMINAL_EVIDENCE: PASS');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
