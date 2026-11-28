// Calibrated against the two pupil islands in V31's original 1024px eye atlas.
// glTF's UV origin is the texture's upper-left; GLTFLoader sets flipY=false.
export const EYE_ATLAS=Object.freeze({
  centers:Object.freeze([Object.freeze([.70753,.29754]),Object.freeze([.29175,.70956])]),
  pupil:.0393,iris:.108
});
const clamp=(v,a,b)=>Number.isFinite(v)?Math.max(a,Math.min(b,v)):a;
export function pupilScaleForLight(light){
  // Relative illuminance proxy from the authored key/fill rig, not a medical model.
  return 1.28-.52*Math.sqrt(clamp(light,0,1));
}
export function approachPupil(current,target,dt){
  current=clamp(current,.76,1.28);target=clamp(target,.76,1.28);
  return current+(target-current)*(-Math.expm1(-clamp(dt,0,.1)/(target<current?.32:1.05)));
}
export function remapEyeRadius(radius,scale){
  const {pupil,iris}=EYE_ATLAS;
  const r=clamp(radius,0,10),p=pupil*clamp(scale,.76,1.28);
  if(r>=iris)return r;
  return r<p?r*pupil/p:pupil+(r-p)*(iris-pupil)/(iris-p);
}
export function materialRole(name){
  if(name==='Human.body')return 'skin';
  if(name==='Human.high-poly')return 'eyes';
  if(name==='Human.teeth_base')return 'teeth';
  if(name==='Human.tongue01')return 'tongue';
  return 'authored';
}
// The key comes from a moderate height so brows, cheekbones and chin do not cast hard hollows; a low frontal fill
// lifts the eyes and the underside of the chin (operator 2026-11-28). Positions are metres around the figure.
export const STUDIO_LIGHT=Object.freeze({key:1.6,fill:1.1,front:1.0,rim:1.1,ambient:1.0,environment:.72,exposure:1.0,lightProxy:.5,
  positions:Object.freeze({key:Object.freeze([-.8,2.55,2.1]),fill:Object.freeze([1.3,1.75,1.4]),front:Object.freeze([0,1.45,2.4]),rim:Object.freeze([-.65,2.1,-.8])})});
