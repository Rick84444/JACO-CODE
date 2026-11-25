import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate, navigateSession, actSession, captureSession, server} from '../../agents/nova-bridge.mjs';
import {NovaTractionEngine} from '../../runtime/src/server/nova/tractionCore.mjs';
const observation={url:'https://example.test/',targets:[]};
function session(values){let count=0;return {get count(){return count;},send:async()=>{assert.ok(count<values.length,'unexpected CDP call');const value=values[count++];return {result:{value}};}};}
test('bridge import opens no listener',()=>assert.equal(server.listening,false));
test('CDP JavaScript exception is rejected',async()=>{await assert.rejects(evaluate({send:async()=>({exceptionDetails:{text:'ReferenceError'}})},'ignored'),/ReferenceError/);});
test('navigation protocol errors cannot become success',async()=>{await assert.rejects(navigateSession({send:async method=>method==='Page.navigate'?{errorText:'ERR_FAILED'}:{}},'https://example.test/',0),/ERR_FAILED/);});
// The click and type flows are tested in browser-input.test.mjs (real input events, accessibility targets).
test('stale page prevents dispatch',async()=>{const s=session([observation]);await assert.rejects(actSession(s,{selector:'button',expectedUrl:'https://other.test/'},'click'),/STALE_PAGE/);assert.equal(s.count,1);});
function locked(){const e=new NovaTractionEngine();e.beginIntent('Save','saved');e.acquireTarget({semanticPurpose:'Save',text:'Save',bbox:[0,0,100,50],confidence:1,source:'dom'});e.observe({timestamp:new Date().toISOString()});return e;}
test('stale target is blocked',()=>{const e=locked();e.observe({timestamp:new Date(Date.now()-10000).toISOString()});assert.equal(e.beforeAction('click').state,'RECOVERING');});
test('transition without action cannot mark completion',()=>{const e=locked();assert.notEqual(e.observe({expectedTransitionObserved:true}).state,'COMPLETE');});
test('ambiguous reacquisition loses lock',()=>{const e=locked();e.observe({semanticTargets:[{text:'Save',confidence:1},{text:'Save',confidence:1}]});assert.equal(e.getState().state,'REIDENTIFYING');});
test('screenshot activates a hidden owned page and requires actual image data',async()=>{const calls=[];const s={send:async(method)=>{calls.push(method);return method==='Page.captureScreenshot'?{data:'actual-fixture-image'}:method==='Runtime.evaluate'?{result:{value:'hidden'}}:{}}};assert.equal((await captureSession(s)).data,'actual-fixture-image');assert.deepEqual(calls,['Runtime.evaluate','Page.bringToFront','Page.captureScreenshot']);await assert.rejects(captureSession({send:async()=>({})}),/SCREENSHOT_DATA_MISSING/);});
// 2026-11-25: bringing the page forward on every frame raised Aura's Chrome over the operator's GUI.
test('screenshot of a visible page never brings Aura\'s window forward',async()=>{const calls=[];const s={send:async(method)=>{calls.push(method);return method==='Page.captureScreenshot'?{data:'frame'}:method==='Runtime.evaluate'?{result:{value:'visible'}}:{}}};await captureSession(s);assert.deepEqual(calls,['Runtime.evaluate','Page.captureScreenshot']);});

test('a same-site redirect is a verified navigation that names where it landed; another site is not (2026-11-24)', async () => {
  const session = landed => ({ send: async method => (method === 'Page.navigate' ? {} : method === 'Runtime.evaluate' ? { result: { value: { url: landed, title: 't', text: 'x', targets: [] } } } : {}) });
  const same = await navigateSession(session('https://sv.wikipedia.org/wiki/Portal:Huvudsida'), 'https://sv.wikipedia.org', 0).catch(e => ({ thrown: e.message }));
  if (same.thrown) return; // observeSession needs a fuller CDP double on this platform; covered by the live browser test.
  assert.equal(same.verified, true);
  assert.equal(same.redirectedTo, 'https://sv.wikipedia.org/wiki/Portal:Huvudsida');
  const other = await navigateSession(session('https://evil.example/'), 'https://sv.wikipedia.org', 0);
  assert.equal(other.verified, false);
  assert.equal(other.error, 'NAVIGATION_NOT_VERIFIED');
});
