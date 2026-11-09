// JACO Remote: browser transport only. No secrets, plans or memory are
// stored in the cloud or in localStorage. Cloud transport is TLS, not E2EE.
const $=id=>document.getElementById(id);
const wsUrl=new URL('/link/ws?role=phone',location.href);
wsUrl.protocol=location.protocol==='https:'?'wss:':'ws:';
let socket=null,hosts=[],selected=null,online=false,busy=false,reconnectTimer=null;
const pending=new Map();
const LIMIT=80;
const views=['chat','plan','memory','decisions'];
function text(el,value){el.textContent=String(value??'');return el;}
function el(tag,css='',value=''){const n=document.createElement(tag);if(css)n.className=css;if(value!==undefined&&value!==null)n.textContent=String(value);return n;}
function show(id,on){$(id).hidden=!on;}
function error(message){const value=String(message||'');show('error',Boolean(value));text($('error'),value);}
function state(label,details){text($('state'),label);if(details!==undefined)text($('pcstate'),details);}
async function api(route,options={}){
  const response=await fetch('/link/v1'+route,{credentials:'same-origin',cache:'no-store',redirect:'error',...options});
  const result=await response.json().catch(()=>({error:'INVALID_SERVER_RESPONSE'}));
  if(!response.ok)throw Error(result.error||'HTTP_'+response.status);
  return result;
}
function wsSend(method,path,body=undefined,{timeout=95000}={}){
  if(!socket||socket.readyState!==WebSocket.OPEN||!selected)
    return Promise.reject(Error('PC_OFFLINE'));
  if(pending.size>LIMIT)return Promise.reject(Error('REMOTE_BUSY'));
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(method==='POST'?'OUTCOME_UNKNOWN_CHECK_PC':'REQUEST_TIMEOUT'));},timeout);
    pending.set(id,{resolve,reject,timer});
    try{socket.send(JSON.stringify({type:'rpc',id,target:selected,method,path,...(body!==undefined?{body}:{})}));}
    catch(cause){clearTimeout(timer);pending.delete(id);reject(cause);}
  });
}
function clearPending(){
  for(const [id,request] of pending){clearTimeout(request.timer);request.reject(Error('CONNECTION_LOST_RESULT_UNKNOWN'));pending.delete(id);}
}
async function getHosts(){
  try{
    const response=await api('/hosts');
    hosts=(response.hosts||[]).filter(h=>h?.deviceId).slice(0,30);
    const active=hosts.filter(h=>h.online);
    if(!active.some(h=>h.deviceId===selected))selected=active[0]?.deviceId||null;
    const picker=$('host');picker.replaceChildren();
    for(const h of hosts){const option=el('option','',(h.label||'Windows PC')+' · '+h.deviceId.slice(0,8)+(h.online?' · aktiv':' · offline'));option.value=h.deviceId;option.disabled=!h.online;picker.append(option);}
    picker.hidden=hosts.length<2;
    $('revoke').hidden=!selected;
    if(selected)picker.value=selected;
    show('pair',!selected);show('workspace',Boolean(selected));
    state(socket?.readyState===WebSocket.OPEN && selected?'Ansluten':selected?'Ansluter…':'Ingen dator',
      selected?'JACO-konto · '+(hosts.find(h=>h.deviceId===selected)?.label||'Windows PC'):'Öppna JACO Link på Windows för att parkoppla.');
    if(socket?.readyState===WebSocket.OPEN && selected)await refresh('chat');
  }catch(e){error('Kunde inte läsa datorer: '+e.message);}
}
function connect(){
  if(socket && [0,1].includes(socket.readyState))return;
  clearTimeout(reconnectTimer);
  socket=new WebSocket(wsUrl);
  socket.addEventListener('open',()=>{online=true;error('');void getHosts();});
  socket.addEventListener('message',event=>{
    let msg;try{msg=JSON.parse(event.data);}catch{return;}
    if(msg.type==='rpc_result'&&pending.has(msg.id)){
      const item=pending.get(msg.id);pending.delete(msg.id);clearTimeout(item.timer);
      if(msg.status>=200&&msg.status<300)item.resolve(msg.body);
      else item.reject(Error(msg.body?.error||'REMOTE_HTTP_'+msg.status));
    }else if(msg.type==='error')error('JACO Link: '+msg.error);
  });
  socket.addEventListener('close',()=>{
    online=false;state('Återansluter…','Datorns uppdrag fortsätter även om mobilen tappar kontakten.');
    clearPending();reconnectTimer=setTimeout(connect,5000);
  });
  socket.addEventListener('error',()=>{error('Anslutningen bröts. JACO försöker återansluta.');});
}
function card(title,body='',meta=''){
  const container=el('article','card');
  container.append(el('h3','',title),el('p','',body));
  if(meta)container.append(el('small','',meta));
  return container;
}
function controls(container,items){
  const row=el('div','actions');
  for(const {label,run,danger} of items){
    const button=el('button',danger?'danger':'',label);
    button.type='button';button.addEventListener('click',()=>void run());row.append(button);
  }
  container.append(row);
}
function insertMessage(role,content){
  const node=el('article','msg '+role);
  node.append(el('small','',role==='operator'?'DU':'AURA'),el('div','',content));
  $('messages').append(node);
  while($('messages').children.length>60)$('messages').firstChild.remove();
  $('messages').scrollTop=$('messages').scrollHeight;
}
async function refreshChat(){
  const data=await wsSend('GET','/api/aura/chat/session',undefined,{timeout:20000});
  const messages=Array.isArray(data.messages)?data.messages.slice(-40):[];
  $('messages').replaceChildren();
  if(!messages.length)insertMessage('aura','Aura finns på Windows-datorn. Vad vill du göra?');
  for(const row of messages) if(['user','assistant'].includes(row.role))insertMessage(row.role==='user'?'operator':'aura',row.content||'');
}
async function sendChat(){
  const question=$('question').value.trim();if(!question||busy)return;
  busy=true;$('send').disabled=true;$('question').value='';insertMessage('operator',question);
  try{
    const response=await wsSend('POST','/api/aura/chat',{
      message:question,interactionMode:'question',selectedProvider:'seer',
      connectedSession:{id:crypto.randomUUID(),source:'JACO Link Android'},
      messagesHistory:[],
      ragContext:[],
    },{timeout:120000});
    insertMessage('aura',response.reply||response.text||'Aura lämnade inget svar.');
  }catch(e){error('Meddelandet kunde inte bekräftas: '+e.message);}
  finally{busy=false;$('send').disabled=false;}
}
async function startGoal(){
  const goal=$('goal').value.trim();if(!goal||busy)return;
  if(!confirm('Starta uppdraget på din Windows-dator inom befintligt mandat?'))return;
  busy=true;$('start').disabled=true;
  try{
    const r=await wsSend('POST','/api/aura/workbench/start-goal',{
      goal,executionMode:'autonomous',toolHint:null,
    },{timeout:95000});
    const id=r.goal?.id||r.mission?.id;
    if(!id)throw Error('UPPDRAG_ETABLERADE_INTE_ID');
    $('goal').value='';error('');
    insertMessage('aura','Uppdrag registrerat på Windows: '+id);
    selectView('plan');
  }catch(e){error('Uppdraget kunde inte bekräftas. Starta inte om det utan att kontrollera spelplanen: '+e.message);}
  finally{busy=false;$('start').disabled=false;}
}
async function refreshPlan(){
  const data=await wsSend('GET','/api/aura/plan',undefined,{timeout:25000});
  const parent=$('plans');parent.replaceChildren();
  const plans=(data.plans||[]).slice(0,10);
  if(!plans.length){parent.append(card('Inga aktuella planer','Aura visar planen här när ett uppdrag skapats.'));return;}
  for(const p of plans){
    const nodes=Array.isArray(p.nodes)?p.nodes:[];
    const group=card(p.mainGoal||p.goal||p.title||'Plan','',String(p.graphId||''));
    for(const node of nodes.slice(0,25)){
      const item=card(node.title||node.objective||'Steg',node.objective||'',node.statusText||node.status||'Okänt');
      if(node.missionId){
        controls(item,[
          {label:'Ändra riktning',run:async()=>{const instruction=prompt('Instruktion till Aura för detta uppdrag:');if(!instruction?.trim())return;
            try{await wsSend('POST','/api/aura/workbench/missions/'+encodeURIComponent(node.missionId)+'/steer',{instruction:instruction.trim(),requestId:crypto.randomUUID()});await refreshPlan();}
            catch(e){error('Ändringen kunde inte bekräftas: '+e.message);}}},
          {label:'Stoppa',danger:true,run:async()=>{if(!confirm('Begär stopp av uppdrag '+node.missionId+'?'))return;
            try{await wsSend('POST','/api/aura/workbench/missions/'+encodeURIComponent(node.missionId)+'/cancel',{});await refreshPlan();}
            catch(e){error('Stoppet kunde inte bekräftas. Kontrollera Windows: '+e.message);}}}
        ]);
      }
      group.append(item);
    }parent.append(group);
  }
}
async function refreshMemory(){
  const data=await wsSend('GET','/api/aura/workbench/local-memory',undefined,{timeout:20000});
  const area=$('memories');area.replaceChildren();
  const entries=(data.entries||[]).slice(0,30);
  if(!entries.length){area.append(card('Inga registrerade minnen','Det lokala minnet saknar sparade kunskapsobjekt just nu.'));return;}
  for(const m of entries){
    const info=card(m.title||m.kind||'Kunskap',m.decisionSummary||'Ingen beslutsmotivering sparad.',
      (m.status||'UNVERIFIED')+' · '+(m.updatedAt||'okänd tid'));
    const evidence=Array.isArray(m.evidenceRefs)?m.evidenceRefs:[];
    if(evidence.length)info.append(el('small','','Evidens: '+evidence.join(', ').slice(0,800)));
    info.append(el('small','','Källa: '+m.source+' · '+m.id));area.append(info);
  }
}
async function refreshDecisions(){
  const data=await wsSend('GET','/api/aura/workbench/approvals',undefined,{timeout:20000});
  const area=$('approvals');area.replaceChildren();
  const approvals=Array.isArray(data.items)?data.items:[];
  if(!approvals.length){area.append(card('Inga väntande beslut','Aura har inte begärt något godkännande.'));return;}
  const names={approve:'Godkänn',reject:'Avvisa',resume:'Återuppta',cancel:'Avbryt',confirm:'Bekräfta'};
  for(const a of approvals.slice(0,25)){
    const latest=a.details?.latestReceipt;
    const receipt=latest ? ' · Verifierat: '+(latest.verified===true?'ja':'nej')+
      (latest.outcomeUnknown?' · Resultat osäkert':'') : '';
    const pane=card(a.title||a.id,a.reason||'Kontrollera detta beslut i Windows.',
      (a.risk||'UNKNOWN')+' · '+(a.kind||'Operatörsbeslut')+receipt);
    const choices=(Array.isArray(a.actions)?a.actions:[]).filter(action=>names[action]);
    if(choices.length)controls(pane,choices.map(action=>({
      label:names[action],danger:['reject','cancel'].includes(action),
      run:async()=>decision(a,action),
    })));
    area.append(pane);
  }
}
async function decision(a,choice){
  if(!a?.id || !Array.isArray(a.actions) || !a.actions.includes(choice))return;
  if(!confirm('Beslut: '+choice+' · '+(a.title||a.id)+' · Risk: '+(a.risk||'UNKNOWN')+'\n'+
    String(a.reason||'').slice(0,700)+'\n\nGenomför detta beslut på Windows-datorn?'))return;
  try{
    await wsSend('POST','/api/aura/workbench/approvals/'+encodeURIComponent(a.id)+'/decision',{
      decision:choice,note:'Beslut fattat av operatören i JACO Link Android',
    });error('');await refreshDecisions();
  }catch(e){error('Beslutet kunde inte bekräftas. Kontrollera Windows: '+e.message);}
}
function selectView(view){
  if(!views.includes(view))return;
  for(const v of views)show(v,v===view);
  document.querySelectorAll('[data-view]').forEach(button=>{button.setAttribute('aria-current',button.dataset.view===view?'page':'false');});
  void refresh(view).catch(e=>error('Datorns svar saknas: '+e.message));
}
async function refresh(view){
  if(!selected || socket?.readyState!==WebSocket.OPEN)return;
  if(view==='chat')return refreshChat();
  if(view==='plan')return refreshPlan();
  if(view==='memory')return refreshMemory();
  if(view==='decisions')return refreshDecisions();
}
async function initialize(){
  try{
    const me=await api('/me');
    text($('pcstate'),'Inloggad som '+me.email);
    show('login',false);connect();await getHosts();
  }catch(e){
    show('login',true);show('workspace',false);show('pair',false);
    state('Inloggning krävs','Logga in med ditt JACO-konto.');
  }
}
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>selectView(btn.dataset.view)));
$('revoke').addEventListener('click',async()=>{
  if(!selected)return;
  if(!confirm('Återkalla Windows-datorns tillgång till JACO Link? Den måste parkopplas igen.'))return;
  try{
    await api('/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:selected})});
    selected=null;error('');await getHosts();
  }catch(e){error('Återkallandet kunde inte bekräftas: '+e.message);}
});
$('retry').addEventListener('click',()=>{if(socket?.readyState!==1)connect();void getHosts();});
$('host').addEventListener('change',event=>{selected=event.target.value;void refresh('chat');});
$('send').addEventListener('click',()=>void sendChat());
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void sendChat();}});
$('start').addEventListener('click',()=>void startGoal());
window.addEventListener('online',()=>{connect();void getHosts();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){connect();void getHosts();}});
setInterval(()=>{if(document.visibilityState==='visible'&&online)void getHosts();},30000);
void initialize();
