// Aura's window must be drawn in the page when a tab is attached, even when the overlay world exists
// but the script did not run in it (seen live on 2026-11-16: world present, element absent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuraOverlay } from '../../agents/lib/aura-overlay.mjs';

class FakeCDP {
  static sessions = [];
  constructor(url) {
    this.url = url; this.sent = []; this.handlers = new Map(); this.ws = { addEventListener() {} };
    FakeCDP.sessions.push(this);
  }
  async ready() {}
  on(event, fn) { this.handlers.set(event, fn); }
  close() {}
  async send(method, params = {}) {
    this.sent.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 77 };
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      // Chrome reports the overlay world, but the script does not run in it here.
      queueMicrotask(() => this.handlers.get('Runtime.executionContextCreated')?.({ context: { id: 55, name: 'jaco-aura', auxData: { frameId: 'main' } } }));
    }
    return {};
  }
}

test('attach draws the overlay in Aura\'s world even when the world appeared without the script', async () => {
  FakeCDP.sessions = [];
  const overlay = createAuraOverlay({ CDPSession: FakeCDP, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await overlay.attach({ id: 'tab-1', webSocketDebuggerUrl: 'ws://fake/1' });
  const session = FakeCDP.sessions[0];
  const drawn = session.sent.filter(m => m.method === 'Runtime.evaluate' && m.params.contextId !== undefined && String(m.params.expression).includes('jaco-aura-overlay'));
  assert.ok(drawn.length >= 1, 'the overlay script is run in the overlay world');
  assert.equal(drawn.at(-1).params.contextId, 55, 'in the world Chrome reported for the page');
});
