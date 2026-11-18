import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';
import { sampleLightField, projectLightPoint } from '../lib/auraLightField.mjs';

// MediaPipe canonical face model, Apache-2.0; byte-identical to upstream
// 727e43fcb7c7477f3fdf88c0498588349baaf2e5. See public/branding/mediapipe-license.txt.
const meshUrl = new URL('../assets/aura-face.obj', import.meta.url).href;
type Vertex = { x: number; y: number; z: number };
type Triangle = [number, number, number];

async function loadLightMask(signal: AbortSignal) {
  const response = await fetch(meshUrl, { signal });
  if (!response.ok) throw new Error('AURA_FACE_ASSET_UNAVAILABLE');
  const vertices: Vertex[] = [];
  const triangles: Triangle[] = [];
  for (const line of (await response.text()).split('\n')) {
    const [kind, ...values] = line.trim().split(/\s+/);
    if (kind === 'v') {
      if (values.length !== 3 || values.some(v => !Number.isFinite(Number(v)))) throw new Error('AURA_FACE_VERTEX_INVALID');
      const [a,b,c] = values.map(Number);
      vertices.push({x:a/9,y:(.65-b)/9,z:(c-3)/9});
    }
    if (kind === 'f') {
      if (values.length !== 3) throw new Error('AURA_FACE_TRIANGLE_INVALID');
      triangles.push(values.map(v=>Number(v.split('/')[0])-1) as Triangle);
    }
  }
  if (vertices.length !== 468 || triangles.length !== 898 ||
      triangles.some(face => new Set(face).size !== 3 || face.some(i => !Number.isInteger(i) || !vertices[i]))) {
    throw new Error('AURA_FACE_ASSET_INVALID');
  }
  return { vertices, triangles };
}

export interface AuraPortraitChat {
  input: string;
  setInput: (update: (previous: string) => string) => void;
  messages: { id: string; role: string; content: string }[];
  busy: string | null;
  storageReady: boolean;
  storageError: string | null;
}

interface Dictation {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  abort(): void;
}

