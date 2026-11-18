import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';

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
  continuous?: boolean;
  interimResults?: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  start(): void;
  stop?(): void;
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
  // The reply currently being read aloud: the neural voice (audio element) or the browser fallback.
  const utterance = useRef<{ cancel: () => void } | null>(null);
  const [listening, setListening] = useState(false);
  const [readReplies, setReadReplies] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const [maskError, setMaskError] = useState(false);
  const rig = useRef<Awaited<ReturnType<typeof import('../lib/auraRigLightform.mjs')['createAuraRigLightform']>> | null>(null);
  const latestReply = chat?.messages.filter(message => message.role === 'assistant' && message.content.trim()).at(-1);
  const lastRead = useRef(latestReply?.id);
  const active = tone === 'active' || speaking;
  const rigState = useRef({active:false,speaking:false,listening:false,x:0,y:0});
  useEffect(()=>{
    Object.assign(rigState.current,{active,speaking,listening});
    rig.current?.setState(rigState.current);
  },[active,speaking,listening]);
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
      if (reply) { try { reply.cancel(); } catch { /* Engine unavailable. */ } }
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
    // Never play into an open microphone, read restored history or start audio in a hidden tab.
    if (!readReplies || !chat?.storageReady || document.hidden || dictation.current) return;
    if (utterance.current) {
      const previous = utterance.current;
      utterance.current = null;
      setSpeaking(false);
      try { previous.cancel(); } catch { /* Already stopped. */ }
    }
    const text = latestReply.content;
    // Aura's own female neural voice (the same engine as her voice notes), played through an audio element so
    // the rig's formant tracker drives her mouth from the real sound. The browser voice is only a fallback.
    const controller = new AbortController();
    const audio = new Audio();
    let url = '';
    const handle = {
      cancel: () => {
        controller.abort();
        audio.pause();
        if (url) URL.revokeObjectURL(url);
        rig.current?.setState({ audioSource: null });
      },
    };
    const finish = () => {
      if (utterance.current !== handle) return;
      utterance.current = null;
      setSpeaking(false);
      rig.current?.setState({ audioSource: null });
      if (url) URL.revokeObjectURL(url);
    };
    const browserFallback = () => {
      if (utterance.current !== handle || !synthesis) { setVoiceError(true); finish(); return; }
      const reply = new SpeechSynthesisUtterance(text);
      reply.lang = locale;
      reply.onstart = () => { if (utterance.current === handle) setSpeaking(true); };
      reply.onend = finish;
      reply.onerror = event => {
        if (utterance.current === handle && !['canceled', 'interrupted'].includes(event.error)) setVoiceError(true);
        finish();
      };
      handle.cancel = () => { try { synthesis.cancel(); } catch { /* Engine unavailable. */ } };
      try { synthesis.speak(reply); } catch { setVoiceError(true); finish(); }
    };
    utterance.current = handle;
    void fetch('/api/aura/voice/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ text, lang: locale }),
    }).then(async response => {
      if (!response.ok) throw new Error('VOICE_UNAVAILABLE');
      const blob = await response.blob();
      if (utterance.current !== handle) return;
      url = URL.createObjectURL(blob);
      audio.src = url;
      audio.onplay = () => {
        if (utterance.current !== handle) return;
        setSpeaking(true);
        // Lip sync listens to a copy of the stream; the audio element itself plays straight to the speakers, so a
        // suspended Web Audio context can never silence Aura.
        const tap = (audio as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
        rig.current?.setState({ audioSource: tap ?? null, speaking: true });
      };
      audio.onended = finish;
      audio.onerror = () => { if (utterance.current === handle) { setVoiceError(true); finish(); } };
      await audio.play();
    }).catch(error => {
      if (controller.signal.aborted || utterance.current !== handle) return;
      void error;
      browserFallback();
    });
  }, [latestReply, locale, readReplies, synthesis, chat?.storageReady]);

  function toggleDictation() {
    if (dictation.current) {
      const recording = dictation.current;
      dictation.current = null;
      setListening(false);
      try { recording.abort(); } catch { setVoiceError(true); }
      return;
    }
    if (!Recognition || !chat || document.hidden) return;
    // Talking interrupts Aura's read-aloud instead of being blocked by it (and never records her own voice).
    if (utterance.current) {
      const reply = utterance.current;
      utterance.current = null;
      try { reply.cancel(); } catch { /* Already stopped. */ }
      setSpeaking(false);
    }
    setVoiceError(false);
    const recording = new Recognition();
    recording.lang = locale;
    recording.continuous = true;
    recording.interimResults = true;
    // Text already in the box stays; this session's words are shown live and replaced as they are refined.
    let base = (chat.input || '').trimEnd();
    let committed = '';
    recording.onresult = event => {
      if (dictation.current !== recording) return;
      let finals = '', interim = '';
      for (const result of Array.from(event.results)) {
        const piece = result[0]?.transcript ?? '';
        if (result.isFinal) finals += piece; else interim += piece;
      }
      committed = finals.trim();
      const spoken = [committed, interim.trim()].filter(Boolean).join(' ');
      chat.setInput(() => [base, spoken].filter(Boolean).join(' '));
    };
    recording.onerror = event => {
      if (dictation.current !== recording) return;
      // Silence and engine restarts are normal while listening; only real failures are reported.
      if (event?.error === 'no-speech' || event?.error === 'aborted') return;
      dictation.current = null;
      setListening(false);
      setVoiceError(true);
      try { recording.abort(); } catch { /* Engine already stopped. */ }
    };
    recording.onend = () => {
      if (dictation.current !== recording) return;
      // Browsers end recognition after a pause; keep listening until the operator presses stop.
      base = [base, committed].filter(Boolean).join(' ');
      committed = '';
      try { recording.start(); }
      catch { dictation.current = null; setListening(false); }
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
      const reply = utterance.current;
      utterance.current = null;
      try { reply.cancel(); } catch { setVoiceError(true); }
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

  useEffect(()=>{
    const controller=new AbortController();
    const element=canvas.current;
    if(!element)return;
    void import('../lib/auraRigLightform.mjs').then(({createAuraRigLightform})=>
      createAuraRigLightform(element,{signal:controller.signal,onError:()=>{if(!controller.signal.aborted)setMaskError(true);}})
    ).then(instance=>{
      if(controller.signal.aborted){instance.dispose();return;}
      rig.current=instance;instance.setState(rigState.current);
    }).catch(()=>{if(!controller.signal.aborted)setMaskError(true);});
    return()=>{controller.abort();rig.current?.dispose();rig.current=null;};
  },[]);

  return <dialog ref={dialog} className="aura-portrait" aria-labelledby="aura-portrait-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header>
      <h2 id="aura-portrait-title">Aura</h2>
      <button type="button" onClick={onClose} aria-label={tr('Stäng Auras porträtt', 'Close Aura portrait')}><X size={20}/></button>
    </header>
    <div className="aura-portrait-scene" onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const p={x:2*(event.clientX-rect.left)/rect.width-1,y:2*(event.clientY-rect.top)/rect.height-1};
      Object.assign(rigState.current,p);rig.current?.setState(p);
    }} onPointerLeave={() => { Object.assign(rigState.current,{x:0,y:0});rig.current?.setState({x:0,y:0}); }}>
      <canvas ref={canvas} width={480} height={480} role="img"
        aria-label={tr('Auras tredimensionella ljusgestalt', 'Aura’s three-dimensional lightform')}/>
    </div>
    {maskError && <p role="status">{tr('Den tredimensionella gestalten kunde inte laddas. Chatten är fortfarande tillgänglig.', 'The 3D lightform could not load. Chat remains available.')}</p>}
    <p data-tone={tone}>{label}</p>
    {chat && <div className="aura-portrait-conversation">
      {latestReply && <div className="aura-portrait-reply" aria-live="polite">{latestReply.content}</div>}
      <textarea value={chat.input} onChange={event => { const text = event.currentTarget.value; chat.setInput(() => text); }}
        aria-label={tr('Meddelande till Aura', 'Message to Aura')}
        placeholder={tr('Skriv till Aura…', 'Message Aura…')} rows={2}/>
      <div className="aura-portrait-controls">
        <button type="button" onClick={toggleDictation} disabled={!Recognition} aria-pressed={listening}
          title={tr('Webbläsarens taligenkänning kan använda en extern tjänst', 'Browser dictation may use an external service')}>
          {listening ? <MicOff size={16}/> : <Mic size={16}/>}
          {listening ? tr('Sluta lyssna', 'Stop listening') : tr('Diktera', 'Dictate')}
        </button>
        <button type="button" onClick={toggleReadReplies} disabled={!chat.storageReady || listening} aria-pressed={readReplies}>
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
