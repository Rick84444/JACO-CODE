// Aura seen whole: how the textured figure is lit, what she stands on and how the camera frames both.
import * as THREE from 'three';

/**
 * The model's textures are photographs that carry their own light and shade. Strong directional light washed them
 * out, so the light is low and mostly even, with a little shape from the front and a blue edge from behind.
 */
export function createFigureLights() {
  const ambient = new THREE.AmbientLight(0xe8efff, 1.65);
  const key = new THREE.DirectionalLight(0xfff4e8, .7); key.position.set(-2, 3, 4);
  const rim = new THREE.DirectionalLight(0x9fd4ff, .55); rim.position.set(1.5, 2, -3);
  return [ambient, key, rim];
}

/**
 * Keeps the photographed surfaces visible: a fully metallic surface with nothing to mirror turns dark and hides its
 * texture, and the platinum hair turns grey under soft light. Changes the loaded materials only, never the file.
 */
export function preparePhotoMaterials(model) {
  model.traverse(object => {
    for (const material of [object.material].flat()) {
      if (!material?.map || material.userData.photoPrepared) continue;
      material.userData.photoPrepared = true;
      if (material.metalness > 0) material.metalness *= .25;
      if (/hair/i.test(material.name) && material.emissive) {
        material.emissiveMap = material.map;
        material.emissive.setHex(0x1f1b15);
      }
      material.needsUpdate = true;
    }
  });
}

const STAND_RADIUS = .5, STAND_DEPTH = .06;

const planeVertex = 'varying vec2 vPlane;void main(){vec4 world=modelMatrix*vec4(position,1.0);vPlane=world.xz;gl_Position=projectionMatrix*viewMatrix*world;}';
const topFragment = `uniform vec2 uFeet[2];uniform vec2 uCentre;uniform float uRadius;uniform float uGlow;varying vec2 vPlane;
void main(){
  float r=length(vPlane-uCentre)/uRadius;
  vec3 surface=mix(vec3(.055,.10,.155),vec3(.025,.045,.075),r);
  float rings=smoothstep(.010,0.0,abs(r-.46))*.22+smoothstep(.012,0.0,abs(r-.74))*.38+smoothstep(.045,0.0,abs(r-.95))*.75;
  vec3 light=(vec3(.25,.72,1.0)*rings+vec3(.10,.32,.55)*pow(r,5.0)*.35)*uGlow;
  float shade=0.0;
  for(int i=0;i<2;i++){vec2 d=(vPlane-uFeet[i])/vec2(.085,.15);shade=max(shade,exp(-dot(d,d)));}
  gl_FragColor=vec4((surface+light)*(1.0-.8*shade),1.0);
}`;
const haloFragment = `uniform vec2 uCentre;uniform float uRadius;uniform float uGlow;varying vec2 vPlane;
void main(){
  float r=length(vPlane-uCentre)/uRadius;
  float a=smoothstep(1.0,.62,r)*.42*uGlow;
  gl_FragColor=vec4(.20,.60,1.0,a);
}`;

/**
 * The base she stands on: a low dark disc with lit rings, soft shade under each boot and a glow around it.
 * @param {{floor:number, centre:{x:number,z:number}, feet:Array<{x:number,z:number}>, radius?:number}} options
 */
export function createStand({ floor, centre, feet, radius = STAND_RADIUS }) {
  const group = new THREE.Group();
  const glow = { value: .9 };
  const under = feet.length ? feet : [centre];
  const shared = () => ({ uCentre: { value: new THREE.Vector2(centre.x, centre.z) }, uGlow: glow });
  const add = (geometry, material, y) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centre.x, y, centre.z);
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  // The shade follows the boots, which reach forward of the ankle bones.
  const shade = [0, 1].map(i => { const f = under[Math.min(i, under.length - 1)]; return new THREE.Vector2(f.x, f.z + .05); });
  add(new THREE.CircleGeometry(radius, 96), new THREE.ShaderMaterial({
    vertexShader: planeVertex, fragmentShader: topFragment, uniforms: { ...shared(), uRadius: { value: radius }, uFeet: { value: shade } },
  }), floor - .002).rotation.x = -Math.PI / 2;
  add(new THREE.CylinderGeometry(radius, radius * 1.03, STAND_DEPTH, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0x0c1a2e }), floor - .002 - STAND_DEPTH / 2);
  add(new THREE.TorusGeometry(radius, .0035, 8, 128), new THREE.MeshBasicMaterial({ color: 0x4fb4ff }), floor - .002).rotation.x = Math.PI / 2;
  add(new THREE.CircleGeometry(radius * 1.35, 96), new THREE.ShaderMaterial({
    vertexShader: planeVertex, fragmentShader: haloFragment, uniforms: { ...shared(), uRadius: { value: radius * 1.35 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), floor - STAND_DEPTH).rotation.x = -Math.PI / 2;

  return {
    group,
    /** Where the stand ends toward the camera, for framing. */
    edge: { y: floor - STAND_DEPTH, z: centre.z + radius, radius, x: centre.x, centreZ: centre.z },
    /** The rings breathe slowly and brighten while she is active. */
    update(seconds, energy = 0) { glow.value = .85 + .05 * Math.sin(seconds * 1.1) + .35 * Math.min(1, Math.max(0, energy)); },
    dispose() {
      for (const mesh of group.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
      group.removeFromParent();
    },
  };
}

/**
 * Where a level camera must stand so every point is in view, as close as possible.
 * @returns {{y:number, z:number}} its height and distance along +z; it looks straight along -z from there.
 */
export function frameFigure({ points, aspect, fovDeg, centreX = 0, margin = 1.04 }) {
  const half = Math.tan(fovDeg * Math.PI / 360), wide = half * Math.max(aspect, .05);
  const sideways = Math.max(...points.map(p => p.z + margin * Math.abs(p.x - centreX) / wide));
  // The highest and the lowest demands meet at one camera height; that height needs the shortest distance.
  const upper = Math.max(...points.map(p => p.z + margin * p.y / half));
  const lower = Math.max(...points.map(p => p.z - margin * p.y / half));
  const vertical = (upper + lower) / 2;
  const y = (upper - lower) * half / (2 * margin);
  return { y, z: Math.max(vertical, sideways) };
}
