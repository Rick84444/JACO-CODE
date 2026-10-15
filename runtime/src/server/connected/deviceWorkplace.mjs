import crypto from 'node:crypto';

// The hub's existing Workplace remains the only log/owner. Devices get their
// own restricted sessions, never the hub's Workplace or operator credential.
export function mountDeviceWorkplace(app, registry, {baseUrl, token, fetchImpl=fetch}) {
  const root='/api/connected/device/workplace';
  const upstream = async (route, method, input, sessionToken='') => {
    const r=await fetchImpl(baseUrl.replace(/\/+$/, '')+route, {method, headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'x-jaco-session-token':sessionToken}, ...(method==='POST'?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
    return {status:r.status,data:await r.json()};
  };
  app.use(root, async (req,res) => {
    res.set('Cache-Control','no-store');
    const header=String(req.headers.authorization||'');
    const device=registry.verify(header.startsWith('Bearer ')?header.slice(7):'', 'nova');
    if (!device) return res.status(401).json({error:'DEVICE_KEY_INVALID'});
    if (!device.memoryAccess) return res.status(403).json({error:'DEVICE_MEMORY_NOT_AUTHORIZED'});
    const route=req.path;
    const allowed={'/health':'GET','/v1/register':'POST','/v1/sync':'POST','/v1/ack':'POST','/v1/events':'POST','/v1/heartbeat':'POST','/v1/session/end':'POST'};
    if (allowed[route]!==req.method) return res.status(404).json({error:'WORKPLACE_DEVICE_ROUTE_DENIED'});
    try {
      if (route==='/health') { const r=await upstream('/health','GET');return res.status(r.status).json({schema:r.data.schema,status:r.data.status}); }
      const input={...(req.body||{}),workspace:'JACO'};
      if (route==='/v1/register') {
        const card=input.agentCard;
        if (!card?.identity?.requested_name) return res.status(400).json({error:'AGENT_CARD_REQUIRED'});
        const identity=crypto.createHash('sha256').update(String(card.identity.stable_id||card.identity.requested_name)).digest('hex').slice(0,24);
        input.agentCard={...card,identity:{...card.identity,stable_id:`linked-${device.name}-${identity}`},session:{...card.session,device:device.name,environment:`device:${device.name}`}};
        const r=await upstream('/v1/linked/register','POST',input);return res.status(r.status).json(r.data);
      }
      // Check the device-bound session before forwarding any reads or mutations.
      const discovery=await upstream('/v1/agents','GET');
      if (discovery.status!==200) return res.status(503).json({error:'WORKPLACE_UNAVAILABLE'});
      const agent=discovery.data.agents?.find(a=>a.sessions?.some(s=>s.sessionId===input.sessionId));
      if (!agent || agent.card?.session?.device!==device.name) return res.status(403).json({error:'DEVICE_SESSION_MISMATCH'});
      const r=await upstream(route,'POST',input,String(req.headers['x-jaco-session-token']||''));
      return res.status(r.status).json(r.data);
    } catch { return res.status(503).json({error:'WORKPLACE_UNAVAILABLE'}); }
  });
}
