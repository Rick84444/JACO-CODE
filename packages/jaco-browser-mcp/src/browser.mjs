// The browser the agent drives: only tabs it opened itself, real input events, and the same refusals as JACO.
import { CDPSession, evaluate, observe, cdpBase, ensureChrome } from './cdp.mjs';
import { createInputActions } from '../lib/browser-input.mjs';
import { inputAllowed, hardDenied } from '../lib/browser-scope.mjs';
import { pickTarget } from '../lib/browser-target-match.mjs';

const readable = url => { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } };

export function createBrowser({ port = 9222, env = process.env, fetchImpl = fetch } = {}) {
  // Outside JACO the default is the open web; loopback, private networks, sign-in and payment pages stay excluded.
  const scopeEnv = { JACO_BROWSER_SCOPE: 'broad_web', ...env };
  const owned = new Set();
  let current = null;
  const tabs = async () => (await (await fetchImpl(`${cdpBase(port)}/json/list`)).json()).filter(t => t.type === 'page');
  const actions = createInputActions({
    evaluate, observe,
    tabs: { list: tabs, adopt: tab => { owned.add(tab.id); } },
  });

  async function withTab(fn) {
    if (!current || !owned.has(current)) throw new Error('NO_TAB: open a page with browser_open first.');
    const tab = (await tabs()).find(t => t.id === current);
    if (!tab) { owned.delete(current); current = null; throw new Error('TAB_CLOSED: the tab was closed. Open a page again.'); }
    const session = new CDPSession(tab.webSocketDebuggerUrl);
    await session.ready();
    try { return await fn(session, tab); } finally { session.close(); }
  }

  const summary = page => ({
    url: page.url, title: page.title, text: page.text,
    controls: (page.targets || []).filter(t => t.visible && t.text).slice(0, 40).map(t => ({ name: t.text, role: t.role })),
  });

  async function resolveSelector(session, { name, selector }) {
    if (selector) return { selector };
    const page = await observe(session);
    const picked = pickTarget(page.targets, name);
    if (!picked.target) return { error: picked.error, available: picked.available };
    return { selector: picked.target.selector };
  }

  async function guardInput(session) {
    const url = await evaluate(session, 'location.href');
    if (hardDenied(url)) throw new Error('REFUSED: sign-in, payment and security pages are for a person, not an agent.');
    if (!inputAllowed(url, scopeEnv)) throw new Error('REFUSED: this page is outside what the agent may click or type on (local and private network pages are excluded).');
    return url;
  }

  return {
    async open(url) {
      if (!readable(url)) throw new Error('URL_INVALID: only http and https pages.');
      if (hardDenied(url)) throw new Error('REFUSED: sign-in, payment and security pages are for a person, not an agent.');
      await ensureChrome(port, env);
      const r = await fetchImpl(`${cdpBase(port)}/json/new?${new URL(url).href}`, { method: 'PUT' });
      if (!r.ok) throw new Error(`CDP_NEW_TAB_FAILED_${r.status}`);
      const tab = await r.json();
      owned.add(tab.id); current = tab.id;
      await new Promise(res => setTimeout(res, 1500));
      return withTab(async session => ({ tab: tab.id, ...summary(await observe(session)) }));
    },
    read() { return withTab(async session => summary(await observe(session))); },
    click({ name, selector, expect }) {
      return withTab(async session => {
        const url = await guardInput(session);
        const target = await resolveSelector(session, { name, selector });
        if (target.error) return { ok: false, error: target.error, available: target.available };
        const r = await actions.actSession(session, { selector: target.selector, expectedUrl: url, expect }, 'click');
        if (r.newTabs?.length) current = r.newTabs.at(-1).id;
        return { ok: r.ok, verified: r.verified, effect: r.effect || null, expectationMet: r.expectationMet ?? null, newTabs: r.newTabs || [], now: r.observation ? { url: r.observation.url, title: r.observation.title } : null, ...(r.error ? { error: r.error } : {}) };
      });
    },
    type({ name, selector, text }) {
      return withTab(async session => {
        const url = await guardInput(session);
        let sel = selector;
        if (!sel) {
          const page = await observe(session);
          const picked = pickTarget((page.targets || []).filter(t => ['input', 'textarea', 'select'].includes(t.role)), name);
          if (!picked.target) return { ok: false, error: picked.error, available: picked.available };
          sel = picked.target.selector;
        }
        const r = await actions.actSession(session, { selector: sel, text, expectedUrl: url }, 'type');
        return { ok: r.ok, verified: r.verified, ...(r.error ? { error: r.error } : {}) };
      });
    },
    press({ key, modifiers }) {
      return withTab(async session => {
        const url = await guardInput(session);
        const r = await actions.actSession(session, { key, modifiers, expectedUrl: url }, 'press');
        return { ok: r.ok, verified: r.verified, now: r.observation ? { url: r.observation.url, title: r.observation.title } : null, ...(r.error ? { error: r.error } : {}) };
      });
    },
    async tabs() {
      const list = (await tabs()).filter(t => owned.has(t.id));
      return { tabs: list.map(t => ({ id: t.id, title: t.title, url: t.url, current: t.id === current })) };
    },
    async switchTab(id) {
      if (!owned.has(id)) throw new Error('TAB_NOT_OWNED: only tabs this server opened can be used.');
      current = id;
      return this.read();
    },
    async closeTab(id) {
      if (!owned.has(id)) throw new Error('TAB_NOT_OWNED: only tabs this server opened can be closed.');
      await fetchImpl(`${cdpBase(port)}/json/close/${encodeURIComponent(id)}`);
      owned.delete(id); if (current === id) current = null;
      return { closed: id };
    },
  };
}
