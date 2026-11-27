import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export function createLinkStorage(pool,key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('LINK_STORAGE_KEY_REQUIRED');
  const aad=(ns,k)=>Buffer.from(JSON.stringify([ns,k]));
  const seal=(ns,k,value)=>{
    const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);
    c.setAAD(aad(ns,k));
    return Buffer.concat([iv,c.update(JSON.stringify(value),'utf8'),c.final(),c.getAuthTag()]).toString('base64url');
  };
  const unseal=(ns,k,raw)=>{
    const b=Buffer.from(raw,'base64url');
    if(b.length<28)throw Error('LINK_STORAGE_INVALID');
    const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
    d.setAAD(aad(ns,k));d.setAuthTag(b.subarray(-16));
    return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8'));
  };
  function scoped(namespace,db=pool,inTx=false){
    return {
      async get(k){
        const {rows}=await db.query('SELECT ciphertext FROM jaco_link_kv WHERE namespace=$1 AND key=$2 AND (expires_at IS NULL OR expires_at>now())',[namespace,k]);
        return rows.length?unseal(namespace,k,rows[0].ciphertext):undefined;
      },
      async put(k,v){
        const exp=namespace.startsWith('quota:')?new Date(Date.now()+7200000):null;
        await db.query('INSERT INTO jaco_link_kv(namespace,key,ciphertext,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=now(),expires_at=COALESCE(EXCLUDED.expires_at,jaco_link_kv.expires_at)',[namespace,k,seal(namespace,k,v),exp]);
      },
      async list({prefix=''}={}){
        const {rows}=await db.query('SELECT key,ciphertext FROM jaco_link_kv WHERE namespace=$1 AND left(key,length($2))=$2 AND (expires_at IS NULL OR expires_at>now()) ORDER BY key LIMIT 1001',[namespace,prefix]);
        if(rows.length>1000)throw Error('LINK_STORAGE_LIMIT');
        return new Map(rows.map(r=>[r.key,unseal(namespace,r.key,r.ciphertext)]));
      },
      async delete(k){await db.query('DELETE FROM jaco_link_kv WHERE namespace=$1 AND key=$2',[namespace,k]);},
      async deleteAll(){await db.query('DELETE FROM jaco_link_kv WHERE namespace=$1',[namespace]);},
      async setAlarm(at){await db.query('UPDATE jaco_link_kv SET expires_at=$2 WHERE namespace=$1',[namespace,new Date(at)]);},
      async transaction(fn){
        if(inTx)throw Error('LINK_NESTED_TRANSACTION');
        const client=await pool.connect();
        try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[namespace]);const result=await fn(scoped(namespace,client,true));await client.query('COMMIT');return result;}
        catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
      }
    };
  }
  return scoped;
}
export function createRpcAdmission(pool,account){
  return {
    async reserve(device,id){
      const {rowCount}=await pool.query("INSERT INTO jaco_link_rpc_admission(account_id,device_id,request_id,state) VALUES($1,$2,$3,'UNKNOWN') ON CONFLICT DO NOTHING",[account,device,id]);
      return rowCount===1;
    },
    async response(device,id,status){
      await pool.query("UPDATE jaco_link_rpc_admission SET state='RESPONDED',response_status=$4 WHERE account_id=$1 AND device_id=$2 AND request_id=$3 AND state='UNKNOWN'",[account,device,id,status]);
    }
  };
}