export default function AuraPortrait({ tone, label, chat, onClose }: {
  tone: string;
  label: string;
  chat?: AuraPortraitChat;
  onClose: () => void;
}) {
  const { tr, language } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dictation = useRef<Dictation | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const [listening, setListening] = useState(false);
  const [readReplies, setReadReplies] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const [maskError, setMaskError] = useState(false);
  const [lightMask,setLightMask] = useState<Awaited<ReturnType<typeof loadLightMask>> | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const latestReply = chat?.messages.filter(message => message.role === 'assistant' && message.content.trim()).at(-1);
  const lastRead = useRef(latestReply?.id);
  const active = tone === 'active' || speaking;
  const activity = useRef(0);
  const renderStill = useRef<()=>void>(()=>{});
  useEffect(()=>{
    activity.current=active ? 1 : listening ? .55 : 0;
    renderStill.current();
  },[active,listening]);
  const locale = language === 'sv' ? 'sv-SE' : 'en-US';
  const speechWindow = window as Window & {
    SpeechRecognition?: new () => Dictation;
    webkitSpeechRecognition?: new () => Dictation;
  };
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  const synthesis = window.speechSynthesis;

  // Speech is opt-in and belongs to this presentation only. Revoke pending
  // callbacks before stopping browser engines, which may emit delayed events.
  useEffect(() => {
    const stop = () => {
      const recording = dictation.current;
      const reply = utterance.current;
      dictation.current = null;
      utterance.current = null;
      try { recording?.abort(); } catch { /* Browser engine already ended. */ }
      if (reply) { try { synthesis?.cancel(); } catch { /* Engine unavailable. */ } }
    };
    const onVisibility = () => {
      if (!document.hidden) return;
      stop();
      setListening(false);
      setSpeaking(false);
      setReadReplies(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [synthesis]);

  useEffect(() => {
    if (!latestReply || lastRead.current === latestReply.id) return;
    lastRead.current = latestReply.id;
    // Never play into an open microphone, read restored history or start audio
    // in a hidden tab. This optional reader is not the planned neural voice.
    if (!readReplies || !synthesis || !chat?.storageReady || document.hidden || dictation.current) return;
    if (utterance.current) {
      utterance.current = null;
      setSpeaking(false);
      try { synthesis.cancel(); } catch { setVoiceError(true); return; }
    }
    const reply = new SpeechSynthesisUtterance(latestReply.content);
    reply.lang = locale;
    reply.onstart = () => { if (utterance.current === reply) setSpeaking(true); };
    const finish = () => {
      if (utterance.current !== reply) return;
      utterance.current = null;
      setSpeaking(false);
    };
    reply.onend = finish;
    reply.onerror = event => {
      if (utterance.current === reply && !['canceled', 'interrupted'].includes(event.error)) setVoiceError(true);
      finish();
    };
    utterance.current = reply;
    try { synthesis.speak(reply); }
    catch { if (utterance.current === reply) { setVoiceError(true); finish(); } }
  }, [latestReply, locale, readReplies, synthesis, chat?.storageReady]);

  function toggleDictation() {
    if (dictation.current) {
      const recording = dictation.current;
      dictation.current = null;
      setListening(false);
      try { recording.abort(); } catch { setVoiceError(true); }
      return;
    }
    if (!Recognition || !chat || utterance.current || document.hidden) return;
    setVoiceError(false);
    const recording = new Recognition();
    recording.lang = locale;
    recording.onresult = event => {
      if (dictation.current !== recording) return;
      const text = Array.from(event.results, result => result[0]?.transcript ?? '').join(' ').trim();
      if (text) chat.setInput(previous => [previous.trimEnd(), text].filter(Boolean).join(' '));
    };
    recording.onerror = () => {
      if (dictation.current !== recording) return;
      dictation.current = null;
      setListening(false);
      setVoiceError(true);
      try { recording.abort(); } catch { /* Engine already stopped. */ }
    };
    recording.onend = () => {
      if (dictation.current !== recording) return;
      dictation.current = null;
      setListening(false);
    };
    try {
      dictation.current = recording;
      recording.start();
      setListening(true);
    } catch {
      dictation.current = null;
      setVoiceError(true);
    }
  }

  function toggleReadReplies() {
    setVoiceError(false);
    if (readReplies && utterance.current) {
      utterance.current = null;
      try { synthesis?.cancel(); } catch { setVoiceError(true); }
      setSpeaking(false);
    }
    // Establish the baseline on enable, including restored chat history.
    lastRead.current = latestReply?.id;
    setReadReplies(!readReplies);
  }

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    const controller=new AbortController();
    let active=true;
    void loadLightMask(controller.signal).then(mesh=>{
      if(active) setLightMask(mesh);
    }).catch(()=>{
      if(active && !controller.signal.aborted) setMaskError(true);
    });
    return ()=>{active=false;controller.abort();};
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const points = lightMask ? sampleLightField(lightMask.vertices,lightMask.triangles) : [];
    let frame=0,lastDraw=-Infinity,yaw=0,pitch=0,energy=activity.current;
    // One pre-rendered radial sprite. No painted skin or filled triangles.
    const glow=document.createElement('canvas');
    glow.width=24;glow.height=24;
    const g=glow.getContext('2d');
    if(g){
      const gradient=g.createRadialGradient(12,12,0,12,12,12);
      gradient.addColorStop(0,'rgba(214,240,255,1)');
      gradient.addColorStop(.16,'rgba(120,205,255,.64)');
      gradient.addColorStop(.45,'rgba(50,130,255,.16)');
      gradient.addColorStop(1,'rgba(30,80,255,0)');
      g.fillStyle=gradient;g.fillRect(0,0,24,24);
    }
    const render=(time:number)=>{
      const still=motion.matches;
      const phase=still?0:time/1000;
      const scale=element.width/2;
      energy=still?activity.current:energy+(activity.current-energy)*.07;
      const targetYaw=still?0:pointer.current.x*.54+.24*Math.sin(phase*.49);
      const targetPitch=still?0:pointer.current.y*.24+.075*Math.sin(phase*.67);
      yaw=still?0:yaw+(targetYaw-yaw)*.09;
      pitch=still?0:pitch+(targetPitch-pitch)*.09;
      context.clearRect(0,0,element.width,element.height);
      context.globalCompositeOperation='lighter';
      // Independent, dim orbital points with their own 3D depth, not a ring overlay.
      for(let i=0;i<96;i++){
        const angle=i*2.39996323+phase*.055;
        const height=(i/95)*2-1;
        const radius=Math.sqrt(Math.max(0,1-height*height))*1.02;
        const depth=Math.sin(angle)*radius;
        const factor=2.8/(2.8-depth*.55);
        const x=scale+Math.cos(angle)*radius*scale*.86*factor;
        const y=scale+height*scale*.86*factor;
        context.globalAlpha=.08+.08*(.5+.5*Math.sin(i+phase*.7));
        context.fillStyle='#458ffc';context.fillRect(x,y,1,1);
      }
      // Every visible pixel of the face comes from a point on the licensed mesh.
      // Additive light, with deliberately darker rear-facing points, reveals depth.
      let drawn=0;
      for(const p of points){
        const q=projectLightPoint(p,yaw,pitch,phase,energy,scale);
        if(q.x<0||q.y<0||q.x>=element.width||q.y>=element.height)continue;
        const radius=q.radius;
        context.globalAlpha=q.brightness*.68;
        context.fillStyle=p.energy>.78?'#d8f5ff':p.energy>.38?'#78c9ff':'#377ce0';
        context.fillRect(q.x-radius,q.y-radius,radius*2,radius*2);
        if(g && p.energy>.88){
          const size=radius*(5+energy*2);
          context.globalAlpha=q.brightness*.42;
          context.drawImage(glow,q.x-size/2,q.y-size/2,size,size);
        }
        drawn++;
      }
      context.globalAlpha=1;
      context.globalCompositeOperation='source-over';
      element.dataset.renderedPoints=String(drawn);
      element.dataset.yaw=yaw.toFixed(4);
      element.dataset.renderer='surface-light-field';
    };
    const tick=(time:number)=>{
      if(document.hidden||motion.matches)return;
      if(time-lastDraw>=32){render(time);lastDraw=time;}
      frame=requestAnimationFrame(tick);
    };
    const refresh=()=>{
      cancelAnimationFrame(frame);
      if(document.hidden)return;
      lastDraw=-Infinity;
      render(motion.matches?0:performance.now());
      if(!motion.matches)frame=requestAnimationFrame(tick);
    };
    renderStill.current=()=>{if(motion.matches&&!document.hidden)render(0);};
    refresh();
    motion.addEventListener('change',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{
      renderStill.current=()=>{};
      cancelAnimationFrame(frame);
      motion.removeEventListener('change',refresh);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[lightMask]);

  return <dialog ref={dialog} className="aura-portrait" aria-labelledby="aura-portrait-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header>
      <h2 id="aura-portrait-title">Aura</h2>
      <button type="button" onClick={onClose} aria-label={tr('Stäng Auras porträtt', 'Close Aura portrait')}><X size={20}/></button>
    </header>
    <div className="aura-portrait-scene" onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      pointer.current = {x: 2 * (event.clientX - rect.left) / rect.width - 1, y: 2 * (event.clientY - rect.top) / rect.height - 1};
    }} onPointerLeave={() => { pointer.current = {x:0, y:0}; }}>
      <canvas ref={canvas} width={480} height={480} role="img"
        aria-label={tr('Auras tredimensionella ljusmask', 'Aura’s three-dimensional light mask')}/>
    </div>
    {maskError && <p role="status">{tr('Ljusmasken kunde inte laddas.', 'The light mask could not load.')}</p>}
    <p data-tone={tone}>{label}</p>
    {chat && <div className="aura-portrait-conversation">
      {latestReply && <div className="aura-portrait-reply" aria-live="polite">{latestReply.content}</div>}
      <textarea value={chat.input} onChange={event => { const text = event.currentTarget.value; chat.setInput(() => text); }}
        aria-label={tr('Meddelande till Aura', 'Message to Aura')}
        placeholder={tr('Skriv till Aura…', 'Message Aura…')} rows={2}/>
      <div className="aura-portrait-controls">
        <button type="button" onClick={toggleDictation} disabled={!Recognition || speaking} aria-pressed={listening}
          title={tr('Webbläsarens taligenkänning kan använda en extern tjänst', 'Browser dictation may use an external service')}>
          {listening ? <MicOff size={16}/> : <Mic size={16}/>}
          {listening ? tr('Sluta lyssna', 'Stop listening') : tr('Diktera', 'Dictate')}
        </button>
        <button type="button" onClick={toggleReadReplies} disabled={!synthesis || !chat.storageReady || listening} aria-pressed={readReplies}>
          {readReplies ? <Volume2 size={16}/> : <VolumeX size={16}/>}
          {tr('Läs upp svar', 'Read replies aloud')}
        </button>
        <button type="submit" form="aura-chat-composer" disabled={!chat.input.trim() || !!chat.busy || !chat.storageReady || listening}>
          <ArrowUp size={16}/>{tr('Skicka', 'Send')}
        </button>
      </div>
      <p className="aura-portrait-voice-note">{tr('Webbläsartal är en reservfunktion. Diktering kan använda webbläsarleverantörens externa tjänst.', 'Browser speech is a fallback. Dictation may use the browser provider’s external service.')}</p>
      {listening && <p role="status">{tr('Lyssnar…', 'Listening…')}</p>}
      {voiceError && <p role="status">{tr('Röstfunktionen kunde inte användas. Försök igen eller skriv till Aura.', 'Voice was unavailable. Try again or type to Aura.')}</p>}
      {chat.storageError && <p role="status">{chat.storageError}</p>}
    </div>}
  </dialog>;
}
