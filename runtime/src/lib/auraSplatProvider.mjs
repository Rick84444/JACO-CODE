// Experimental, operator-provisioned Avatarz adapter. Never loads remote URLs or
// controls the canonical audio player, microphone, chat, or mission.
const ROOT = '/aura-splat/';
export function presentationState(state) {
  return state.speaking ? 'speaking' : state.listening ? 'listening' : state.active ? 'thinking' : 'idle';
}
export async function createAuraSplatProvider(canvas, {signal, onError = () => {}, loadModule = () => {
  const path = ROOT + 'avatarz.js';
  return import(/* @vite-ignore */ path);
}, AudioContextClass = globalThis.AudioContext, doc = globalThis.document,
  reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true} = {}) {
  if (signal?.aborted || reducedMotion()) throw new Error('SPLAT_DISABLED');
  if (!AudioContextClass) throw new Error('SPLAT_AUDIO_UNAVAILABLE');
  const mod = await loadModule();
  if (signal?.aborted) throw new Error('SPLAT_ABORTED');
  if (typeof mod.createTalkingHead !== 'function' || typeof mod.SplatRenderer !== 'function') throw new Error('SPLAT_MODULE_INVALID');
  const context = new AudioContextClass();
  const gain = context.createGain();
  // Explicit destination:null prevents Avatarz from routing speech a second time.
  let renderer, head, source, stream, disposed = false;
  const state = {active:false,speaking:false,listening:false};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    doc?.removeEventListener('visibilitychange', visibility);
    try { source?.disconnect(); } catch {}
    try { gain.disconnect(); } catch {}
    try { if (head) head.dispose(); else renderer?.dispose(); } catch {}
    // Never stop the upstream MediaStream tracks: they belong to the audio player.
    void Promise.resolve(context.close()).catch(() => {});
  };
  const visibility = () => {
    if (disposed || !head) return;
    if (doc?.hidden) head.pause(); else head.resume();
  };
  signal?.addEventListener('abort', dispose, {once:true});
  try {
    renderer = new mod.SplatRenderer({backgroundColor:'0x030810', finish:false, pixelRatioCap:1});
    head = await mod.createTalkingHead({context,source:gain,canvas,avatarUrl:ROOT+'head.zip',
      renderer,extractor:'formant',fallback:false,destination:null,delay:0,autoEmotion:false});
    if (disposed || signal?.aborted) {
      // Upstream initialization cannot be cancelled; a late completion must also be disposed.
      head.dispose();
      throw new Error('SPLAT_ABORTED');
    }
    doc?.addEventListener('visibilitychange', visibility);
    visibility();
    return {
      setState(patch) {
        if (disposed) return;
        Object.assign(state,patch);
        head.setState(presentationState(state));
        if (!Object.hasOwn(patch,'audioSource') || patch.audioSource === stream) return;
        try { source?.disconnect(); } catch {}
        source = null; stream = patch.audioSource ?? null;
        if (!stream) { head.cut(); return; }
        try {
          source = context.createMediaStreamSource(stream);
          source.connect(gain);
          if (context.state === 'suspended') void context.resume().catch(onError);
        } catch (error) { stream = null; onError(error); }
      },
      dispose
    };
  } catch (error) { dispose(); throw error; }
}
