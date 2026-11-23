// Deterministic area-stratified samples of licensed 3D geometry. Presentation only.
export function sampleLightField(vertices,triangles,count=7200,seed=0x4a41434f){
  if(!Number.isSafeInteger(count)||count<1||count>16000)throw new RangeError('particle count');
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  let total=0;
  const faces=[];
  for(const [i,j,k] of triangles){
    const a=vertices[i],b=vertices[j],c=vertices[k];
    const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z;
    const vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const length=Math.hypot(nx,ny,nz);
    if(!Number.isFinite(length)||length<1e-9)continue;
    total+=length/2;
    faces.push({a,b,c,nx:nx/length,ny:ny/length,nz:nz/length,end:total});
  }
  if(!faces.length||!Number.isFinite(total))throw Error('invalid light field surface');
  // Fixed sample positions, stratified by surface area; not re-randomized every frame.
  const particles=[];
  let fi=0;
  for(let n=0;n<count;n++){
    const target=(n+random())/count*total;
    while(faces[fi].end<target&&fi<faces.length-1)fi++;
    const {a,b,c,nx,ny,nz}=faces[fi];
    const root=Math.sqrt(random()),v=root*(1-random()),u=1-root,w=1-u-v;
    particles.push({x:u*a.x+v*b.x+w*c.x,y:u*a.y+v*b.y+w*c.y,z:u*a.z+v*b.z+w*c.z,nx,ny,nz,phase:random()*Math.PI*2,energy:random()});
  }
  return particles;
}
export function projectLightPoint(p,yaw,pitch,time,activity=0,scale=240){
  const phase=p.phase+time*.75;
  const drift=(.008+.025*activity)*Math.sin(phase);
  const px=p.x+p.nx*drift,py=p.y+p.ny*drift,pz=p.z+p.nz*drift;
  const cx=Math.cos(yaw),sx=Math.sin(yaw),cy=Math.cos(pitch),sy=Math.sin(pitch);
  const x=px*cx+pz*sx,depth=pz*cx-px*sx;
  const y=py*cy-depth*sy,z=depth*cy+py*sy;
  const nz=(p.nz*cx-p.nx*sx)*cy+p.ny*sy;
  const perspective=2.8/(2.8-z);
  const front=Math.max(0,-nz);
  const shimmer=.84+.16*Math.sin(p.phase+time*1.7);
  return {x:scale+x*scale*.83*perspective,y:scale+y*scale*.83*perspective,z,brightness:Math.min(1,(.12+.53*front+.22*p.energy+.13*activity)*shimmer),radius:(.38+.55*p.energy)*perspective};
}
