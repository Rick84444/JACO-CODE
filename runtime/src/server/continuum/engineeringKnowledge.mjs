// Versioned source-controlled engineering references, not executable skills.
// Never auto-promote a candidate, overwrite a local revision or assert external evidence.
const revision='6cf964eaa1fc7322b6a0e5cd6bae00a4e390f528';
const source='https://github.com/Rick84444/JACO-CODE/tree/'+revision+'/runtime/';
function item(id,purpose,modules,dependencies,failureModes,reasoningSummary,verification){
 return {id:'engineering_3d_'+id+'_v1',kind:'engineering-reference-candidate',purpose,confidence:0,reusable:false,
  usedIn:['Aura V31','JACO PR #419'],dependencies,failureModes,reasoningSummary,
  verificationStatus:'UNVERIFIED',
  implementation:{sourceRevision:revision,files:modules.map(p=>({path:'runtime/'+p,url:source+p})),verification,
    usage:'Inspect and adapt to the target rig and renderer; rerun tests and obtain independent evidence before promotion.'},
  metrics:{scope:'reference only',runtimeVerified:false}};
}
export const ENGINEERING_KNOWLEDGE=Object.freeze([
 item('rig','3D avatar / GLB glTF skeletal rig and morph target validation; skelett, ansiktsrigg, modellimport',
 ['scripts/install-aura-v31.mjs','scripts/inspect-aura-v31.mjs','src/lib/auraRigLightform.mjs'],
 ['glTF 2.0','Three.js','skinned mesh','morph targets'],['missing asset','different skeleton or scale','mismatched morph names'],
 'Validate file identity, actual named joints and nonzero morphs. Keep rig-specific names out of a generic retargeting contract.','Original V31 binary not present in GitHub CI; local model acceptance pending.'),
 item('surface','3D photorealistic material optics, skin, hair, eyes, oral surfaces, reflections; hud, hår, ljus, golv',
 ['src/lib/auraOptics.mjs','src/lib/auraSurfaceDetail.mjs','src/lib/auraV31OpticalRig.mjs','src/lib/auraStudioFloor.mjs'],
 ['Three.js r186','WebGL','PBR','PMREM'],['atlas-specific UV coordinates','shader anchor drift','GPU frame budget'],
 'Reuse the material pipeline and quality gates, not V31-specific texture masks. Wrapped diffuse is not physical subsurface scattering.','Synthetic WebGL fixture compiled; actual model visual acceptance pending.'),
 item('motion','3D character animation, inverse kinematics, full body motion, gaze, secondary hair; rörelser, kroppsspråk, blick',
 ['src/lib/auraBodyMotion.mjs','src/lib/auraBodyRig.mjs','src/lib/auraHumanBehavior.mjs','src/lib/auraSecondaryMotion.mjs','src/lib/auraSecondaryRig.mjs'],
 ['Three.js','two-bone IK','skeletal hierarchy'],['different rest pose','unreachable target','foot sliding','reduced motion'],
 'Separate procedural intent, body solver and secondary motion. Calibrate joint axes and physical dimensions for each character.','Controller tests passed historically; actual deformation and grounding not accepted.'),
 item('speech','3D audio-clock lip sync, visemes, coarticulation, speech animation; läppsynk, tal',
 ['src/lib/auraSpeechTimeline.mjs','src/lib/auraSpeechAnalysis.mjs','src/lib/auraSpeechClassifier.mjs','src/lib/auraSpeechWorker.mjs'],
 ['HeadAudio MIT code','16 kHz PCM','Web Audio','14 visemes'],['language accuracy','late analysis','missing morphs','browser speech fallback'],
 'Keep animation subordinate to actual audio playback. Preserve local fallback and verify language-specific accuracy.','Directed timing tests passed historically; Swedish accuracy and training model provenance review pending.'),
 item('neural_face','3D neural face animation, NVIDIA Audio2Face, named blendshape retargeting, GPU fallback; ansiktsanimation',
 ['native/audio2face/README.md','native/audio2face/main.cpp','src/lib/auraNeuralFace.mjs','src/lib/auraNeuralFaceClient.mjs','src/server/auraNeuralFaceHost.mjs'],
 ['NVIDIA Audio2Face SDK MIT','separate model license','CUDA','TensorRT','HeadAudio'],['no compatible GPU','native build failure','cold startup','unmapped poses'],
 'Retarget named weights using the audio clock and a bounded blend. Do not copy model-specific geometry or assume inference availability.','JS adapter tests and synthetic process contracts; native SDK build and GPU inference NOT verified.'),
 item('presentation','3D LLM-driven avatar presentation, speech-aligned expression and gestures; språkmodell, presentation',
 ['src/lib/auraPerformance.mjs','src/lib/workspaceActions.mjs','src/components/AuraPortrait.tsx','operator-stage/stage.js'],
 ['provider-neutral LLM','TTS','closed cue allowlist'],['stale replies','duplicate playback','fenced examples','speech unavailable'],
 'Treat model-authored cues as transient presentation metadata, never tool grants. Keep the existing runtime as the sole authority.','Cue contracts tested; real provider and full-duplex streaming acceptance pending.')
]);
export function seedEngineeringKnowledge(store){
 const added=[];
 for(const candidate of ENGINEERING_KNOWLEDGE){
  try{store.get(candidate.id);continue;}catch(e){if(!String(e?.message||e).includes('not found'))throw e;}
  added.push(store.put(candidate,'engineering-reference-import').id);
 }
 return added;
}
