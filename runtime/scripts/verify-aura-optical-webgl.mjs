import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const three=resolve(process.argv[2]||'runtime/node_modules/three');
const lib=fileURLToPath(new URL('../src/lib/',import.meta.url));
const modules=['auraV31OpticalRig.mjs','auraOptics.mjs','auraSurfaceDetail.mjs','auraStudioFloor.mjs'];
const assets=new Map([['/three.module.js',resolve(three,'build/three.module.js')],['/three.core.js',resolve(three,'build/three.core.js')],['/Reflector.js',resolve(three,'examples/jsm/objects/Reflector.js')],...modules.map(n=>['/'+n,resolve(lib,n)])]);
const html='<!doctype html><meta charset="utf-8"><body data-result="pending"><canvas></canvas><script type="importmap">{"imports":{"three":"/three.module.js","three/addons/objects/Reflector.js":"/Reflector.js"}}</script><script type="module" src="/probe.mjs"></script>';
const probe=`
import * as THREE from 'three';
import {createV31OpticalRig} from './auraV31OpticalRig.mjs';
import {createStudioReflection,reflectionAllowed} from './auraStudioFloor.mjs';
try{
 const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,alpha:true});
 renderer.setSize(360,180,false);
 const errors=[];
 renderer.debug.checkShaderErrors=true;
 renderer.debug.onShaderError=(gl,program,vertex,fragment)=>errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].join(' '));
 const scene=new THREE.Scene(),model=new THREE.Group(),camera=new THREE.PerspectiveCamera(42,2,.1,10);
 camera.position.set(0,2.4,6);camera.lookAt(0,.6,0);
 const tex=new THREE.DataTexture(new Uint8Array([180,145,128,255,190,175,155,100,200,190,175,255,150,155,160,0]),2,2);
 tex.colorSpace=THREE.SRGBColorSpace;tex.flipY=false;tex.needsUpdate=true;
 const names=['Human.body','Human.high-poly','Aura V26 neutral platinum photo hair','Human.teeth_base','Human.tongue01'];
 for(let i=0;i<names.length;i++){
  const m=new THREE.MeshStandardMaterial({map:tex,roughness:.65,side:THREE.DoubleSide});
  m.name=names[i];const mesh=new THREE.Mesh(new THREE.SphereGeometry(.48,24,16),m);mesh.position.set((i-2)*.95,.75,0);model.add(mesh);
 }
 scene.add(model);
 const optics=createV31OpticalRig(scene,model,renderer);
 const floor=createStudioReflection(scene,renderer,false);
 if(reflectionAllowed(.8,1,true,true)||reflectionAllowed(.8,0,false,true))throw Error('FLOOR_BUDGET_GATE');
 const active=floor.update(1,1);
 if(!active||!floor.renderTarget)throw Error('FLOOR_REFLECTION_UNAVAILABLE');
 renderer.compile(scene,camera);renderer.render(scene,camera);
 const pixels=new Uint16Array(256*256*4);
 renderer.readRenderTargetPixels(floor.renderTarget,0,0,256,256,pixels);
 if(!pixels.some((v,i)=>i%4!==3&&v>0))throw Error('FLOOR_REFLECTION_EMPTY');
 if(floor.update(1,0))throw Error('FLOOR_FALLBACK_FAILED');
 const status=optics.update(.033,false);
 const gl=renderer.getContext();const code=gl.getError();
 if(errors.length||code!==gl.NO_ERROR||!status.skinDetailReady||!status.hairDetailReady||!status.pupilReady||!status.environmentReady||status.surfaceCount!==5)throw Error(JSON.stringify({errors,code,status}));
 document.body.dataset.result='pass';document.body.append('V31 optical fixture compiled and rendered');
 floor.dispose();optics.dispose();renderer.dispose();
}catch(e){document.body.dataset.result='fail';document.body.append(String(e?.stack||e));}
`;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/'){res.setHeader('content-type','text/html');return res.end(html);}
  if(path==='/probe.mjs'){res.setHeader('content-type','text/javascript');return res.end(probe);}
  if(!assets.has(path)){res.statusCode=404;return res.end();}
  res.setHeader('content-type','text/javascript');res.end(await readFile(assets.get(path)));
 }catch{res.statusCode=500;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const url='http://127.0.0.1:'+server.address().port;
 const chrome=process.env.CHROME_BIN||'google-chrome';
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--virtual-time-budget=12000','--dump-dom',url]);
  let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('WEBGL_PROBE_TIMEOUT'));},45000);
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(Error(stderr.slice(-3000)));});
 });
 assert.match(output,/data-result="pass"/,output.slice(-3500));
 console.log('PASS: actual WebGL optical material fixture; this is not V31 visual acceptance.');
}finally{server.close();}
