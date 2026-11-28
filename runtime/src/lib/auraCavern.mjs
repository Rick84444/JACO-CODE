import * as THREE from 'three';

export function seededCavern(seed=7124) {
  let s=seed>>>0;
  return ()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
}

// CPU-side deterministic layout, independently testable. Distances are in metres.
export function cavernLayout(mobile=false) {
  const rand=seededCavern(), crystals=[], dust=[];
  const count=mobile?28:52;
  for(let i=0;i<count;i++){
    const side=i%2?1:-1,z=2.2-rand()*19;
    const height=.3+rand()*1.9;
    crystals.push({x:side*(1.55+rand()*2.2),z,height,width:.09+rand()*.32,tilt:side*(rand()-.5)*.65,turn:rand()*Math.PI});
  }
  for(let i=0;i<(mobile?96:220);i++)dust.push([(rand()-.5)*7,.25+rand()*4,2-rand()*20]);
  return {crystals,dust};
}

// Render work time, not invented GPU/CPU telemetry. Hysteresis prevents quality oscillation.
export function cavernGovernor(mobile=false) {
  let average=0,slow=0,fast=0,tier=mobile?1:2;
  const ceiling=tier;
  return {
    observe(ms) {
      if(!Number.isFinite(ms)||ms<0)return;
      average=average?average*.9+Math.min(ms,250)*.1:Math.min(ms,250);
      if(average>26){slow++;fast=0;if(slow>=10){tier=Math.max(0,tier-1);slow=0;}}
      else if(average<13){fast++;slow=0;if(fast>=90){tier=Math.min(ceiling,tier+1);fast=0;}}
      else{slow=0;fast=0;}
    },
    settings(busy=false){
      const level=busy?Math.min(tier,1):tier;
      return {fps:[15,18,24][level],dpr:[.70,.90,1.15][level],tier:level};
    }
  };
}

