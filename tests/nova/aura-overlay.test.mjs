import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaySource, createAuraOverlay, OVERLAY_WORLD, OVERLAY_BINDING } from '../../agents/lib/aura-overlay.mjs';

test('the overlay script is valid JavaScript in both languages and only acts on trusted clicks', () => {
  for (const lang of ['sv', 'en']) {
    const source = overlaySource(lang);
    assert.doesNotThrow(() => new Function(source));
    assert.match(source, lang === 'sv' ? /Skriv till Aura, uppdraget fortsätter/ : /Write to Aura, the mission continues/);
    assert.match(source, /e\.isTrusted/);
    assert.match(source, /aria-hidden/);
  }
});

// A fake CDP tab: records what is sent and lets the test fire events as Chrome would.
function fakeCdp() {
  const sent = []; const handlers = {};
  class Session {
    constructor() { this.ws = { addEventListener() {} }; }
    async ready() {}
    on(name, fn) { (handlers[name] ||= []).push(fn); return () => {}; }
    async send(method, params) {
      sent.push({ method, params });
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
      if (method === 'Page.addScriptToEvaluateOnNewDocument') for (const fn of handlers['Runtime.executionContextCreated'] || []) fn({ context: { id: 7, name: OVERLAY_WORLD, auxData: { frameId: 'main' } } });
      return {};
    }
    close() {}
  }
  const fire = (name, params) => { for (const fn of handlers[name] || []) fn(params); };
  return { Session, sent, fire };
}

function fakeRuntime() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return { json: async () => (url.endsWith('/api/aura/chat') ? { reply: 'Jag fortsätter och tar med det.' } : { success: true }) };
  };
  return { calls, fetchImpl };
}

const settle = () => new Promise(r => setTimeout(r, 20));

test('the overlay is drawn in an isolated world with a binding only that world can call', async () => {
  const cdp = fakeCdp(); const rt = fakeRuntime();
  const overlay = createAuraOverlay({ CDPSession: cdp.Session, fetchImpl: rt.fetchImpl, missionId: () => 'mission-1' });
  await overlay.attach({ id: 't1', webSocketDebuggerUrl: 'ws://x' });
  const binding = cdp.sent.find(s => s.method === 'Runtime.addBinding');
  assert.deepEqual(binding.params, { name: OVERLAY_BINDING, executionContextName: OVERLAY_WORLD });
  assert.equal(cdp.sent.find(s => s.method === 'Page.addScriptToEvaluateOnNewDocument').params.worldName, OVERLAY_WORLD);
});

test('writing in the window steers the mission without ending it, and Aura answers there and in the chat', async () => {
  const cdp = fakeCdp(); const rt = fakeRuntime();
  const overlay = createAuraOverlay({ CDPSession: cdp.Session, fetchImpl: rt.fetchImpl, missionId: () => 'mission-1' });
  await overlay.attach({ id: 't1', webSocketDebuggerUrl: 'ws://x' });
  cdp.fire('Runtime.bindingCalled', { name: OVERLAY_BINDING, executionContextId: 7, payload: JSON.stringify({ type: 'chat', text: 'Ta den billigaste planen' }) });
  await settle();
  const paths = rt.calls.map(c => c.path);
  assert.ok(paths.includes('/api/aura/workbench/missions/mission-1/steer'));
  assert.ok(!paths.some(p => p.endsWith('/cancel')));
  assert.ok(paths.includes('/api/aura/chat'));
  assert.equal(rt.calls.filter(c => c.path === '/api/aura/chat/session/messages').length, 2);
  assert.ok(cdp.sent.some(s => s.method === 'Runtime.evaluate' && String(s.params.expression).includes('Jag fortsätter')));
});

test('Stop in the window cancels the mission', async () => {
  const cdp = fakeCdp(); const rt = fakeRuntime();
  const overlay = createAuraOverlay({ CDPSession: cdp.Session, fetchImpl: rt.fetchImpl, missionId: () => 'mission-1' });
  await overlay.attach({ id: 't1', webSocketDebuggerUrl: 'ws://x' });
  cdp.fire('Runtime.bindingCalled', { name: OVERLAY_BINDING, executionContextId: 7, payload: JSON.stringify({ type: 'stop' }) });
  await settle();
  assert.deepEqual(rt.calls.map(c => c.path), ['/api/aura/workbench/missions/mission-1/cancel']);
});

test('a call from the page itself (another context or another binding) is ignored', async () => {
  const cdp = fakeCdp(); const rt = fakeRuntime();
  const overlay = createAuraOverlay({ CDPSession: cdp.Session, fetchImpl: rt.fetchImpl, missionId: () => 'mission-1' });
  await overlay.attach({ id: 't1', webSocketDebuggerUrl: 'ws://x' });
  cdp.fire('Runtime.bindingCalled', { name: OVERLAY_BINDING, executionContextId: 1, payload: JSON.stringify({ type: 'stop' }) });
  cdp.fire('Runtime.bindingCalled', { name: 'other', executionContextId: 7, payload: JSON.stringify({ type: 'stop' }) });
  await settle();
  assert.deepEqual(rt.calls, []);
});

test('navigation restores the active edge in the new isolated world, without guessing cursor coordinates',async()=>{
  const cdp=fakeCdp(),rt=fakeRuntime();
  const overlay=createAuraOverlay({CDPSession:cdp.Session,fetchImpl:rt.fetchImpl});
  await overlay.attach({id:'t1',webSocketDebuggerUrl:'ws://x'});
  await overlay.working();
  const before=cdp.sent.length;
  cdp.fire('Runtime.executionContextCreated',{context:{id:9,name:OVERLAY_WORLD,auxData:{frameId:'main'}}});
  cdp.fire('Page.loadEventFired',{});
  await settle();
  const restored=cdp.sent.slice(before).filter(c=>c.method==='Runtime.evaluate');
  assert.ok(restored.some(c=>c.params.contextId===9&&c.params.expression.includes('.working()')));
  assert.ok(restored.every(c=>!c.params.expression.includes('.point(')));
  await overlay.point(120,85,true);
  assert.ok(cdp.sent.at(-1).params.expression.includes('.point(120, 85, true)'));
  const n=cdp.sent.length;await overlay.point(NaN,Infinity);assert.equal(cdp.sent.length,n);
});
