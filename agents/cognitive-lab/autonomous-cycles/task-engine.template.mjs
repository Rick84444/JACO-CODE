/** JACO development-cycle fixture. Safe, bounded simulated execution only. */
import { createHash } from 'node:crypto';
const FLAGS = /*__FEATURES__*/;
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
function receiptPayload(input) { return { id:input.id, agentId:input.agentId, missionId:input.missionId, attempts:input.attempts, status:input.status }; }
export class TaskEngine {
  constructor({ execute, state, maxCalls=25 }={}) {
    if(typeof execute !== 'function') throw new TypeError('EXECUTOR_REQUIRED');
    this.execute = execute;
    this.inFlight = new Map();
    this.calls = FLAGS.budgetPersistence ? Number(state?.calls || 0) : 0;
    this.maxCalls = maxCalls;
    this.records = new Map(FLAGS.persistence ? (state?.records || []) : []);
    this.generation = FLAGS.fencing ? Number(state?.generation || 0) : 0;
  }
  snapshot() { return { version:1, generation:this.generation, calls:this.calls, records:[...this.records] }; }
  static restore(snapshot,opts) { return new TaskEngine({...opts,state:snapshot}); }
  static verifyReceipt(receipt) {
    if(!FLAGS.receipt || !receipt || typeof receipt.digest!=='string') return false;
    const {digest, ...rest}=receipt;
    return hash(rest)===digest;
  }
  async run(job,options={}) {
    if(!FLAGS.concurrency) return this.#run(job,options);
    const scopeKey=JSON.stringify([options.agentId,options.missionId,job?.id]);
    const pending=this.inFlight.get(scopeKey);
    if(pending){
      if(pending.method!==job?.method) throw new Error('TASK_ID_COLLISION');
      return pending.promise;
    }
    const operation=this.#run(job,options);
    this.inFlight.set(scopeKey,{method:job?.method,promise:operation});
    try{return await operation}finally{this.inFlight.delete(scopeKey)}
  }
  async #run(job,{agentId,missionId,lease,signal,maxRetries=2,sleep=async()=>{}}={}) {
    if(FLAGS.validation && (!job || typeof job.id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(job.id) || !['GET','POST'].includes(job.method)))
      throw new Error('TASK_INVALID');
    if(!job || !job.id) throw new Error('TASK_MISSING_ID');
    if(FLAGS.permission && (!agentId || !missionId || !lease || lease.agentId!==agentId || lease.missionId!==missionId || lease.revoked || lease.expiresAt<=Date.now()))
      throw new Error('CAPABILITY_DENIED');
    if(FLAGS.fencing && lease) {
      if(!Number.isSafeInteger(lease.generation) || lease.generation<this.generation) throw new Error('STALE_LEASE_GENERATION');
      this.generation = Math.max(lease.generation,this.generation);
    }
    const recordKey=FLAGS.isolation ? JSON.stringify([agentId,missionId,job.id]) : job.id;
    if(FLAGS.dedupe && this.records.has(recordKey)) {
      const prior=this.records.get(recordKey);
      if(FLAGS.isolation && prior.method!==job.method) throw new Error('TASK_ID_COLLISION');
      return {...prior,replayed:true};
    }
    if(FLAGS.retry && (!Number.isSafeInteger(maxRetries) || maxRetries<0 || maxRetries>5)) throw new Error('RETRY_BUDGET_INVALID');
    const allowedRetries=FLAGS.retry && job.method==='GET' ? maxRetries : 0;
    let result;
    let attempts=0;
    for(let i=0; i<=allowedRetries; i++) {
      if(FLAGS.abort && signal?.aborted) throw new Error('TASK_ABORTED');
      if(FLAGS.budget && this.calls>=this.maxCalls) throw new Error('EXECUTION_BUDGET_EXCEEDED');
      this.calls++;attempts++;
      result=await this.execute(job, {attempt:attempts,signal});
      if(!result || typeof result.status!=='number') throw new Error('EXECUTOR_RESPONSE_INVALID');
      if(!(FLAGS.retry && job.method==='GET' && RETRYABLE.has(result.status)) || i===allowedRetries) break;
      await sleep(result.status===429 ? 1000 : Math.min(1000, 2**i*100));
      if(FLAGS.abort && signal?.aborted) throw new Error('TASK_ABORTED');
    }
    const output={id:job.id,method:job.method,status:result.status,attempts};
    if(FLAGS.receipt){const payload=receiptPayload({...output,agentId,missionId});output.receipt={...payload,digest:hash(payload)};}
    if(FLAGS.dedupe) this.records.set(recordKey, output);
    return output;
  }
}
export const implementationFeatures=FLAGS;
