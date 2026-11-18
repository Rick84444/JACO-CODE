import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';

const portraitUrl = new URL('../assets/aura-portrait.webp', import.meta.url).href;

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
  const artwork = useRef<HTMLImageElement>(null);
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
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let lastDraw = -Infinity;
    let yaw = 0;
    let pitch = 0;
    const render = (time: number) => {
      const phase = motion.matches ? 0 : time / 1000;
      const scale = element.width / 2;
      const targetYaw = motion.matches ? 0 : pointer.current.x * .31 + .12 * Math.sin(phase * .65);
      const targetPitch = motion.matches ? 0 : pointer.current.y * .19 + .055 * Math.sin(phase * .81);
      yaw += (targetYaw - yaw) * .13;
      pitch += (targetPitch - pitch) * .13;
      context.clearRect(0, 0, element.width, element.height);
      if (artwork.current) {
        artwork.current.style.transform = motion.matches ? '' : `scale(1.06) rotateX(${pitch}rad) rotateY(${yaw}rad)`;
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
    motion.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
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
      <img ref={artwork} src={portraitUrl} width={960} height={960}
        alt={tr('Aura som en blåvit ljusgestalt', 'Aura as a blue-white being of light')}/>
      <canvas ref={canvas} width={480} height={480} aria-hidden="true"/>
    </div>
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
