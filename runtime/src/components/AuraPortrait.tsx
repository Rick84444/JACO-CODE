import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';
import { workspaceReplyText } from '../lib/workspaceActions.mjs';
import { speechParts } from '../lib/speechParts.mjs';

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
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  start(): void;
  stop?(): void;
  abort(): void;
}

// Per-viewer convenience: a conversation left on stays on when the portrait opens again.
const CONVERSATION_KEY = 'jaco.aura.conversation';
function savedConversation() { try { return localStorage.getItem(CONVERSATION_KEY) === '1'; } catch { return false; } }

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
  const [readReplies, setReadReplies] = useState(savedConversation);
  const [speaking, setSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [preparingSpeech, setPreparingSpeech] = useState(false);
  const [speechAct, setSpeechAct] = useState<'neutral' | 'question'>('neutral');
  const [voiceError, setVoiceError] = useState(false);
  const [maskError, setMaskError] = useState(false);
  const [photoreal, setPhotoreal] = useState(false);
  const [cavern, setCavern] = useState(false);
  const audioTap = useRef<MediaStream | null>(null);
  // Conversation mode: listen, send after a pause, hear the reply, listen again.
  const [conversation, setConversation] = useState(savedConversation);
  const [awaiting, setAwaiting] = useState(false);
  const conversationRef = useRef(false);
  const awaitToken = useRef(0);
  const rig = useRef<Awaited<ReturnType<typeof import('../lib/auraRigLightform.mjs')['createAuraRigLightform']>> | Awaited<ReturnType<typeof import('../lib/auraSplatProvider.mjs')['createAuraSplatProvider']>> | null>(null);
  const latestReply = chat?.messages.filter(message => message.role === 'assistant' && message.content.trim()).at(-1);
  const lastRead = useRef(latestReply?.id);
  const active = tone === 'active' || speaking;
  const awaitingReply = awaiting || Boolean(chat?.busy);
  const rigState = useRef({active:false,speaking:false,listening:false,x:0,y:0,conversationManaged:true,userSpeaking:false,speechPlaying:false,preparingSpeech:false,awaitingReply:false,speechAct:'neutral'});
  useEffect(()=>{
    Object.assign(rigState.current,{active,speaking,listening,userSpeaking:userSpeaking&&listening,speechPlaying:speaking,preparingSpeech,awaitingReply,speechAct});
    rig.current?.setState(rigState.current);
  },[active,speaking,listening,userSpeaking,preparingSpeech,awaitingReply,speechAct]);
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
      awaitToken.current++;
      setAwaiting(false);
      setListening(false);
      setUserSpeaking(false);
      setPreparingSpeech(false);
      setSpeaking(false);
      setReadReplies(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      awaitToken.current++;
      stop();
    };
  }, [synthesis]);

  useEffect(() => {
    if (!latestReply || lastRead.current === latestReply.id) return;
    lastRead.current = latestReply.id;
    awaitToken.current++;
    setAwaiting(false);
    // Never play into an open microphone, read restored history or start audio in a hidden tab.
    if (!readReplies || !chat?.storageReady || document.hidden || dictation.current) return;
    if (utterance.current) {
      const previous = utterance.current;
      utterance.current = null;
      setSpeaking(false);
      setPreparingSpeech(false);
      try { previous.cancel(); } catch { /* Already stopped. */ }
    }
    const text = workspaceReplyText(latestReply.content);
    // Aura's own female neural voice (the same engine as her voice notes), played through an audio element so
    // the rig's formant tracker drives her mouth from the real sound. The browser voice is only a fallback.
    // Spoken sentence by sentence: the next part is synthesized while the current one plays, so Aura starts
    // talking after the first sentence instead of after the whole reply.
    const controller = new AbortController();
    const audio = new Audio();
    const urls: string[] = [];
    const handle = {
      cancel: () => {
        controller.abort();
        audio.pause();
        urls.forEach(u => URL.revokeObjectURL(u));
        audioTap.current = null;
        rig.current?.setState({ audioSource: null, speaking:false, speechPlaying:false, preparingSpeech:false });
      },
    };
    const finish = () => {
      if (utterance.current !== handle) return;
      utterance.current = null;
      setSpeaking(false);
      setPreparingSpeech(false);
      audioTap.current = null;
      rig.current?.setState({ audioSource: null, speaking:false, speechPlaying:false, preparingSpeech:false });
      urls.forEach(u => URL.revokeObjectURL(u));
    };
    const browserFallback = () => {
      if (utterance.current !== handle || !synthesis) { setVoiceError(true); finish(); return; }
      const reply = new SpeechSynthesisUtterance(text);
      reply.lang = locale;
      setSpeechAct(/\?\s*$/.test(text)?'question':'neutral');
      reply.onstart = () => { if (utterance.current === handle) { setPreparingSpeech(false); setSpeaking(true); } };
      reply.onpause = () => { if (utterance.current === handle) setSpeaking(false); };
      reply.onresume = () => { if (utterance.current === handle) setSpeaking(true); };
      reply.onend = finish;
      reply.onerror = event => {
        if (utterance.current === handle && !['canceled', 'interrupted'].includes(event.error)) setVoiceError(true);
        finish();
      };
      handle.cancel = () => { try { synthesis.cancel(); } catch { /* Engine unavailable. */ } };
      try { synthesis.speak(reply); } catch { setVoiceError(true); finish(); }
    };
    utterance.current = handle;
    setPreparingSpeech(true);
    const parts = speechParts(text);
    const synthesize = (part: string) => fetch('/api/aura/voice/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ text: part, lang: locale }),
    }).then(async response => {
      if (!response.ok) throw new Error('VOICE_UNAVAILABLE');
      const url = URL.createObjectURL(await response.blob());
      urls.push(url);
      return url;
    });
    // Lip sync listens to a copy of the stream; the audio element itself plays straight to the speakers, so a
    // suspended Web Audio context can never silence Aura.
    audio.onplaying = () => {
      if (utterance.current !== handle) return;
      setPreparingSpeech(false);
      setSpeaking(true);
      const tap = (audio as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
      audioTap.current = tap ?? null;
      rig.current?.setState({ audioSource: audioTap.current, speaking: true, speechPlaying:true, preparingSpeech:false });
    };
    const pauseVisualSpeech = (preparing: boolean) => {
      if (utterance.current !== handle) return;
      setSpeaking(false);
      setPreparingSpeech(preparing);
      rig.current?.setState({ speaking:false, speechPlaying:false, preparingSpeech:preparing });
    };
    audio.onwaiting = () => pauseVisualSpeech(true);
    audio.onpause = () => { if (audio.paused && !audio.ended) pauseVisualSpeech(false); };
    const playPart = (url: string) => new Promise<void>((resolve, reject) => {
      audio.onended = () => { pauseVisualSpeech(true); resolve(); };
      audio.onerror = () => reject(new Error('VOICE_PLAYBACK_FAILED'));
      audio.src = url;
      audio.play().catch(reject);
    });
    void (async () => {
      let started = false;
      if (!parts.length) { finish(); return; }
      try {
        let next = synthesize(parts[0]);
        for (let index = 0; index < parts.length; index++) {
          const url = await next;
          if (utterance.current !== handle) return;
          // Prefetch the following sentence while this one plays.
          if (index + 1 < parts.length) { next = synthesize(parts[index + 1]); next.catch(() => {}); }
          setSpeechAct(/\?\s*$/.test(parts[index])?'question':'neutral');
          await playPart(url);
          started = true;
          if (utterance.current !== handle) return;
        }
        finish();
      } catch {
        if (controller.signal.aborted || utterance.current !== handle) return;
        // Only fall back before Aura has spoken; switching voice mid-reply would be worse than stopping.
        if (!started) browserFallback(); else { setVoiceError(true); finish(); }
      }
    })();
  }, [latestReply, locale, readReplies, synthesis, chat?.storageReady]);

  function toggleDictation() {
    if (dictation.current) {
      const recording = dictation.current;
      dictation.current = null;
      setListening(false);
      setUserSpeaking(false);
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
      setPreparingSpeech(false);
    }
    setVoiceError(false);
    const recording = new Recognition();
    recording.lang = locale;
    recording.continuous = true;
    recording.interimResults = true;
    recording.onspeechstart = () => { if (dictation.current === recording) setUserSpeaking(true); };
    recording.onspeechend = () => { if (dictation.current === recording) setUserSpeaking(false); };
    // Text already in the box stays; this session's words are shown live and replaced as they are refined.
    let base = (chat.input || '').trimEnd();
    let committed = '';
    let silence: ReturnType<typeof setTimeout> | undefined;
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
      // In conversation mode a short pause after speaking sends the message, like talking to a person.
      if (conversationRef.current && spoken) {
        if (silence) clearTimeout(silence);
        silence = setTimeout(() => {
          if (dictation.current !== recording || !conversationRef.current) return;
          dictation.current = null;
          setListening(false);
          setUserSpeaking(false);
          try { recording.abort(); } catch { /* Engine already stopped. */ }
          const token = ++awaitToken.current;
          setAwaiting(true);
          setTimeout(() => { if (awaitToken.current === token && (!conversationRef.current || document.hidden || !submitDraft())) setAwaiting(false); }, 60);
          setTimeout(() => { if (awaitToken.current === token) setAwaiting(false); }, 90000);
        }, 1300);
      }
    };
    recording.onerror = event => {
      if (dictation.current !== recording) return;
      // Silence and engine restarts are normal while listening; only real failures are reported.
      if (event?.error === 'no-speech' || event?.error === 'aborted') return;
      dictation.current = null;
      setListening(false);
      setUserSpeaking(false);
      setVoiceError(true);
      try { recording.abort(); } catch { /* Engine already stopped. */ }
    };
    recording.onend = () => {
      if (dictation.current !== recording) return;
      setUserSpeaking(false);
      // Browsers end recognition after a pause; keep listening until the operator presses stop.
      base = [base, committed].filter(Boolean).join(' ');
      committed = '';
      // Only resume a session that actually listened for a while, with a short delay and a cap, so an engine that
      // ends immediately (no microphone, denied, test double) stops instead of restarting in a tight loop.
      if (Date.now() - startedAt < 800 || restarts >= 30) { dictation.current = null; setListening(false); return; }
      setTimeout(() => {
        if (dictation.current !== recording) return;
        try { startedAt = Date.now(); restarts++; recording.start(); }
        catch { dictation.current = null; setListening(false); }
      }, 150);
    };
    let startedAt = Date.now(), restarts = 0;
    try {
      dictation.current = recording;
      startedAt = Date.now();
      recording.start();
      setListening(true);
    } catch {
      dictation.current = null;
      setVoiceError(true);
    }
  }

  // Sends the shared draft through the existing chat composer (same path as the Send button).
  function submitDraft() {
    const form = document.getElementById('aura-chat-composer') as HTMLFormElement | null;
    if (!form || !chat || chat.busy || !chat.storageReady) return false;
    form.requestSubmit();
    return true;
  }

  function toggleConversation() {
    const next = !conversation;
    conversationRef.current = next;
    setConversation(next);
    try { localStorage.setItem(CONVERSATION_KEY, next ? '1' : '0'); } catch { /* Storage unavailable. */ }
    setVoiceError(false);
    if (next) {
      if (!readReplies) { lastRead.current = latestReply?.id; setReadReplies(true); }
    } else {
      if (dictation.current) toggleDictation();
      awaitToken.current++;
      setAwaiting(false);
    }
  }

  // Conversation loop: when Aura is neither working nor speaking, start listening again.
  useEffect(() => {
    conversationRef.current = conversation;
    if (!conversation || !chat || listening || speaking || preparingSpeech || awaiting || chat.busy || document.hidden || dictation.current || utterance.current) return;
    const id = setTimeout(() => { if (conversationRef.current && !dictation.current && !utterance.current) toggleDictation(); }, 450);
    return () => clearTimeout(id);
  });

  function toggleReadReplies() {
    setVoiceError(false);
    if (readReplies && utterance.current) {
      const reply = utterance.current;
      utterance.current = null;
      try { reply.cancel(); } catch { setVoiceError(true); }
      setSpeaking(false);
      setPreparingSpeech(false);
    }
    // Establish the baseline on enable, including restored chat history.
    lastRead.current = latestReply?.id;
    setReadReplies(!readReplies);
  }

  useEffect(() => {
    const element = dialog.current;
    // Non-modal: the rest of the workspace stays usable while the conversation runs.
    element?.show();
    return () => { element?.close(); };
  }, []);

  useEffect(()=>{
    const controller=new AbortController();
    const element=canvas.current;
    if(!element)return;
    setMaskError(false);
    const options={signal:controller.signal,onError:()=>{if(!controller.signal.aborted)setMaskError(true);}};
    const load=photoreal
      ? import('../lib/auraSplatProvider.mjs').then(({createAuraSplatProvider})=>createAuraSplatProvider(element,options))
      : import('../lib/auraRigLightform.mjs').then(({createAuraRigLightform})=>createAuraRigLightform(element,{...options,cavern}));
    void load.then(instance=>{
      if(controller.signal.aborted){instance.dispose();return;}
      rig.current=instance;instance.setState({...rigState.current,audioSource:audioTap.current});
    }).catch(()=>{if(!controller.signal.aborted)setMaskError(true);});
    return()=>{controller.abort();rig.current?.dispose();rig.current=null;};
  },[photoreal,cavern]);

  return <dialog ref={dialog} className="aura-portrait" aria-labelledby="aura-portrait-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <header>
      <h2 id="aura-portrait-title">Aura</h2>
      <button type="button" onClick={onClose} aria-label={tr('Stäng Auras porträtt', 'Close Aura portrait')}><X size={20}/></button>
    </header>
    <div key={photoreal ? 'splat' : cavern ? 'cavern' : 'lightform'} className="aura-portrait-scene" style={{position:'relative'}} onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const p={x:2*(event.clientX-rect.left)/rect.width-1,y:2*(event.clientY-rect.top)/rect.height-1};
      Object.assign(rigState.current,p);rig.current?.setState(p);
    }} onPointerLeave={() => { Object.assign(rigState.current,{x:0,y:0});rig.current?.setState({x:0,y:0}); }}>
      <canvas ref={canvas} width={480} height={480} role="img"
        aria-label={photoreal ? tr('Experimentellt fotorealistiskt ansikte', 'Experimental photoreal face') : cavern ? tr('Aura i en tredimensionell isgrotta', 'Aura in a three-dimensional ice cavern') : tr('Auras tredimensionella ljusgestalt', 'Aura’s three-dimensional lightform')}/>
    </div>
    <div className="aura-portrait-controls">
    <button type="button" aria-pressed={cavern} disabled={speaking || listening || awaiting} onClick={()=>{setPhotoreal(false);setCavern(value=>!value);}}>
      {cavern ? tr('Återgå till närbild', 'Return to close-up') : tr('Isgrotta · helkropp', 'Ice cavern · full body')}
    </button>
    <button type="button" aria-pressed={photoreal} disabled={speaking || listening || awaiting} onClick={()=>{setCavern(false);setPhotoreal(value=>!value);}}>
      {photoreal ? tr('Återgå till ljusgestalt', 'Return to lightform') : tr('Prova lokalt ansikte (experimentellt)', 'Try local face (experimental)')}
    </button>
    </div>
    {cavern && <p className="aura-portrait-voice-note">{tr('Lokal 3D-scen · befintlig rigg, ännu inte det slutliga ansiktet.', 'Local 3D scene · existing rig, not yet the final face.')}</p>}
    {photoreal && <p className="aura-portrait-voice-note">{tr('Kräver en lokalt installerad, licensgodkänd ansiktsmodell. Ljudstyrd formantanimation; inte verifierad läppsynk.', 'Requires a locally installed, rights-cleared head. Audio-driven formant animation; lip sync not verified.')}</p>}
    {maskError && <p role="status">{photoreal ? tr('Lokalt ansikte kunde inte användas. Kontrollera installation eller återgå till ljusgestalt.', 'Local face unavailable. Check installation or return to lightform.') : tr('Den tredimensionella gestalten kunde inte laddas. Chatten är fortfarande tillgänglig.', 'The 3D lightform could not load. Chat remains available.')}</p>}
    <p data-tone={tone}>{label}</p>
    {chat && <div className="aura-portrait-conversation">
      {latestReply && <div className="aura-portrait-reply" aria-live="polite">{workspaceReplyText(latestReply.content)}</div>}
      <textarea value={chat.input} onChange={event => { const text = event.currentTarget.value; chat.setInput(() => text); }}
        onKeyDown={event => {
          // Enter sends, Shift+Enter makes a new line.
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!chat.input.trim()) return;
          if (dictation.current) toggleDictation();
          setTimeout(submitDraft, 30);
        }}
        aria-label={tr('Meddelande till Aura', 'Message to Aura')}
        placeholder={tr('Skriv till Aura…', 'Message Aura…')} rows={2}/>
      <div className="aura-portrait-controls">
        <button type="button" onClick={toggleConversation} disabled={!Recognition || !chat.storageReady} aria-pressed={conversation}
          title={tr('Prata med Aura: hon lyssnar, svarar med röst och lyssnar igen', 'Talk with Aura: she listens, answers aloud and listens again')}>
          <Volume2 size={16}/>
          {conversation ? tr('Avsluta samtal', 'End conversation') : tr('Prata med Aura', 'Talk with Aura')}
        </button>
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