export function createIceCavern(scene,mobile=false) {
  const group=new THREE.Group(),owned=[];
  const own=x=>(owned.push(x),x);
  const oldFog=scene.fog,oldBackground=scene.background;
  scene.background=new THREE.Color(0x02090e);
  scene.fog=new THREE.FogExp2(0x04151d,.092);
  const rand=seededCavern(412),pos=[],col=[];
  const ringCount=mobile?16:24,segments=mobile?10:16,grid=[];
  const shades=[0x06121d,0x0b2533,0x12374a,0x17475b].map(c=>new THREE.Color(c));
  for(let i=0;i<=ringCount;i++){
    const ring=[],z=4-i*26/ringCount;
    for(let j=0;j<=segments;j++){
      const a=j*Math.PI/segments,radius=3.0+.5*Math.sin(i*.65)+rand()*.65;
      ring.push([Math.cos(a)*radius,Math.sin(a)*(3.4+rand()*.8)-.09,z+(rand()-.5)*.42]);
    }
    grid.push(ring);
  }
  const triangle=(a,b,c)=>{
    const tone=shades[Math.min(3,Math.floor(rand()*rand()*4))];
    for(const v of [a,b,c]){pos.push(...v);col.push(tone.r,tone.g,tone.b);}
  };
  for(let i=0;i<ringCount;i++)for(let j=0;j<segments;j++){
    const a=grid[i][j],b=grid[i+1][j],c=grid[i+1][j+1],d=grid[i][j+1];
    triangle(a,b,c);triangle(a,c,d);
  }
  const walls=own(new THREE.BufferGeometry());
  walls.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  walls.setAttribute('color',new THREE.Float32BufferAttribute(col,3));walls.computeVertexNormals();
  group.add(new THREE.Mesh(walls,own(new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}))));
  // Baked glints on a real floor plane; no live mirror or extra render pass.
  const floorGeo=own(new THREE.PlaneGeometry(10,30,1,1));
  const floorMat=own(new THREE.ShaderMaterial({
    uniforms:{},
    vertexShader:`varying vec3 w;void main(){w=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}`,
    fragmentShader:`varying vec3 w;
      void main(){
        float z=w.z,x=w.x;
        float stripes=pow(max(0.,sin(x*15.+sin(z*1.6)*2.)),12.);
        float cracks=pow(max(0.,sin(z*8.+sin(x*3.)*2.)),32.);
        float glow=exp(-abs(x)*1.6)*(.35+.65*exp(-abs(z+5.)*.18));
        float scatter=.5+.5*sin(z*17.+sin(x*9.)*5.);
        vec3 c=vec3(.008,.025,.04)+vec3(.03,.22,.29)*(glow*.42+stripes*glow*scatter*.24+cracks*.12);
        c=mix(c,vec3(.008,.028,.04),1.-exp(-abs(z)*.07));
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
      }`
  }));
  const floor=new THREE.Mesh(floorGeo,floorMat);
  floor.rotation.x=-Math.PI/2;floor.position.set(0,-.045,-8);group.add(floor);
  const {crystals,dust}=cavernLayout(mobile);
  // Two instanced meshes for crystal shafts and tips, with no shadows or reflection probes.
  const shaft=own(new THREE.CylinderGeometry(.66,1,1,5,1));
  const tip=own(new THREE.ConeGeometry(.66,.65,5,1));
  const crystalMat=own(new THREE.MeshStandardMaterial({color:0xffffff,emissive:0x12586f,emissiveIntensity:.8,roughness:.28,metalness:.18,flatShading:true}));
  const shafts=new THREE.InstancedMesh(shaft,crystalMat,crystals.length);
  const tips=new THREE.InstancedMesh(tip,crystalMat,crystals.length);
  const transform=new THREE.Object3D(),axis=new THREE.Vector3(),q=new THREE.Quaternion();
  crystals.forEach((c,i)=>{
    transform.rotation.set(0,c.turn,c.tilt);q.copy(transform.quaternion);
    axis.set(0,1,0).applyQuaternion(q);
    transform.scale.set(c.width,c.height,c.width);transform.position.set(c.x,0,c.z).addScaledVector(axis,c.height*.5);transform.updateMatrix();shafts.setMatrixAt(i,transform.matrix);
    transform.scale.set(c.width,c.height,c.width);transform.position.set(c.x,0,c.z).addScaledVector(axis,c.height*1.325);transform.updateMatrix();tips.setMatrixAt(i,transform.matrix);
    const color=new THREE.Color().setHSL(.52+rand()*.035,.55+rand()*.28,.36+rand()*.26);shafts.setColorAt(i,color);tips.setColorAt(i,color);
  });
  group.add(shafts,tips);
  const dustGeo=own(new THREE.BufferGeometry());dustGeo.setAttribute('position',new THREE.Float32BufferAttribute(dust.flat(),3));
  const particles=new THREE.Points(dustGeo,own(new THREE.PointsMaterial({color:0x90dfff,size:.025,transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending})));
  group.add(particles);
  const ambient=new THREE.HemisphereLight(0xb7e6ff,0x18243b,1.25);
  const key=new THREE.DirectionalLight(0xc8eeff,2.1);key.position.set(-2,3,4);
  const rim=new THREE.DirectionalLight(0x40b8ff,2.4);rim.position.set(1,2,-3);
  group.add(ambient,key,rim);scene.add(group);
  return {update(t){particles.position.y=.045*Math.sin(t*.21);},dispose(){scene.remove(group);scene.fog=oldFog;scene.background=oldBackground;shafts.dispose();tips.dispose();owned.forEach(x=>x.dispose());}};
}

// Restrained technical garment palette, evaluated once per source vertex. No texture download.
export function garmentShade(x,y,z){
  const boot=y<.19, cuff=y>=.19&&y<.24;
  const trim=Math.abs(Math.abs(x)-.105)<.014&&y>.38&&y<.92;
  const panel=Math.abs(x)>.19&&y>.65&&y<1.38;
  const seam=Math.abs(x)<.012&&z>.025&&y>1.02&&y<1.43;
  return boot?0x344653:cuff?0x526576:trim?0x6aafc4:seam?0x455b70:panel?0x62798c:0x9aaab8;
}

