import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifiedHyperVGuest, virtualInputGrant, desktopPlannerVision, hostInputTargetAllowed } from '../../agents/lib/aura-desktop-virtual-input.mjs';

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

test('the operator can opt in to raw input on a physical host, but only with both variables and a verified interactive session',()=>{
  const env={JACO_AURA_DESKTOP_SANDBOX:'host-operator',JACO_ALLOW_COORDINATE_FALLBACK:'1'};
  const granted=virtualInputGrant({env,platform:'win32',wmi:null,session});
  assert.equal(granted.allowed,true);
  assert.equal(granted.mode,'host-operator');
  assert.equal(granted.reason,'OPERATOR_HOST_OPT_IN');
  // Not implied by either variable alone, and never off Windows.
  assert.equal(virtualInputGrant({env:{JACO_AURA_DESKTOP_SANDBOX:'host-operator'},platform:'win32',session}).allowed,false);
  assert.equal(virtualInputGrant({env:{JACO_ALLOW_COORDINATE_FALLBACK:'1'},platform:'win32',session}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'linux',session}).allowed,false);
  // The session checks are the same as for a guest: a locked desktop, session 0 or a missing foreground window refuse.
  assert.equal(virtualInputGrant({env,platform:'win32'}).reason,'VIRTUAL_INPUT_INTERACTIVE_SESSION_UNVERIFIED');
  assert.equal(virtualInputGrant({env,platform:'win32',session:{...session,sessionId:0}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',session:{...session,inputDesktop:'Winlogon'}}).allowed,false);
  assert.equal(virtualInputGrant({env,platform:'win32',session:{...session,verified:false}}).allowed,false);
  // The Hyper-V route is unchanged: a physical host without the opt-in mode is still refused.
  assert.equal(virtualInputGrant({env:{JACO_AURA_DESKTOP_SANDBOX:'hyperv-guest',JACO_ALLOW_COORDINATE_FALLBACK:'1'},platform:'win32',wmi:{...guest,data:[{Manufacturer:'Komplett',Model:'Gaming PC'}]},session}).allowed,false);
  assert.equal(virtualInputGrant({env:{JACO_AURA_DESKTOP_SANDBOX:'anything-else',JACO_ALLOW_COORDINATE_FALLBACK:'1'},platform:'win32',wmi:guest,session}).allowed,false);
});

test('on a host, raw input goes only to a freshly observed window of a process the operator granted',()=>{
  const observed=(hwnd,processName)=>({type:'desktop-observe',ok:true,verified:true,result:{observation:{window:{hwnd,processName}}}});
  const task=hwnd=>({type:'type-text',data:{expectedHwnd:hwnd,text:'x'}});
  const mission={receipts:[observed(10,'notepad'),observed(11,'Chrome.exe'),observed(12,'lsass'),observed(13,'1password')]};
  assert.deepEqual(hostInputTargetAllowed(task(10),mission,{}),{allowed:true,process:'notepad'});
  assert.equal(hostInputTargetAllowed(task(11),mission,{}).allowed,true,'case and .exe are ignored');
  assert.equal(hostInputTargetAllowed(task(12),mission,{}).reason,'HOST_INPUT_PROCESS_NOT_GRANTED');
  assert.equal(hostInputTargetAllowed(task(13),mission,{}).reason,'HOST_INPUT_PROCESS_NOT_GRANTED');
  assert.equal(hostInputTargetAllowed(task(99),mission,{}).reason,'HOST_INPUT_TARGET_UNOBSERVED');
  assert.equal(hostInputTargetAllowed({type:'type-text',data:{text:'x'}},mission,{}).reason,'EXPECTED_HWND_REQUIRED');
  // The operator's own list replaces the default one, exactly as for the desktop grant.
  assert.equal(hostInputTargetAllowed(task(11),mission,{JACO_DESKTOP_GRANT_PROCESSES:'notepad'}).allowed,false);
  assert.equal(hostInputTargetAllowed(task(10),mission,{JACO_DESKTOP_GRANT_PROCESSES:'notepad'}).allowed,true);
  // An observation that did not verify never counts.
  assert.equal(hostInputTargetAllowed(task(10),{receipts:[{...observed(10,'notepad'),verified:false}]},{}).reason,'HOST_INPUT_TARGET_UNOBSERVED');
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
