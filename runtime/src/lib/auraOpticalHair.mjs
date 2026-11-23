import * as THREE from 'three';

function createRibbonBaseGeometry(segments = 14) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const v = i / segments;
    positions.push(-0.5, v, 0, 0.5, v, 0);
    uvs.push(0, v, 1, v);
    if (i < segments) {
      const row = i * 2;
      indices.push(row, row + 1, row + 2, row + 1, row + 3, row + 2);
    }
  }
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  base.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  base.setIndex(indices);
  return base;
}

export function createOpticalHairRig({
  strandCount = 320,
  headRadius = 1.0,
  headAxes = [headRadius, headRadius, headRadius],
  crownCenter = [0, 0.08, -0.05],
  strandLength = 2.35,
} = {}) {
  const base = createRibbonBaseGeometry(14);
  const geom = new THREE.InstancedBufferGeometry();
  geom.index = base.index;
  geom.attributes.position = base.attributes.position;
  geom.attributes.uv = base.attributes.uv;
  geom.instanceCount = strandCount;

  const rootPos = new Float32Array(strandCount * 3);
  const rootDir = new Float32Array(strandCount * 3);
  const params = new Float32Array(strandCount * 4);
  const layers = new Float32Array(strandCount);
  let rng = 133791;
  const rand = () => {
    rng = (rng * 16807) % 2147483647;
    return (rng - 1) / 2147483646;
  };

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const [cx, cy, cz] = crownCenter;

  for (let i = 0; i < strandCount; i++) {
    const u = (i + 0.5) / strandCount;
    const layer = i < strandCount * 0.22 ? 0.0 : i < strandCount * 0.78 ? 0.5 : 1.0;
    const theta = i * GOLDEN_ANGLE + (rand() - 0.5) * 0.28;
    const polar = Math.acos(1 - u * 0.88);
    let sx = Math.sin(polar) * Math.cos(theta);
    let sy = Math.cos(polar);
    let sz = Math.sin(polar) * Math.sin(theta);
    if (sz > 0.35 && sy < 0.72) {
      const push = (sz - 0.35) * 1.15;
      sx += (sx >= 0 ? 1 : -1) * push;
      sz -= push * 0.65;
    }

    const n = new THREE.Vector3(sx, sy, sz).normalize();
    const lift = headRadius * (0.985 + layer * 0.045 + (rand() - 0.5) * 0.025);
    const rx = cx + n.x * lift * headAxes[0]/headRadius;
    const ry = cy + n.y * lift * headAxes[1]/headRadius;
    const rz = cz + n.z * lift * headAxes[2]/headRadius;

    rootPos[i * 3] = rx;
    rootPos[i * 3 + 1] = ry;
    rootPos[i * 3 + 2] = rz;
    const sideSign = n.x >= -0.08 ? 1 : -1;
    const dir = new THREE.Vector3(
      n.x * 0.65 + sideSign * (0.28 + rand() * 0.22),
      0.24 + n.y * 0.38 - (1 - n.y) * 0.25,
      n.z * 0.55 - 0.22 - rand() * 0.25
    ).normalize();

    rootDir[i * 3] = dir.x;
    rootDir[i * 3 + 1] = dir.y;
    rootDir[i * 3 + 2] = dir.z;
    const frontFactor = THREE.MathUtils.clamp(1.0 - Math.max(0, n.z) * 0.42, 0.55, 1.05);
    const len = headRadius * strandLength * frontFactor * (0.72 + rand() * 0.48) * (layer === 1.0 ? 1.08 : 1.0);
    const width = headRadius * (layer === 1.0 ? 0.022 + rand() * 0.014 : 0.048 + rand() * 0.032);
    const curlAmp = headRadius * (0.045 + rand() * 0.075) * (0.7 + layer * 0.6);

    params[i * 4] = len;
    params[i * 4 + 1] = width;
    params[i * 4 + 2] = curlAmp;
    params[i * 4 + 3] = rand() * Math.PI * 2;
    layers[i] = layer;
  }

  geom.setAttribute('aRootPos', new THREE.InstancedBufferAttribute(rootPos, 3));
  geom.setAttribute('aRootDir', new THREE.InstancedBufferAttribute(rootDir, 3));
  geom.setAttribute('aStrandParams', new THREE.InstancedBufferAttribute(params, 4));
  geom.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layers, 1));

  const uniforms = {
    uTime: { value: 0 },
    uSpeaking: { value: 0 },
    uAuraFade: { value: 1 },
    uHeadVel: { value: new THREE.Vector3() },
    uHeadRadius: { value: headRadius },
    uHeadAxes: { value: new THREE.Vector3(...headAxes) },
    uCrownCenter: { value: new THREE.Vector3(...crownCenter) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aRootPos;
      attribute vec3 aRootDir;
      attribute vec4 aStrandParams;
      attribute float aLayer;

      uniform float uTime;
      uniform float uSpeaking;
      uniform vec3 uHeadVel;
      uniform float uHeadRadius;
      uniform vec3 uHeadAxes;
      uniform vec3 uCrownCenter;

      varying vec2 vUv;
      varying float vLayer;
      varying float vSeed;
      varying vec3 vMvTangent;
      varying vec3 vMvViewDir;

      vec3 evalStrand(float s) {
        float len = aStrandParams.x;
        float curl = aStrandParams.z;
        float seed = aStrandParams.w;
        vec3 gravity = vec3(0.0, -1.0, -0.14);
        float drape = s * s;
        vec3 p = aRootPos + aRootDir * (s * len * 0.42) + gravity * (drape * len * 0.88);
        vec3 rel = p - uCrownCenter;
        float dist = length(rel / uHeadAxes);
        float minR = (1.005 + aLayer * 0.025);
        if (dist < minR && dist > 0.0001) {
          p = uCrownCenter + rel * (minR / dist);
        }
        float phase = uTime * 6.2831853 * 0.14;
        float sway1 = sin(phase + seed + s * 3.4);
        float sway2 = cos(phase * 1.618 + seed * 1.7 - s * 5.2);
        float speakMicro = sin(uTime * 7.5 + seed * 3.0 + s * 6.0) * uSpeaking * 0.012 * uHeadRadius;
        float flex = s * s;
        p.x += (sin(s * 5.5 + seed) * curl + (sway1 * 0.032 + sway2 * 0.014) * uHeadRadius * (0.6 + aLayer)) * flex + speakMicro * flex;
        p.z += (cos(s * 4.8 + seed * 1.3) * curl * 0.75 + sway2 * 0.022 * uHeadRadius * (0.5 + aLayer)) * flex;
        p += vec3(-uHeadVel.x, -uHeadVel.y * 0.7, uHeadVel.z) * flex * (0.35 + 0.45 * aLayer) * uHeadRadius;
        return p;
      }

      void main() {
        vUv = uv;
        vLayer = aLayer;
        vSeed = aStrandParams.w;

        float s = uv.y;
        vec3 center = evalStrand(s);
        vec3 ahead = evalStrand(min(1.0, s + 0.03));
        vec3 behind = evalStrand(max(0.0, s - 0.03));
        vec3 localTan = normalize(ahead - behind);

        vec4 mvCenter = modelViewMatrix * vec4(center, 1.0);
        vec3 mvTan = normalize((modelViewMatrix * vec4(localTan, 0.0)).xyz);
        vec3 mvView = normalize(-mvCenter.xyz);
        vec3 rawSide = cross(mvTan, mvView);
        vec3 mvSide = length(rawSide) > 0.0001 ? normalize(rawSide) : vec3(1.0, 0.0, 0.0);
        float taper = smoothstep(0.0, 0.10, s) * pow(max(0.0, 1.0 - s), 0.72);
        float halfW = aStrandParams.y * taper;

        mvCenter.xyz += mvSide * (position.x * halfW);
        vMvTangent = mvTan;
        vMvViewDir = mvView;

        gl_Position = projectionMatrix * mvCenter;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSpeaking;
      uniform float uAuraFade;

      varying vec2 vUv;
      varying float vLayer;
      varying float vSeed;
      varying vec3 vMvTangent;
      varying vec3 vMvViewDir;

      float hash12(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        float x = vUv.x;
        float s = vUv.y;
        float freq = 5.0 + floor(fract(vSeed * 3.17) * 3.0);
        float fiberWave = 0.5 + 0.5 * sin((x * freq + sin(s * 5.0 + vSeed) * 0.18) * 6.2831853);
        float edgeMask = smoothstep(0.0, 0.18, x) * (1.0 - smoothstep(0.82, 1.0, x));
        float fiberMask = smoothstep(0.24, 0.76, fiberWave) * edgeMask;
        float rootFade = smoothstep(0.0, 0.16, s);
        float tipFade = 1.0 - smoothstep(0.58, 1.0, s);
        vec3 T = normalize(vMvTangent);
        vec3 V = normalize(vMvViewDir);
        vec3 L = normalize(vec3(0.32, 0.78, 0.54));
        vec3 H = normalize(L + V);

        float dotTH = dot(T, H);
        float sinTH = sqrt(max(0.0, 1.0 - dotTH * dotTH));
        float primarySheen = pow(sinTH, 26.0) * 0.55;
        float secondarySheen = pow(sinTH, 8.0) * 0.20;
        float rim = pow(clamp(1.0 - abs(dot(T, V)), 0.0, 1.0), 2.2);
        vec3 deepTone = vec3(0.11, 0.18, 0.27);
        vec3 midTone = vec3(0.38, 0.50, 0.64);
        vec3 sheenTone = vec3(0.84, 0.90, 0.97);
        vec3 speakTint = vec3(0.72, 0.79, 0.89) * uSpeaking * 0.12;

        vec3 col = mix(deepTone, midTone, 0.25 + 0.55 * s + 0.2 * vLayer);
        col += sheenTone * (primarySheen + secondarySheen * rim);
        col += speakTint * (0.4 + 0.6 * s);
        float grain = hash12(gl_FragCoord.xy) - 0.5;
        col *= (1.0 + 0.02 * grain);

        float layerDensity = vLayer < 0.25 ? 0.52 : (vLayer < 0.75 ? 0.64 : 0.42);
        float resolved = 1.0 - smoothstep(0.2, 0.75, fwidth(x) * freq);
        float coverage = mix(edgeMask * 0.55, fiberMask, resolved);
        float alpha = coverage * rootFade * tipFade * layerDensity * uAuraFade;
        if (alpha < 0.015) discard;

        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
      }
    `,
  });

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;

  const prevEuler = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const smoothVel = new THREE.Vector3();

  return {
    mesh,
    update(t, dt, { yaw = 0, pitch = 0, roll = 0, speaking = 0, auraFade = 1 } = {}) {
      const safeDt = Math.max(0.008, Math.min(0.05, dt || 0.016));
      const rawVx = THREE.MathUtils.clamp((yaw - prevEuler.x) / safeDt, -2.5, 2.5);
      const rawVy = THREE.MathUtils.clamp((pitch - prevEuler.y) / safeDt, -2.5, 2.5);
      const rawVz = THREE.MathUtils.clamp((roll - prevEuler.z) / safeDt, -2.5, 2.5);
      prevEuler.set(yaw, pitch, roll);
      const damp = 1 - Math.exp(-5.5 * safeDt);
      smoothVel.lerp(velocity.set(rawVx, rawVy, rawVz), damp);

      uniforms.uTime.value = t;
      uniforms.uSpeaking.value = speaking;
      uniforms.uAuraFade.value = auraFade;
      uniforms.uHeadVel.value.copy(smoothVel);
    },
    dispose() {
      base.dispose();
      geom.dispose();
      material.dispose();
    },
  };
}
