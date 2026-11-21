import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readAuraDesktopLiveFrame} from '../../agents/lib/aura-desktop-live-view.mjs';

const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const sha=createHash('sha256').update(png).digest('hex');
const now=Date.now();
const observation={
  type:'screenshot',ok:true,verified:true,at:new Date(now-100).toISOString(),
  result:{imageSha256:sha,width:400,height:300,perception:{hwnd:321,capture:{x:0,y:0,width:400,height:300}}},
};
const mission={id:'mission-local-123',status:'ACTIVE',executor:'desktop-agentos',receipts:[observation]};
const opts={file:'fixture',env:{JACO_AURA_DESKTOP_SCREEN_VIEW:'1'},now,
  stat:()=>({size:png.length,mtimeMs:now-100,isFile:()=>true}),read:()=>png};

test('Windows live preview reads the unchanged original mission-bound Laser Vision PNG',()=>{
  const r=readAuraDesktopLiveFrame({mission,...opts});
  assert.equal(r.ok,true);
  assert.equal(r.sha256,sha);
  assert.deepEqual(r.png,png);
  assert.equal(r.missionId,mission.id);
  assert.equal(r.at,observation.at);
});

test('preview fails closed without operator opt-in, active mission or the assigned Windows executor',()=>{
  assert.equal(readAuraDesktopLiveFrame({mission,...opts,env:{}}).reason,'DESKTOP_SCREEN_VIEW_NOT_ENABLED');
  assert.equal(readAuraDesktopLiveFrame({mission:{...mission,status:'DONE'},...opts}).reason,'NO_ACTIVE_DESKTOP_MISSION');
  assert.equal(readAuraDesktopLiveFrame({mission:{...mission,executor:'nova'},...opts}).reason,'NO_ACTIVE_DESKTOP_MISSION');
  assert.equal(readAuraDesktopLiveFrame({mission:null,...opts}).reason,'NO_ACTIVE_DESKTOP_MISSION');
});
test('preview never serves stale, overwritten, unverified or post-mutation frame',()=>{
  const absent=readAuraDesktopLiveFrame({mission:{...mission,receipts:[]},...opts});
  assert.equal(absent.reason,'NO_FRESH_VERIFIED_LASER_VISION_FRAME');
  assert.equal(readAuraDesktopLiveFrame({mission:{...mission,receipts:[{...observation,verified:false}]},...opts}).ok,false);
  assert.equal(readAuraDesktopLiveFrame({mission:{...mission,receipts:[observation,{type:'mouse-click',ok:true,verified:true}]},...opts}).ok,false);
  assert.equal(readAuraDesktopLiveFrame({mission,...opts,now:now+13000}).ok,false);
  assert.equal(readAuraDesktopLiveFrame({mission,...opts,read:()=>Buffer.alloc(png.length)}).ok,false);
});
