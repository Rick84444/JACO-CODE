// Browser input for the Nova bridge: real input events, targets named by the page's own accessibility tree, and
// dialogs that are dismissed rather than accepted.
//
// Why real events. A script's el.click() and a value assigned by script do not reach React-controlled fields,
// framework buttons or anything that checks event.isTrusted. Input.dispatchMouseEvent, Input.insertText and
// Input.dispatchKeyEvent are what the browser itself produces for a person, so a page treats them as one.
//
// What does not change. The target is resolved first (one CSS selector match, or one accessible role and name) and
// located from the page, never from coordinates an agent supplies; the page is read again afterwards; a password
// field is never typed into; the origin policy (browser-scope.mjs) and the action journal in front of this file stay.

const TARGET_FN = `function () {
  const e = this; e.scrollIntoView({ block: 'center', inline: 'center' });
  const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
  const h = document.elementFromPoint(x, y);
  return { x, y, w: r.width, h: r.height, covered: !(h && (h === e || e.contains(h) || h.contains(e))),
    password: e.tagName === 'INPUT' && e.type === 'password', disabled: !!e.disabled, tag: e.tagName.toLowerCase() };
}`;
const FOCUS_FN = `function () {
  this.focus();
  if (typeof this.select === 'function') { try { this.select(); } catch {} }
  else if (this.isContentEditable) { const r = document.createRange(); r.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  return true;
}`;
const READ_FN = 'function () { return this.isContentEditable ? this.innerText : this.value; }';

const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9 }, Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 }, ' ': { code: 'Space', vk: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowDown: { code: 'ArrowDown', vk: 40 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 }, PageUp: { code: 'PageUp', vk: 33 }, PageDown: { code: 'PageDown', vk: 34 },
  Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 },
};
export const PRESSABLE_KEYS = Object.keys(KEYS);
const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const AX_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab', 'switch', 'slider', 'option']);

const callOn = (session, objectId, functionDeclaration) =>
  session.send('Runtime.callFunctionOn', { objectId, functionDeclaration, returnByValue: true, awaitPromise: true });

// The node a request names: one CSS selector match, or one accessible role+name. Never "the first of several".
export async function resolveTarget(session, { selector, role, name }) {
  if (typeof selector === 'string' && selector) {
    const expression = `(() => { const es = document.querySelectorAll(${JSON.stringify(selector)}); return es.length === 1 ? es[0] : null; })()`;
    const objectId = (await session.send('Runtime.evaluate', { expression })).result?.objectId;
    if (!objectId) throw new Error('TARGET_NOT_UNIQUE_OR_ACTIONABLE');
    return { objectId, via: 'selector' };
  }
  if (typeof name === 'string' && name) {
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const doc = await session.send('DOM.getDocument', { depth: 0 });
    const found = await session.send('Accessibility.queryAXTree', { backendNodeId: doc.root.backendNodeId, accessibleName: name, ...(role ? { role } : {}) });
    const nodes = (found.nodes || []).filter(n => !n.ignored && n.backendDOMNodeId);
    if (nodes.length === 0) throw new Error('AX_TARGET_NOT_FOUND');
    if (nodes.length > 1) throw new Error('AX_TARGET_NOT_UNIQUE:' + nodes.length);
    const resolved = await session.send('DOM.resolveNode', { backendNodeId: nodes[0].backendDOMNodeId });
    if (!resolved.object?.objectId) throw new Error('AX_TARGET_UNRESOLVED');
    return { objectId: resolved.object.objectId, via: 'accessibility' };
  }
  throw new Error('SELECTOR_OR_ROLE_NAME_REQUIRED');
}

// Dialogs are dismissed, never accepted: a confirm() that nobody asked the operator about does not get a yes.
export async function watchDialogs(session) {
  const seen = [];
  const off = session.on('Page.javascriptDialogOpening', params => {
    seen.push({ type: String(params.type || ''), message: String(params.message || '').slice(0, 200) });
    session.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  });
  try { await session.send('Page.enable'); } catch { /* dialogs are then simply not seen */ }
  return { seen, off };
}

export async function trustedClick(session, point) {
  const base = { x: point.x, y: point.y, button: 'left', clickCount: 1 };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await session.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await session.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
}

