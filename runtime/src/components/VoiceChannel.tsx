import React, { useCallback, useEffect, useState } from 'react';
import { Smartphone, RefreshCw, Send, Unlink, QrCode, CheckCircle2 } from 'lucide-react';

interface VoiceStatus {configured:boolean;owner:string|null;hasSession:boolean;connection:'open'|'connecting'|'closed'|string;qr:string|null;lastError:string|null;sentToday:number;dailyLimit:number;twoWay?:boolean;lastInboundAt?:string|null;replyLimit?:number}
const asError=(e:unknown)=>e instanceof Error?e.message:String(e);
const REASONS:Record<string,string>={
  VOICE_NOT_CONFIGURED:'Skriv först ditt nummer.',
  VOICE_NOT_LINKED:'WhatsApp är inte länkat. Länka med QR-koden först.',
  VOICE_DAILY_LIMIT:'Dagens gräns för meddelanden är nådd.',
  VOICE_TOO_SOON:'För tätt efter förra meddelandet. Vänta några sekunder.',
  VOICE_EMPTY:'Meddelandet var tomt.',
};
const reason=(code:string)=>REASONS[code]||code;

// The operator's own WhatsApp, linked once as a device. The agent can message that one number and nobody else.
// Every state here comes from the runtime (/api/aura/workbench/voice); nothing is assumed linked until it reports open.
export function VoiceChannel() {
  const [status,setStatus]=useState<VoiceStatus|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [number,setNumber]=useState('');
  const [qrVersion,setQrVersion]=useState(0);

  const refresh=useCallback(async()=>{
    try {
      const response=await fetch('/api/aura/workbench/voice',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(!response.ok||!data.success) throw Error(data.error||'VOICE_UNAVAILABLE');
      setStatus(data.voice);setError(null);
    } catch(e){setError(asError(e));}
  },[]);

  useEffect(()=>{void refresh();},[refresh]);
  // Poll faster while a link is being made, so the QR code and the scan show up without a manual refresh.
  const waiting=status?.connection==='connecting'||Boolean(status?.qr);
  useEffect(()=>{
    const timer=setInterval(()=>void refresh(),waiting?2000:10000);
    return ()=>clearInterval(timer);
  },[refresh,waiting]);
  useEffect(()=>{if(status?.qr)setQrVersion(v=>v+1);},[status?.qr]);

  const post=async(path:string,body?:unknown)=>{
    setBusy(true);setError(null);setNotice(null);
    try {
      const response=await fetch(`/api/aura/workbench/voice/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(30000)});
      const data=await response.json().catch(()=>({}));
      if(data.voice) setStatus(data.voice);
      if(!response.ok||!data.success) throw Error(reason(data.error||data.reason||`HTTP_${response.status}`));
      return data;
    } catch(e){setError(asError(e));return null;}
    finally{setBusy(false);}
  };

  const saveNumber=async()=>{
    const data=await post('owner',{number});
    if(data) {setNotice(`Agenten får skriva till ${data.owner} och ingen annan.`);setNumber('');}
  };
  const link=async()=>{await post('link');await refresh();};
  const test=async()=>{
    const data=await post('test');
    if(data) setNotice(data.sentVoice?'Testmeddelande med röst skickat.':`Testmeddelande skickat${data.voiceSkipped?` (utan röst: ${data.voiceSkipped})`:''}.`);
    await refresh();
  };
  const unlink=async()=>{
    if(!window.confirm('Koppla bort WhatsApp? Agenten kan inte skriva till dig förrän du länkar igen.')) return;
    await post('unlink');await refresh();
  };

  const open=status?.connection==='open';
  const label=!status?'Läser status…':open?'Länkat':status.qr?'Väntar på att QR-koden skannas':status.connection==='connecting'?'Ansluter…':status.configured?(status.hasSession?'Frånkopplat (sparad session)':'Inte länkat'):'Inte inställt';

  return <section className="p-4 space-y-4 overflow-auto h-full" aria-label="WhatsApp-kanal">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-semibold flex gap-2 items-center"><Smartphone size={17}/>WhatsApp</h2>
      <span className="text-xs rounded border border-slate-700 px-2 py-0.5" role="status" data-state={open?'open':'closed'}>{open&&<CheckCircle2 size={12} className="inline mr-1 text-emerald-400"/>}{label}</span>
      <button type="button" onClick={()=>void refresh()} className="ml-auto rounded border border-slate-700 px-2 py-1 text-xs flex gap-1 items-center" aria-label="Uppdatera status"><RefreshCw size={13}/>Uppdatera</button>
    </div>
    <p className="text-xs text-slate-400">Agenter når dig på ditt eget nummer med ett kort meddelande och ett röstmeddelande när ett uppdrag är klart eller behöver dig. Kanalen kan bara skriva till det nummer du anger. Den använder WhatsApps inofficiella webbprotokoll, så använd ett separat nummer för agenten, inte ditt vanliga konto.</p>
    {error&&<p className="border border-amber-800 rounded p-2 text-amber-300 text-xs" role="alert">{error}</p>}
    {status?.lastError&&<p className="text-xs text-amber-300">Senaste fel: {status.lastError}</p>}
    {notice&&<p className="text-xs text-emerald-300" role="status">{notice}</p>}

    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-3">
        <h3 className="text-xs font-semibold">1. Ditt nummer</h3>
        <p className="text-xs text-slate-400">Nuvarande: {status?.owner||'inget angivet'}</p>
        <label className="text-xs space-y-1 block"><span>Nummer i internationell form</span>
          <input value={number} onChange={e=>setNumber(e.target.value)} placeholder="+46701234567" inputMode="tel" maxLength={20} className="w-full rounded border border-slate-700 bg-[#0b1219] px-2 py-1.5 text-xs"/></label>
        <button type="button" disabled={busy||!number.trim()} onClick={()=>void saveNumber()} className="rounded bg-cyan-800 px-4 py-2 text-xs font-medium disabled:opacity-50">Spara nummer</button>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-3">
        <h3 className="text-xs font-semibold flex gap-2 items-center"><QrCode size={15}/>2. Länka</h3>
        {open
          ?<p className="text-xs text-emerald-300">WhatsApp är länkat. Skickade idag: {status?.sentToday??0} av {status?.dailyLimit??'–'}.</p>
          :<>
            <p className="text-xs text-slate-400">Tryck Länka, öppna WhatsApp på agentens telefon: Inställningar &gt; Länkade enheter &gt; Länka en enhet, och skanna koden.</p>
            <button type="button" disabled={busy||!status?.configured} onClick={()=>void link()} className="rounded bg-cyan-800 px-4 py-2 text-xs font-medium disabled:opacity-50">{busy?'Startar…':'Länka'}</button>
            {!status?.configured&&<p className="text-xs text-slate-500">Spara ditt nummer först.</p>}
            {status?.qr&&<img key={qrVersion} src={`/api/aura/workbench/voice/qr.svg?v=${qrVersion}`} alt="QR-kod att skanna i WhatsApp" className="w-56 h-56 rounded bg-white p-1"/>}
          </>}
      </div>
    </div>

    <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-3">
      <h3 className="text-xs font-semibold">3. Testa och hantera</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy||!open} onClick={()=>void test()} className="rounded bg-cyan-800 px-4 py-2 text-xs font-medium disabled:opacity-50 flex gap-2 items-center"><Send size={13}/>Skicka testmeddelande</button>
        <button type="button" disabled={busy||!(status?.hasSession||open)} onClick={()=>void unlink()} className="rounded border border-red-900 px-4 py-2 text-xs text-red-300 disabled:opacity-50 flex gap-2 items-center"><Unlink size={13}/>Koppla bort</button>
      </div>
      {open&&status?.twoWay&&<p className="text-xs text-slate-300">Tvåvägs: skriv till det länkade numret från ditt eget ({status.owner}), så svarar Aura med text och röst. {status.lastInboundAt?`Senast mottaget ${new Date(status.lastInboundAt).toLocaleString('sv-SE')}.`:'Inget mottaget än.'} Röstmeddelanden och samtal kan hon inte ta emot ännu.</p>}
      <p className="text-xs text-slate-500">Testet är verkligt och går ut till ditt nummer. Statusen ovan kommer från runtime, inte från denna sida.</p>
    </div>
  </section>;
}
