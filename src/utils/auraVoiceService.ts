export interface AuraVoiceOptions {
  voicePreset?: string;
  pitch?: number;
  rate?: number;
  volume?: number;
  lang?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

export interface AuraVoiceSettings {
  voicePreset: string;
  pitch: number;
  rate: number;
  volume: number;
  autoReadResponses: boolean;
  language: string;
}

const DEFAULT_SETTINGS: AuraVoiceSettings = {
  voicePreset: 'aura-swedish-neural',
  pitch: 1.05,
  rate: 1.0,
  volume: 1.0,
  autoReadResponses: false,
  language: 'sv-SE'
};

export function getAuraVoiceSettings(): AuraVoiceSettings {
  try {
    const stored = localStorage.getItem('jaco_aura_voice_settings');
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn("Could not load aura voice settings:", e);
  }
  return DEFAULT_SETTINGS;
}

export function saveAuraVoiceSettings(settings: Partial<AuraVoiceSettings>): AuraVoiceSettings {
  const current = getAuraVoiceSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem('jaco_aura_voice_settings', JSON.stringify(updated));
  } catch (e) {
    console.warn("Could not save aura voice settings:", e);
  }
  return updated;
}

let activeUtterance: SpeechSynthesisUtterance | null = null;

export async function speakAura(text: string, options?: AuraVoiceOptions): Promise<boolean> {
  const settings = getAuraVoiceSettings();
  const finalPitch = options?.pitch ?? settings.pitch;
  const finalRate = options?.rate ?? settings.rate;
  const finalVolume = options?.volume ?? settings.volume;
  const finalLang = options?.lang ?? settings.language;
  const voicePreset = options?.voicePreset ?? settings.voicePreset;

  // 1. Log to server /api/aura/tts asynchronously for telemetry
  try {
    fetch('/api/aura/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voicePreset,
        pitch: finalPitch,
        rate: finalRate
      })
    }).catch(() => {});
  } catch (e) {
    // Ignore network error for logging
  }

  // 2. Synthesize using Web Speech API if supported
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel(); // Stop current speech

    // Clean text from markdown formatting for clearer speech output
    const cleanText = text
      .replace(/[*_#`~[\]()]/g, '')
      .replace(/https?:\/\/\S+/g, 'länk')
      .trim();

    if (!cleanText) return false;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = finalPitch;
    utterance.rate = finalRate;
    utterance.volume = finalVolume;
    utterance.lang = finalLang;

    // Try to match a voice
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const preferredVoice = voices.find(v =>
        (finalLang.startsWith('sv') && (v.lang.startsWith('sv') || v.name.includes('Swedish'))) ||
        (finalLang.startsWith('en') && (v.lang.startsWith('en') || v.name.includes('English')))
      ) || voices[0];
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
    }

    if (options?.onStart) utterance.onstart = options.onStart;
    if (options?.onEnd) utterance.onend = () => {
      activeUtterance = null;
      if (options.onEnd) options.onEnd();
    };
    if (options?.onError) utterance.onerror = (e) => {
      activeUtterance = null;
      if (options.onError) options.onError(e);
    };

    activeUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  // Fallback: Web Audio API synth chime if speechSynthesis unavailable
  playFallbackSynthChime();
  if (options?.onStart) options.onStart();
  setTimeout(() => {
    if (options?.onEnd) options.onEnd();
  }, 1000);
  return false;
}

export function stopAuraSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    activeUtterance = null;
  }
}

export function isAuraSpeaking(): boolean {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return window.speechSynthesis.speaking;
  }
  return false;
}

function playFallbackSynthChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Audio context may be restricted before user interaction
  }
}
