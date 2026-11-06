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
test('screenshot activates the owned page and requires actual image data',async()=>{const calls=[];const s={send:async(method)=>{calls.push(method);return method==='Page.captureScreenshot'?{data:'actual-fixture-image'}:{}}};assert.equal((await captureSession(s)).data,'actual-fixture-image');assert.deepEqual(calls,['Page.bringToFront','Page.captureScreenshot']);await assert.rejects(captureSession({send:async()=>({})}),/SCREENSHOT_DATA_MISSING/);});
