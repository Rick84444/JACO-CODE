import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifiedHyperVGuest, virtualInputGrant, desktopPlannerVision } from '../../agents/lib/aura-desktop-virtual-input.mjs';

const session = {schema:'jaco.desktop-session/v1',ok:true,verified:true,interactive:true,sessionId:2,foregroundHwnd:123,inputDesktop:'Default'};
const guest = {
  schema:'jaco.windows-wmi-read/v1', source:'windows-cim', query:'computer',
  ok:true, verified:true, data:[{ Manufacturer:'Microsoft Corporation',Model:'Virtual Machine' }],
};

test('virtual keyboard and mouse use explicit opt-in plus independently probed Windows Hyper-V guest',()=>{
  const env={JACO_AURA_DESKTOP_SANDBOX:'hyperv-guest',JACO_ALLOW_COORDINATE_FALLBACK:'1'};
  assert.equal(verifiedHyperVGuest(guest),true);
  assert.equal(virtualInputGrant({env,platform:'win32',wmi:guest,session}).allowed,true);
  assert.equal(virtualInputGrant({env:{...env,JACO_ALLOW_COORDINATE_FALLBACK:'0'},platform:'win32',wmi:guest,session}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'linux',wmi:guest,session}).allowed,false);
  assert.equal(virtualInputGrant({env:{JACO_ALLOW_COORDINATE_FALLBACK:'1'},platform:'win32',wmi:guest,session}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',wmi:null,session}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',session,wmi:{...guest,verified:false}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',session,wmi:{...guest,data:[{Manufacturer:'VMware',Model:'Virtual Machine'}]}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',session,wmi:{...guest,data:[{Manufacturer:'Microsoft Corporation',Model:'Surface Pro'}]}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',wmi:guest}).reason,'VIRTUAL_INPUT_INTERACTIVE_SESSION_UNVERIFIED');
  assert.equal(virtualInputGrant({env,platform:'win32',wmi:guest,session:{...session,sessionId:0}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',wmi:guest,session:{...session,inputDesktop:'Winlogon'}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',wmi:guest,session:{...session,verified:false}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',wmi:guest,session:{...session,foregroundHwnd:0}}).allowed,false);
});

test('Laser Vision only provides fresh, hashed mission-bound Windows screenshot to SEER with cloud opt-in',()=>{
  const now=Date.now(),bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
  const sha=createHash('sha256').update(bytes).digest('hex');
  const screenshot={type:'screenshot',ok:true,verified:true,at:new Date(now-50).toISOString(),result:{imageSha256:sha,width:400,height:300,perception:{hwnd:17,capture:{x:40,y:60,width:400,height:300}}}};
  const deps={now,stat:()=>({isFile:()=>true,size:bytes.length,mtimeMs:now-50}),read:()=>bytes};
  const local=desktopPlannerVision({receipts:[screenshot]},'not-present',{...deps,env:{}});
  assert.equal(local.image,undefined);
  assert.match(local.note,/not authorized/);
  assert.ok(!local.note.includes('base64'));
  const allowed=desktopPlannerVision({receipts:[screenshot]},'not-present',{...deps,env:{NOVA_ALLOW_CLOUD_IMAGES:'1'}});
  assert.ok(allowed.image.startsWith('data:image/png;base64,'));
  assert.match(allowed.note,/LASER_VISION_CURRENT_FRAME/);
  assert.ok(!allowed.note.includes('base64'));
  const changed=desktopPlannerVision({receipts:[screenshot,{type:'mouse-click',ok:true,verified:true}]},'not-present',{...deps,env:{NOVA_ALLOW_CLOUD_IMAGES:'1'}});
  assert.equal(changed.image,undefined);
  assert.equal(changed.note,'');
  const stale=desktopPlannerVision({receipts:[screenshot]},'not-present',{...deps,now:now+31000,env:{NOVA_ALLOW_CLOUD_IMAGES:'1'}});
  assert.equal(stale.image,undefined);
  const forged=desktopPlannerVision({receipts:[screenshot]},'not-present',{...deps,read:()=>Buffer.alloc(bytes.length),env:{NOVA_ALLOW_CLOUD_IMAGES:'1'}});
  assert.equal(forged.image,undefined);
});
