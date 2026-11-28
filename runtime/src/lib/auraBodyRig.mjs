import * as THREE from 'three';
import {createBodyMotion} from './auraBodyMotion.mjs';
const NAMES=['Hips','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];
// Solve the measured two-bone chains in world space; preserve authored bone axes.
export function createAuraBodyRig(model,bones){
  if(NAMES.some(n=>!bones.has(n)))return null;
  const bone=n=>bones.get(n).bone;
  model.updateMatrixWorld(true);
  const root=model.position.clone(),hip=bone('Hips'),hipBase=hip.position.clone();
  const get=n=>bone(n).getWorldPosition(new THREE.Vector3());
  const chains={};
  for(const side of ['Left','Right']){
    for(const [kind,names] of [['arm',[side+'Arm',side+'ForeArm',side+'Hand']],['leg',[side+'UpLeg',side+'Leg',side+'Foot']]]){
      const [a,b,c]=names.map(bone),p=get(names[0]),q=get(names[1]),r=get(names[2]);
      chains[side+kind]={a,b,c,l1:p.distanceTo(q),l2:q.distanceTo(r),rest:r,rotation:c.getWorldQuaternion(new THREE.Quaternion())};
    }
  }
  const motion=createBodyMotion();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),direction=new THREE.Vector3(),pole=new THREE.Vector3(),mid=new THREE.Vector3(),target=new THREE.Vector3(),end=new THREE.Vector3(),delta=new THREE.Quaternion(),world=new THREE.Quaternion(),parent=new THREE.Quaternion();
  function orient(joint,child,destination){
    joint.getWorldPosition(a);child.getWorldPosition(b);
    b.sub(a).normalize();c.copy(destination).sub(a).normalize();
    if(b.lengthSq()<.5||c.lengthSq()<.5)return;
    delta.setFromUnitVectors(b,c);joint.getWorldQuaternion(world);
    joint.parent.getWorldQuaternion(parent).invert();
    joint.quaternion.copy(parent.multiply(delta.multiply(world)));
    joint.updateMatrixWorld(true);
  }
  function solve(chain,wanted,poleX,poleY,poleZ,lockEnd=false){
    chain.a.getWorldPosition(a);
    direction.copy(wanted).sub(a);
    const length=direction.length();if(length<1e-5)return;
    direction.divideScalar(length);
    const d=Math.min(chain.l1+chain.l2-.0001,Math.max(Math.abs(chain.l1-chain.l2)+.0001,length));
    const along=(chain.l1**2-chain.l2**2+d*d)/(2*d),height=Math.sqrt(Math.max(0,chain.l1**2-along**2));
    pole.set(poleX,poleY,poleZ);pole.addScaledVector(direction,-pole.dot(direction));
    if(pole.lengthSq()<1e-6)pole.set(1,0,0).addScaledVector(direction,-direction.x);
    pole.normalize();
    mid.copy(a).addScaledVector(direction,along).addScaledVector(pole,height);
    end.copy(a).addScaledVector(direction,d);
    orient(chain.a,chain.b,mid);orient(chain.b,chain.c,end);
    if(lockEnd){chain.c.parent.getWorldQuaternion(parent).invert();chain.c.quaternion.copy(parent.multiply(chain.rotation));chain.c.updateMatrixWorld(true);}
  }
  const hipWorld=new THREE.Vector3();
  let wasActive=false;
  return {
    request:kind=>motion.request(kind),
    update(dt,reduced,behavior=null){
      const p=motion.update(dt,reduced);
      const idleWeight=reduced?0:behavior?.weight||0;
      const beat=reduced||p.action?0:behavior?.handBeat||0;
      const active=Boolean(p.action||p.wide>0||p.rootZ||Math.abs(idleWeight)>.001||beat>.001);
      if(!active&&!wasActive)return p;
      wasActive=active;
      // The base pose is restored every frame; no accumulated quaternion drift.
      for(const n of NAMES)bone(n).quaternion.copy(bones.get(n).base);
      model.position.copy(root);model.position.z+=p.rootZ;
      hip.position.copy(hipBase);
      model.updateMatrixWorld(true);
      // Hip offsets are metres in stage coordinates, not arbitrary local bone axes.
      hip.getWorldPosition(hipWorld);hipWorld.x+=p.weightX+(p.action?0:idleWeight);hipWorld.y-=p.hipDrop;
      hip.position.copy(hip.parent.worldToLocal(hipWorld));hip.updateMatrixWorld(true);
      for(const side of ['Left','Right']){
        const left=side==='Left',sign=left?1:-1,leg=chains[side+'leg'],arm=chains[side+'arm'];
        target.copy(leg.rest);target.z+=left?p.leftZ:p.rightZ;target.y+=left?p.leftLift:p.rightLift;
        solve(leg,target,0,0,1,true);
        const strength=p.gesture*(p.side===0?.60:p.side===sign?1:0)+(left?beat*.20:beat*.35);
        target.copy(arm.rest);target.z+=p.rootZ+sign*p.swing;
        // An open-hand presentation remains within the measured arm reach.
        target.x+=sign*.10*strength;target.y+=.20*strength;target.z+=.13*strength;
        if(strength>0||p.swing)solve(arm,target,sign*.55,-1,.15);
      }
      model.updateMatrixWorld(true);
      return p;
    }
  };
}