export async function trustedKey(session, key, modifiers = 0) {
  const k = KEYS[key];
  const common = { key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
  await session.send('Input.dispatchKeyEvent', { ...common, type: k.text ? 'keyDown' : 'rawKeyDown', ...(k.text ? { text: k.text } : {}) });
  await session.send('Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
}

// evaluate(session, expression) and observe(session) belong to the bridge; they are passed in so this file has no
// import cycle and can be tested with a fake session.
export function createInputActions({ evaluate, observe }) {
  async function actSession(session, { selector, role, name, text, key, modifiers, expectedUrl, expect }, kind) {
    if (!['click', 'type', 'press'].includes(kind)) throw new Error('ACTION_KIND_UNSUPPORTED');
    if (kind === 'press') {
      if (!Object.hasOwn(KEYS, key)) throw new Error('KEY_NOT_SUPPORTED');
    } else if (!(typeof selector === 'string' && selector) && !(typeof name === 'string' && name)) throw new Error('SELECTOR_REQUIRED');
    if (kind === 'type' && typeof text !== 'string') throw new Error('TEXT_REQUIRED');
    const before = await observe(session);
    if (expectedUrl && before.url !== expectedUrl) throw new Error('STALE_PAGE');
    const mask = (Array.isArray(modifiers) ? modifiers : []).reduce((m, x) => m | (MODIFIERS[String(x).toLowerCase()] || 0), 0);
    const predicate = expect?.url
      ? `location.href===${JSON.stringify(expect.url)}`
      : expect?.selector
        ? `(() => {const e=document.querySelector(${JSON.stringify(expect.selector)}); if(!e)return false; const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';})()`
        : null;
    const alreadySatisfied = predicate ? await evaluate(session, predicate) : false;
    const dialogs = await watchDialogs(session);
    const seen = () => (dialogs.seen.length ? { dialogs: dialogs.seen } : {});
    try {
      // Everything up to the first input event may throw: nothing has been sent yet, so nothing is "unknown".
      let target = null, info = null;
      if (kind === 'press') {
        const onPassword = await evaluate(session, "(() => { const a = document.activeElement; return !!(a && a.tagName === 'INPUT' && a.type === 'password'); })()");
        if (onPassword) throw new Error('PASSWORD_FIELD_REFUSED');
      } else {
        target = await resolveTarget(session, { selector, role, name });
        info = (await callOn(session, target.objectId, TARGET_FN)).result?.value;
        if (!info || info.disabled || info.w <= 0 || info.h <= 0) throw new Error('TARGET_NOT_UNIQUE_OR_ACTIONABLE');
        if (info.covered) throw new Error('TARGET_COVERED');
        if (kind === 'type' && info.password) throw new Error('PASSWORD_FIELD_REFUSED');
      }
      // From here an input may have reached the page: a failure is an unknown outcome and is not repeated blindly.
      try {
        let input = 'trusted', verified = false;
        if (kind === 'press') await trustedKey(session, key, mask);
        else {
          try {
            if (kind === 'click') await trustedClick(session, info);
            else { await callOn(session, target.objectId, FOCUS_FN); await session.send('Input.insertText', { text }); }
          } catch (error) {
            // Input.* is unavailable (an embedded or older browser): a script does it, and the receipt says so.
            if (target.via !== 'selector') throw error;
            input = 'synthetic';
            const script = kind === 'click'
              ? 'e.click();'
              : `e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`;
            await evaluate(session, `(() => { const es=document.querySelectorAll(${JSON.stringify(selector)});if(es.length!==1)throw new Error('TARGET_CHANGED');const e=es[0];e.focus();${script}return true; })()`);
          }
          if (kind === 'type') verified = (await callOn(session, target.objectId, READ_FN)).result?.value === text;
        }
        // A real asynchronous postcondition: a click may await an API response before anything renders.
        if (kind !== 'type' && predicate && !alreadySatisfied) {
          const deadline = Date.now() + 5000;
          do { verified = Boolean(await evaluate(session, predicate)); if (verified) break; await new Promise(r => setTimeout(r, 100)); } while (Date.now() < deadline);
        }
        return { ok: true, verified: Boolean(verified), input, via: target?.via || 'keyboard', ...seen(), observation: await observe(session) };
      } catch (error) {
        return { ok: false, verified: false, outcomeUnknown: true, error: error.message, ...seen() };
      }
    } finally { dialogs.off(); }
  }

  // What a person could click or type into, by the names the page itself gives them.
  async function axSession(session, limit = 80) {
    await session.send('Accessibility.enable');
    const tree = await session.send('Accessibility.getFullAXTree', {});
    const nodes = (tree.nodes || [])
      .filter(n => !n.ignored && AX_ROLES.has(String(n.role?.value || '')) && String(n.name?.value || '').trim())
      .slice(0, limit)
      .map(n => ({ role: n.role.value, name: String(n.name.value).trim().replace(/\s+/g, ' ').slice(0, 100), ...(n.value?.value ? { value: String(n.value.value).slice(0, 60) } : {}) }));
    return { ok: true, observed: true, at: new Date().toISOString(), nodes };
  }

  return { actSession, axSession };
}
