import * as THREE from 'three';
import {createSecondaryMotion,contactShadow} from './auraSecondaryMotion.mjs';
const HAIR=['HairFrontSway','HairBackSway','HairSideSway'];
export function createSecondaryRig(scene,model,bones){
  const motion=createSecondaryMotion();
  const hair=[];const textiles=new Set();
  model.traverse(o=>{
    if(o.isSkinnedMesh&&HAIR.every(n=>n in (o.morphTargetDictionary||{})))hair.push(o);
    if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material])){
      if(m&&['Aura suit / technical_textile','Aura suit / reinforced_textile'].includes(m.name))textiles.add(m);
    }
  });
  const bases=[...textiles].map(m=>({m,roughness:m.roughness}));
  // A deliberately inexpensive ground-contact cue, not a ray-traced shadow or reflection.
  const geo=new THREE.PlaneGeometry(.31,.44);
  const shadows=['LeftFoot','RightFoot'].map(name=>{
    const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{opacity:{value:0}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv;uniform float opacity;void main(){float r=length((vUv-.5)*2.0);float a=pow(max(0.0,1.0-r),2.0)*opacity;gl_FragColor=vec4(0.0,0.0,0.0,a);}'});
    const mesh=new THREE.Mesh(geo,mat);mesh.rotation.x=-Math.PI/2;mesh.visible=false;scene.add(mesh);
    return {entry:bones.get(name),mesh,mat};
  });
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshStandardMaterial({color:0x10141b,metalness:.18,roughness:.72,transparent:true,opacity:.0,depthWrite:false}));
  floor.rotation.x=-Math.PI/2;floor.position.y=.008;floor.visible=false;scene.add(floor);
  const position=new THREE.Vector3(),euler=new THREE.Euler(),q=new THREE.Quaternion();
  return {update(input,dt,reduced){
    const p=motion.update(input,dt,reduced);
    for(let i=0;i<4;i++){
      const entry=bones.get(i?'Ponytail'+i:'PonytailRoot');
      if(entry)entry.bone.quaternion.copy(entry.base).multiply(q.setFromEuler(euler.set(p.pitch[i],p.yaw[i],0,'YXZ')));
    }
    // Signed weights are supported by glTF; retain the authored rest pose at zero.
    for(const o of hair)for(let i=0;i<3;i++)o.morphTargetInfluences[o.morphTargetDictionary[HAIR[i]]]=[p.front,p.back,p.side][i];
    for(const {m,roughness} of bases)m.roughness=Math.min(1,Math.max(0,roughness-p.fabric*.055));
    const wide=reduced?0:Math.min(1,Math.max(0,input.wide||0));
    floor.visible=wide>.01;floor.material.opacity=wide*.86;
    model.updateMatrixWorld(true);
    shadows.forEach(({entry,mesh,mat},i)=>{
      if(!entry||wide<.01){mesh.visible=false;return;}
      entry.bone.getWorldPosition(position);
      const h=contactShadow(i?input.rightLift:input.leftLift);
      mesh.visible=true;mesh.position.set(position.x,.010,position.z);
      mesh.scale.setScalar(h.scale);mat.uniforms.opacity.value=h.opacity*wide;
    });
    return {hairMeshes:hair.length,textileMaterials:bases.length,front:p.front,back:p.back,side:p.side,ground:floor.visible};
  },dispose(){
    for(const {m,roughness} of bases)m.roughness=roughness;
    scene.remove(floor,...shadows.map(x=>x.mesh));floor.geometry.dispose();floor.material.dispose();geo.dispose();for(const x of shadows)x.mat.dispose();
  }};
}
