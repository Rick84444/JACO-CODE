import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';

// MediaPipe canonical face model, Apache-2.0, upstream 727e43fcb7c7477f3fdf88c0498588349baaf2e5.
const meshUrl = new URL('../assets/aura-face.obj', import.meta.url).href;
type Vertex = { x: number; y: number; z: number };
type Triangle = [number, number, number];

async function loadLightMask() {
  const response = await fetch(meshUrl);
  if (!response.ok) throw new Error('AURA_FACE_ASSET_UNAVAILABLE');
  const vertices: Vertex[] = [];
  const triangles: Triangle[] = [];
  for (const line of (await response.text()).split('\n')) {
    const [kind, a, b, c] = line.trim().split(/\s+/);
    if (kind === 'v') vertices.push({ x: Number(a) / 9, y: (.65 - Number(b)) / 9, z: (Number(c) - 3) / 9 });
    if (kind === 'f') triangles.push([a, b, c].map(index => Number(index.split('/')[0]) - 1) as Triangle);
  }
  if (!vertices.length || !triangles.length || triangles.some(face => face.some(index => !vertices[index]))) {
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

const network = Array.from({ length: 34 }, (_, index) => {
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = 0.72 + (index % 5) * 0.062;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
});

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
  const lightMask = useRef<Awaited<ReturnType<typeof loadLightMask>> | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const latestReply = chat?.messages.filter(message => message.role === 'assistant' && message.content.trim()).at(-1);
  const lastRead = useRef(latestReply?.id);
  const active = tone === 'active' || speaking;
  const locale = language === 'sv' ? 'sv-SE' : 'en-US';
  const speechWindow = window as Window & {
    SpeechRecognition?: new () => Dictation;
    webkitSpeechRecognition?: new () => Dictation;
  };
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  const synthesis = window.speechSynthesis;

  useEffect(() => () => {
    const recording = dictation.current;
    dictation.current = null;
    recording?.abort();
    if (utterance.current) synthesis?.cancel();
  }, [synthesis]);

  useEffect(() => {
    if (!latestReply || lastRead.current === latestReply.id) return;
    lastRead.current = latestReply.id;
    if (!readReplies || !synthesis) return;
    if (utterance.current) synthesis.cancel();
    const reply = new SpeechSynthesisUtterance(latestReply.content);
    reply.lang = locale;
    reply.onstart = () => setSpeaking(true);
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
    synthesis.speak(reply);
  }, [latestReply, locale, readReplies, synthesis]);

  function toggleDictation() {
    if (dictation.current) {
      const recording = dictation.current;
      dictation.current = null;
      setListening(false);
      recording.abort();
      return;
    }
    if (!Recognition || !chat) return;
    setVoiceError(false);
    const recording = new Recognition();
    recording.lang = locale;
    recording.onresult = event => {
      if (dictation.current !== recording) return;
      const text = Array.from(event.results, result => result[0]?.transcript ?? '').join(' ').trim();
      if (text) chat.setInput(previous => [previous.trimEnd(), text].filter(Boolean).join(' '));
    };
    recording.onerror = () => { if (dictation.current === recording) setVoiceError(true); };
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
      synthesis?.cancel();
      setSpeaking(false);
    }
    setReadReplies(!readReplies);
  }

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let lastDraw = -Infinity;
    let disposed = false;
    let yaw = 0;
    let pitch = 0;
    const render = (time: number) => {
      const phase = motion.matches ? 0 : time / 1000;
      const scale = element.width / 2;
      context.clearRect(0, 0, element.width, element.height);
      const targetYaw = motion.matches ? 0 : pointer.current.x * .31 + .12 * Math.sin(phase * .65);
      const targetPitch = motion.matches ? 0 : pointer.current.y * .19 + .055 * Math.sin(phase * .81);
      yaw += (targetYaw - yaw) * .13;
      pitch += (targetPitch - pitch) * .13;
      const cx = Math.cos(yaw), sx = Math.sin(yaw), cy = Math.cos(pitch), sy = Math.sin(pitch);
      const mesh = lightMask.current;
      if (mesh) {
        const projected = mesh.vertices.map(point => {
          const x = point.x * cx + point.z * sx;
          const depth = point.z * cx - point.x * sx;
          const y = point.y * cy - depth * sy;
          const z = depth * cy + point.y * sy;
          const size = scale * .87 * 2.8 / (2.8 - z);
          return { x: scale + x * size, y: scale + y * size, z };
        });
        const ordered = mesh.triangles.map(([i, j, k]) => {
          const a = projected[i], b = projected[j], c = projected[k];
          return { a, b, c, depth: (a.z + b.z + c.z) / 3 };
        }).sort((a, b) => a.depth - b.depth);
        for (const { a, b, c, depth } of ordered) {
          const ux = (b.x - a.x) / scale, uy = (b.y - a.y) / scale, uz = b.z - a.z;
          const vx = (c.x - a.x) / scale, vy = (c.y - a.y) / scale, vz = c.z - a.z;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          if (nz >= 0) continue;
          const normal = Math.hypot(nx, ny, nz);
          const diffuse = Math.max(0, (nx * .42 + ny * .35 - nz * .84) / normal);
          const rim = (1 + nz / normal) ** 2;
          const pulse = active ? (1 + Math.sin(phase * 3 - depth * 12)) * 9 : 0;
          const light = Math.round(Math.min(240, 38 + 132 * diffuse + 65 * rim + pulse));
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.lineTo(c.x, c.y);
          context.closePath();
          context.fillStyle = `rgb(${Math.round(light * .57)},${Math.round(light * .8)},${Math.min(255, light + 44)})`;
          context.fill();
          context.strokeStyle = 'rgba(156,213,255,.16)';
          context.lineWidth = .75;
          context.stroke();
          context.fillStyle = `rgba(193,228,255,${(.26 + .48 * diffuse).toFixed(2)})`;
          const x = (a.x + b.x + c.x) / 3;
          const y = (a.y + b.y + c.y) / 3;
          context.fillRect(x, y, 1.35, 1.35);
        }
      }
      context.fillStyle = '#79baff';
      context.strokeStyle = '#79baff';
      for (const [index, node] of network.entries()) {
        const neighbor = network[(index + 8) % network.length];
        const drift = 0.035 * Math.sin(phase * 0.75 + index * 0.7);
        const x = scale * (1 + node.x * (1 + drift));
        const y = scale * (1 + node.y * (1 + drift));
        context.globalAlpha = active ? 0.24 + 0.12 * Math.sin(phase * 2 - index * 0.45) : 0.08;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo((x + scale * (1 + neighbor.x)) / 2, (y + scale * (1 + neighbor.y)) / 2);
        context.stroke();
        context.beginPath();
        context.arc(x, y, active ? 1.8 : 1.1, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };
    const tick = (time: number) => {
      if (time - lastDraw >= 32) {
        render(time);
        lastDraw = time;
      }
      frame = requestAnimationFrame(tick);
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      if (document.hidden) return;
      render(0);
      if (!motion.matches) frame = requestAnimationFrame(tick);
    };
    refresh();
    if (!lightMask.current) void loadLightMask().then(points => {
      if (disposed) return;
      lightMask.current = points;
      refresh();
    }).catch(() => { if (!disposed) setMaskError(true); });
    motion.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [active]);

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
      <canvas ref={canvas} width={480} height={480} role="img" aria-label={tr('Auras tredimensionella ljusmask', 'Aura’s three-dimensional light mask')}/>
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
        <button type="button" onClick={toggleReadReplies} disabled={!synthesis || !chat.storageReady} aria-pressed={readReplies}>
          {readReplies ? <Volume2 size={16}/> : <VolumeX size={16}/>}
          {tr('Läs upp svar', 'Read replies aloud')}
        </button>
        <button type="submit" form="aura-chat-composer" disabled={!chat.input.trim() || !!chat.busy || !chat.storageReady || listening}>
          <ArrowUp size={16}/>{tr('Skicka', 'Send')}
        </button>
      </div>
      {listening && <p role="status">{tr('Lyssnar…', 'Listening…')}</p>}
      {voiceError && <p role="status">{tr('Röstfunktionen kunde inte användas. Försök igen eller skriv till Aura.', 'Voice was unavailable. Try again or type to Aura.')}</p>}
      {chat.storageError && <p role="status">{chat.storageError}</p>}
    </div>}
  </dialog>;
}