// Source geometry is a genuine existing CC0 rig, not a reconstruction of the reference portrait.
export function createCavernAvatar(scene,model) {
  const meshes=[];
  model.traverse(o=>{if(o.isMesh)meshes.push(o);});
  const suit=meshes.find(o=>o.isSkinnedMesh&&o.name.includes('female_casualsuit01'));
  if(!suit)throw Error('AURA_CAVERN_CLOTHING_MISSING');
  model.updateMatrixWorld(true);
  suit.geometry.computeBoundingBox();
  const bounds=suit.geometry.boundingBox.clone().applyMatrix4(suit.matrixWorld);
  if(bounds.min.y>.36||bounds.max.y<1.15)throw Error('AURA_CAVERN_FULL_BODY_ASSET_REQUIRED');
  const material=(color,emissive,roughness=.65)=>new THREE.MeshStandardMaterial({color,emissive,emissiveIntensity:.10,roughness,metalness:.06});
  const skin=material(0xe4d7d4,0x10232f,.78),cloth=material(0xffffff,0x0c2938,.76);
  cloth.vertexColors=true;cloth.metalness=.14;
  // Use rest-space geometry for a modest, dark-trimmed technical suit; colors follow the skinned mesh.
  const suitPos=suit.geometry.attributes.position,colors=new Float32Array(suitPos.count*3),vertex=new THREE.Vector3(),color=new THREE.Color();
  for(let i=0;i<suitPos.count;i++){
    vertex.fromBufferAttribute(suitPos,i).applyMatrix4(suit.matrixWorld);
    color.setHex(garmentShade(vertex.x,vertex.y,vertex.z));
    colors.set([color.r,color.g,color.b],i*3);
  }
  suit.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const hair=material(0xf1f3f5,0x102b3e,.52);hair.side=THREE.DoubleSide;
  const eyes=material(0x589ea8,0x0c2435,.23);
  const teeth=material(0xc8cbd0,0x050b12,.55),tongue=material(0x8c5a68,0x000000);
  const lash=material(0x879aab,0x000000);lash.side=THREE.DoubleSide;
  const materials=[skin,cloth,hair,eyes,teeth,tongue,lash];
  const old=new Set();
  for(const m of meshes){
    const name=m.name.toLowerCase();
    let next;
    if(m===suit)next=cloth;
    else if(name.includes('human'))next=skin;
    else if(name.includes('ponytail'))next=hair;
    else if(name.includes('high-poly'))next=eyes;
    else if(name.includes('teeth'))next=teeth;
    else if(name.includes('tongue'))next=tongue;
    else if(name.includes('eyebrow')||name.includes('eyelash'))next=lash;
    m.visible=Boolean(next);
    if(next){
      if(!m.geometry.attributes.normal)m.geometry.computeVertexNormals();
      (Array.isArray(m.material)?m.material:[m.material]).forEach(x=>old.add(x));
      m.material=next;m.frustumCulled=false;
    }
  }
  // Old materials may be shared with hidden meshes; let model disposal handle those still referenced.
  for(const m of meshes)(Array.isArray(m.material)?m.material:[m.material]).forEach(x=>old.delete(x));
  old.forEach(x=>x?.dispose());
  // A subtle rest-pose proportion adjustment applies equally to rig, clothing and face;
  // no detached anatomy or independent mesh stretching. Keep foot height stable.
  model.scale.x*=.975;model.scale.y*=1.025;model.scale.z*=.985;
  model.updateMatrixWorld(true);
  const adjusted=suit.geometry.boundingBox.clone().applyMatrix4(suit.matrixWorld);
  model.position.y+=bounds.min.y-adjusted.min.y;model.updateMatrixWorld(true);
  // Contact darkening on the actual floor; not a fake mirrored live avatar.
  const shadowGeo=new THREE.PlaneGeometry(1.35,.85);
  const shadowMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexShader:'varying vec2 p;void main(){p=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 p;void main(){float a=.50*exp(-dot(p,p)*4.);a*=1.-smoothstep(.75,1.,length(p));gl_FragColor=vec4(.001,.008,.014,a);}' });
  const contact=new THREE.Mesh(shadowGeo,shadowMat);contact.rotation.x=-Math.PI/2;contact.position.set(0,-.041,0);scene.add(contact,model);
  return {update(){},dispose(){scene.remove(model,contact);shadowGeo.dispose();shadowMat.dispose();const assigned=new Set(meshes.map(m=>m.material));for(const m of materials)if(!assigned.has(m))m.dispose(); /* model owner disposes assigned materials */ }};
}
