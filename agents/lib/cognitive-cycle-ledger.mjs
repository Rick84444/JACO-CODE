/** Shared, read-only Cognitive Cycle journal verifier. Hash chains are not an external trust anchor. */
import { createHash } from 'node:crypto';
export const CYCLE_ZERO_HASH='0'.repeat(64);
export function hashCycleEvent(event){
 if(!event||typeof event!=='object'||Array.isArray(event))throw Error('CYCLE_EVENT_INVALID');
 const {hash:_ignored,...unsigned}=event;
 return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
}
export function parseCycleLedger(input,{maxBytes=20_000_000,maxEvents=20_000,integrityError='CYCLE_LEDGER_TAMPERED'}={}){
 if(typeof input!=='string'||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxEvents)||maxEvents<1)throw Error('CYCLE_LEDGER_INPUT_INVALID');
 if(Buffer.byteLength(input,'utf8')>maxBytes)throw Error('CYCLE_LEDGER_TOO_LARGE');
 if(input&&!input.endsWith('\n'))throw Error('CYCLE_LEDGER_INCOMPLETE');
 let previous=CYCLE_ZERO_HASH;const events=[];
 for(const line of input.split('\n')){
  if(!line)continue;
  if(events.length>=maxEvents)throw Error('CYCLE_LEDGER_TOO_LARGE');
  let event;try{event=JSON.parse(line)}catch{throw Error(`${integrityError}:${events.length+1}`)}
  if(!event||typeof event!=='object'||Array.isArray(event)||
     event.schema!=='jaco.autonomous-cycle-event/v1'||!Number.isSafeInteger(event.seq)||
     event.seq!==events.length+1||event.prev!==previous||typeof event.hash!=='string'||
     !/^[0-9a-f]{64}$/.test(event.hash)||typeof event.at!=='string'||
     typeof event.type!=='string'||typeof event.role!=='string'||
     !event.data||typeof event.data!=='object'||Array.isArray(event.data)||
     hashCycleEvent(event)!==event.hash)throw Error(`${integrityError}:${events.length+1}`);
  previous=event.hash;events.push(event);
 }
 return events;
}
