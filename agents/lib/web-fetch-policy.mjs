// Operator configuration shared by the executor and durable action lease.
export function webFetchTimeoutMs(env=process.env) {
  const value=Number(env.JACO_WEB_FETCH_TIMEOUT_MS||15000);
  if(!Number.isSafeInteger(value)||value<1||value>86400000)throw new Error('WEB_FETCH_TIMEOUT_INVALID');
  return value;
}
export function actionLeaseMs(type,env=process.env) {
  return type==='web-fetch'?Math.max(300000,webFetchTimeoutMs(env)+30000):300000;
}
