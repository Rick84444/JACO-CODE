import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGameboardExchange } from '../../agents/lib/gameboard-exchange.mjs';

test('two agents exchange structured observations and proposals over one durable revision chain', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const x = createGameboardExchange(db);
    const a={eventId:'obs-1',scope:'mission:a',actorId:'agent:investigator',expectedRevision:0,kind:'OBSERVATION',statement:'CDP reachable',evidenceRefs:[]};
    const first=x.publish(a);
    assert.equal(first.revision,1);
    const b={eventId:'proposal-1',scope:'mission:a',actorId:'agent:executor',expectedRevision:1,kind:'MOVE_PROPOSAL',statement:'probe browser capabilities',target:'mcp:cdp:probe',evidenceRefs:[],metrics:{goalImpact:0.8,informationGain:0.9,verificationGain:0.6,confidence:0.7,risk:0.1,effort:0.2}};
    const second=x.publish(b);
    assert.equal(second.revision,2);
    assert.equal(second.entries.length,2);
    assert.equal(second.entries[0].evidenceStatus,'UNVERIFIED_CLAIM');
    assert.notEqual(second.entries[0].actorNumericId,second.entries[1].actorNumericId);
    assert.equal(x.publish(a).replay,true);
    assert.throws(()=>x.publish({...a,statement:'different'}),/REPLAY_CONFLICT/);
    assert.throws(()=>x.publish({...b,eventId:'proposal-2'}),/STALE_REVISION/);
    const reopened=createGameboardExchange(db);
    assert.equal(reopened.position('mission:a').revision,2);
    assert.equal(reopened.position('mission:a').entries[1].target,'mcp:cdp:probe');
  } finally {db.close();}
});
test('contradictory claims remain separate and are never silently promoted to truth',()=>{
  const db = new DatabaseSync(':memory:');try {
    const x=createGameboardExchange(db);
    x.publish({scope:'global',eventId:'a',actorId:'research',kind:'HYPOTHESIS',expectedRevision:0,statement:'server up'});
    x.publish({scope:'global',eventId:'b',actorId:'verifier',kind:'HYPOTHESIS',expectedRevision:1,statement:'server down'});
    const entries=x.position().entries;
    assert.equal(entries.length,2);
    assert.ok(entries.every(v=>v.evidenceStatus==='UNVERIFIED_CLAIM'));
  }finally{db.close();}
});
test('rejects missing metrics and forbidden message kinds',()=>{
  const db=new DatabaseSync(':memory:');try {
    const x=createGameboardExchange(db);
    assert.throws(()=>x.publish({scope:'global',eventId:'x',actorId:'agent',kind:'EXECUTE',expectedRevision:0,statement:'run'}),/KIND_DENIED/);
    assert.throws(()=>x.publish({scope:'global',eventId:'x',actorId:'agent',kind:'MOVE_PROPOSAL',expectedRevision:0,target:'tool',statement:'run',metrics:{confidence:0.7}}),/METRIC_INVALID/);
    assert.equal(x.position().revision,0);
  }finally{db.close();}
});
