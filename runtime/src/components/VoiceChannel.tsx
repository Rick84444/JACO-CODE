import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useCallback, useEffect, useState } from 'react';
import { Smartphone, RefreshCw, Send, Unlink, QrCode, CheckCircle2 } from 'lucide-react';

interface VoiceStatus {configured:boolean;owner:string|null;hasSession:boolean;connection:'open'|'connecting'|'closed'|string;qr:string|null;lastError:string|null;sentToday:number;dailyLimit:number;twoWay?:boolean;lastInboundAt?:string|null;replyLimit?:number}
const asError=(e:unknown)=>e instanceof Error?e.message:String(e);
const REASONS:Record<string,string>={
  VOICE_NOT_CONFIGURED:"Enter your number first.",
  VOICE_NOT_LINKED:"WhatsApp is not linked. Link using the QR code first.",
  VOICE_DAILY_LIMIT:"The daily message limit has been reached.",
  VOICE_TOO_SOON:"Please wait a few seconds before sending another message.",
  VOICE_EMPTY:"The message was empty.",
};
const reason=(code:string)=>REASONS[code]||code;

// The operator's own WhatsApp, linked once as a device. The agent can message that one number and nobody else.
// Every state here comes from the runtime (/api/aura/workbench/voice); nothing is assumed linked until it reports open.
export function VoiceChannel() {
  const { t: uiText } = useUiLanguage();
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
    if(data) {setNotice(uiText("Messages are allowed to {0} only.", [data.owner]));setNumber('');}
  };
  const link=async()=>{await post('link');await refresh();};
  const test=async()=>{
    const data=await post('test');
    if(data) setNotice(data.sentVoice?uiText("Test message and voice note sent."):`Testmeddelande skickat${data.voiceSkipped?uiText(" (voice unavailable: {0})", [data.voiceSkipped]):''}.`);
    await refresh();
  };
  const unlink=async()=>{
    if(!window.confirm(uiText("Disconnect WhatsApp? Messages will stop until you link it again."))) return;
    await post('unlink');await refresh();
  };

  const open=status?.connection==='open';
  const label=!status?uiText("Reading status…"):open?uiText("Linked"):status.qr?uiText("Waiting for the QR code to be scanned"):status.connection==='connecting'?uiText("Connecting…"):status.configured?(status.hasSession?uiText("Disconnected (session saved)"):uiText("Not linked")):uiText("Not configured");

  return <section className="p-4 space-y-4 overflow-auto h-full" aria-label={uiText("WhatsApp channel")}>
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-semibold flex gap-2 items-center"><Smartphone size={17}/>{uiText("WhatsApp")}</h2>
      <span className="text-xs rounded border border-slate-700 px-2 py-0.5" role="status" data-state={open?'open':'closed'}>{open&&<CheckCircle2 size={12} className="inline mr-1 text-emerald-400"/>}{label}</span>
      <button type="button" onClick={()=>void refresh()} className="ml-auto rounded border border-slate-700 px-2 py-1 text-xs flex gap-1 items-center" aria-label={uiText("Refresh status")}><RefreshCw size={13}/>{uiText("Refresh")}</button>
    </div>
    <p className="text-xs text-slate-400">{uiText("Receive text and voice updates when a task finishes or needs your input. This channel can message only the number you set. It uses WhatsApp’s unofficial web protocol; use a separate account for JACO.")}</p>
    {error&&<p className="border border-amber-800 rounded p-2 text-amber-300 text-xs" role="alert">{error}</p>}
    {status?.lastError&&<p className="text-xs text-amber-300">{uiText("Latest error:")}{' '}{status.lastError}</p>}
    {notice&&<p className="text-xs text-emerald-300" role="status">{notice}</p>}

    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-3">
        <h3 className="text-xs font-semibold">{uiText("1. Your number")}</h3>
        <p className="text-xs text-slate-400">{uiText("Current:")}{' '}{status?.owner||uiText("none provided")}</p>
        <label className="text-xs space-y-1 block"><span>{uiText("Number in international format")}</span>
          <input value={number} onChange={e=>setNumber(e.target.value)} placeholder={uiText("+46701234567")} inputMode="tel" maxLength={20} className="w-full rounded border border-slate-700 bg-[#0b1219] px-2 py-1.5 text-xs"/></label>
        <button type="button" disabled={busy||!number.trim()} onClick={()=>void saveNumber()} className="rounded bg-cyan-800 px-4 py-2 text-xs font-medium disabled:opacity-50">{uiText("Save number")}</button>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-3">
        <h3 className="text-xs font-semibold flex gap-2 items-center"><QrCode size={15}/>{uiText("2. Link")}</h3>
        {open
          ?<p className="text-xs text-emerald-300">{uiText("WhatsApp linked. Sent today:")}{' '}{status?.sentToday??0} {' '}{uiText("by")}{' '}{status?.dailyLimit??'–'}.</p>
          :<>
            <p className="text-xs text-slate-400">{uiText("Select Link, then open WhatsApp on JACO’s phone: Settings > Linked devices > Link a device, and scan the code.")}</p>
            <button type="button" disabled={busy||!status?.configured} onClick={()=>void link()} className="rounded bg-cyan-800 px-4 py-2 text-xs font-medium disabled:opacity-50">{busy?uiText("Starting…"):uiText("Link")}</button>
            {!status?.configured&&<p className="text-xs text-slate-500">{uiText("Save your number first.")}</p>}
            {status?.qr&&<img key={qrVersion} src={`/api/aura/workbench/voice/qr.svg?v=${qrVersion}`} alt={uiText("QR code to scan in WhatsApp")} className="w-56 h-56 rounded bg-white p-1"/>}
          </>}
      </div>
    </div>

    <div className="rounded-lg border border-slate-800 bg-[#111a24] p-3 space-y-3">
      <h3 className="text-xs font-semibold">{uiText("3. Test and manage")}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy||!open} onClick={()=>void test()} className="rounded bg-cyan-800 px-4 py-2 text-xs font-medium disabled:opacity-50 flex gap-2 items-center"><Send size={13}/>{uiText("Send test message")}</button>
        <button type="button" disabled={busy||!(status?.hasSession||open)} onClick={()=>void unlink()} className="rounded border border-red-900 px-4 py-2 text-xs text-red-300 disabled:opacity-50 flex gap-2 items-center"><Unlink size={13}/>{uiText("Disconnect")}</button>
      </div>
      {open&&status?.twoWay&&<p className="text-xs text-slate-300">{uiText("Two-way: message the linked number from your own (")}{status.owner}{uiText("), and Aura will reply with text and voice.")}{' '}{status.lastInboundAt?`Senast mottaget ${new Date(status.lastInboundAt).toLocaleString('sv-SE')}.`:uiText("Nothing received yet.")} {' '}{uiText("Receiving voice messages and calls is not supported yet.")}</p>}
      <p className="text-xs text-slate-500">{uiText("This sends a real message to your number. Status above comes from the running system.")}</p>
    </div>
  </section>;
}
