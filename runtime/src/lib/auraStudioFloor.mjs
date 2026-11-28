import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
export function reflectionAllowed(wide,quality,mobile,capable){
  return !mobile&&capable&&Number.isFinite(wide)&&wide>.60&&quality>.5;
}
const SHADER={
  name:'AuraStudioFloor',
  uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null},uOpacity:{value:1}},
  vertexShader:Reflector.ReflectorShader.vertexShader,
  fragmentShader:`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uOpacity;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      vec2 uv=vUv.xy/vUv.w;
      vec2 d=vec2(0.005,0.005);
      vec3 r=texture2D(tDiffuse,uv).rgb*.40;
      r+=(texture2D(tDiffuse,uv+vec2(d.x,0.0)).rgb+texture2D(tDiffuse,uv-vec2(d.x,0.0)).rgb+texture2D(tDiffuse,uv+vec2(0.0,d.y)).rgb+texture2D(tDiffuse,uv-vec2(0.0,d.y)).rgb)*.15;
      gl_FragColor=vec4(color+r*.23,uOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
};
export function createStudioReflection(scene,renderer,mobile){
  const capable=!mobile&&Boolean(renderer.extensions.has('EXT_color_buffer_float'));
  let floor=null;
  return {
    update(wide,quality){
      const on=reflectionAllowed(wide,quality,mobile,capable);
      if(on&&!floor){
        floor=new Reflector(new THREE.PlaneGeometry(4,4),{textureWidth:256,textureHeight:256,multisample:0,clipBias:.001,color:0x10141b,shader:SHADER});
        floor.rotation.x=-Math.PI/2;floor.position.y=.008;
        floor.material.transparent=true;floor.material.depthWrite=true;scene.add(floor);
      }
      if(floor){floor.visible=on;floor.material.uniforms.uOpacity.value=wide*.94;}
      return on;
    },
    get renderTarget(){return floor?.getRenderTarget()||null;},
    dispose(){if(floor){scene.remove(floor);floor.geometry.dispose();floor.dispose();floor=null;}}
  };
}
