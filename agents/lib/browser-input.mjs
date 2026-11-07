// Browser input for the Nova bridge: real input events, targets named by the page's own accessibility tree or found
// through shadow roots and same-origin frames, file upload, downloads, new tabs and dialogs that are dismissed.
//
// Why real events. A script's el.click() and a value assigned by script do not reach React-controlled fields,
// framework buttons or anything that checks event.isTrusted. Input.dispatchMouseEvent, Input.insertText and
// Input.dispatchKeyEvent are what the browser itself produces for a person, so a page treats them as one.
//
// What does not change. The target is resolved first (one CSS selector match, or one accessible role and name) and
// located from the page, never from coordinates an agent supplies; the page is read again afterwards; a password
// field is never typed into; the origin policy (browser-scope.mjs) and the action journal in front of this file stay.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Where an element is, in the top-level viewport: through shadow roots (their host may be what the point hits) and up
// through same-origin frames (each frame's own offset is added).
const TARGET_FN = `function () {
  const e = this; e.scrollIntoView({ block: 'center', inline: 'center' });
  const r = e.getBoundingClientRect();
  let x = r.x + r.width / 2, y = r.y + r.height / 2;
  const h = e.ownerDocument.elementFromPoint(x, y);
  const hosts = [];
  for (let n = e; n;) { const root = n.getRootNode(); if (root && root.host) { hosts.push(root.host); n = root.host; } else break; }
  const covered = !(h && (h === e || e.contains(h) || h.contains(e) || hosts.includes(h)));
  let w = e.ownerDocument.defaultView;
  while (w && w.frameElement) { const f = w.frameElement.getBoundingClientRect(); x += f.x; y += f.y; w = w.parent; }
  return { x, y, w: r.width, h: r.height, covered, password: e.tagName === 'INPUT' && e.type === 'password',
    disabled: !!e.disabled, tag: e.tagName.toLowerCase(), fileInput: e.tagName === 'INPUT' && e.type === 'file' };
}`;
const FOCUS_FN = `function () {
  this.focus();
  if (typeof this.select === 'function') { try { this.select(); } catch {} }
  else if (this.isContentEditable) { const r = document.createRange(); r.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  return true;
}`;
const READ_FN = 'function () { return this.isContentEditable ? this.innerText : this.value; }';
const FILES_FN = 'function () { return Array.from(this.files || []).map(f => f.name); }';

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

// A CSS selector, optionally "host >>> inner" to pass through a shadow root, optionally inside one same-origin frame.
export function deepResolver(selector, frame) {
  return `(() => {
    let scope = document;
    ${frame ? `const frames = document.querySelectorAll(${JSON.stringify(frame)}); if (frames.length !== 1) return null;
    try { scope = frames[0].contentDocument; } catch { return null; } if (!scope) return null;` : ''}
    const parts = ${JSON.stringify(selector)}.split('>>>').map(x => x.trim());
    for (let i = 0; i < parts.length; i++) {
      const found = scope.querySelectorAll(parts[i]); if (found.length !== 1) return null;
      if (i === parts.length - 1) return found[0];
      scope = found[0].shadowRoot; if (!scope) return null;
    }
    return null;
  })()`;
}

// The node a request names: one CSS selector match, or one accessible role+name. Never "the first of several".
export async function resolveTarget(session, { selector, frame, role, name }) {
  if (typeof selector === 'string' && selector) {
    const objectId = (await session.send('Runtime.evaluate', { expression: deepResolver(selector, typeof frame === 'string' ? frame : '') })).result?.objectId;
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
  let pressAcknowledged = false;
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await session.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    pressAcknowledged = true;
    await session.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
  } catch (error) {
    // Once pressing was acknowledged, a lost release acknowledgement is
    // ambiguous: a synthetic retry could click twice.
    if (pressAcknowledged && error && typeof error === 'object') error.inputDispatchStarted = true;
    throw error;
  }
}

export async function trustedKey(session, key, modifiers = 0) {
  const k = KEYS[key];
  const common = { key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
  await session.send('Input.dispatchKeyEvent', { ...common, type: k.text ? 'keyDown' : 'rawKeyDown', ...(k.text ? { text: k.text } : {}) });
  await session.send('Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
}

// Only explicit protocol "method unavailable" errors authorize a script
// fallback. Timeouts, lost acknowledgements and transport errors never do.
function inputMethodUnavailable(error) {
  return error?.code === -32601 || /(?:method not found|unknown method|wasn't found|Input domain unavailable)/i.test(String(error?.message || ''));
}

// Files an agent may hand to a page: inside the roots it was given, never a credential, a bounded number and size.
const SECRET_PATH = /(^|[\\/])(\.env(\..*)?|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc|id_rsa[^\\/]*|id_ed25519[^\\/]*|credentials[^\\/]*|secrets?[^\\/]*|[^\\/]*\.pem|[^\\/]*\.key)([\\/]|$)/i;
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export function checkUploadFiles(files, roots, fsImpl = fs) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_UPLOAD_FILES || files.some(f => typeof f !== 'string')) throw new Error('UPLOAD_FILES_INVALID');
  if (!Array.isArray(roots) || roots.length === 0) throw new Error('UPLOAD_NOT_CONFIGURED');
  const real = roots.map(r => { try { return fsImpl.realpathSync(r); } catch { return null; } }).filter(Boolean);
  return files.map(file => {
    if (!path.isAbsolute(file) || SECRET_PATH.test(file)) throw new Error('UPLOAD_PATH_REFUSED');
    let resolved, stat;
    try { resolved = fsImpl.realpathSync(file); stat = fsImpl.statSync(resolved); } catch { throw new Error('UPLOAD_FILE_MISSING'); }
    if (!stat.isFile()) throw new Error('UPLOAD_NOT_A_FILE');
    if (stat.size > MAX_UPLOAD_BYTES) throw new Error('UPLOAD_TOO_LARGE');
    if (SECRET_PATH.test(resolved) || !real.some(root => resolved === root || resolved.startsWith(root + path.sep))) throw new Error('UPLOAD_PATH_OUTSIDE_ROOTS');
    return resolved;
  });
}

// Download folder bookkeeping: what is new after an action. Names and digests only; content never leaves the disk.
export function listDownloadFiles(dir, fsImpl = fs) {
  try {
    return fsImpl.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => {
      const full = path.join(dir, e.name), st = fsImpl.statSync(full);
      return { name: e.name, bytes: st.size, mtimeMs: st.mtimeMs, partial: /\.crdownload$/i.test(e.name) };
    });
  } catch { return []; }
}
export function digestFile(file, fsImpl = fs) {
  try { const st = fsImpl.statSync(file); return st.size <= 50 * 1024 * 1024 ? createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex') : null; } catch { return null; }
}

// evaluate(session, expression) and observe(session) belong to the bridge; they are passed in so this file has no
// import cycle and can be tested with a fake session. tabs: { list(), adopt(tab) }; downloads: { dir };
// uploads: { roots }. Each is optional.
export function createInputActions({ evaluate, observe, tabs = null, downloads = null, uploads = null, fsImpl = fs, settleMs = 300, navigationSettleMs = 4000 }) {
  const pageTabs = async () => { try { return tabs ? await tabs.list() : []; } catch { return []; } };

  async function awaitDownloads(before) {
    const seenNames = new Set(before.map(f => `${f.name}:${f.mtimeMs}`));
    const fresh = () => listDownloadFiles(downloads.dir, fsImpl).filter(f => !seenNames.has(`${f.name}:${f.mtimeMs}`));
    const deadline = Date.now() + 1200;
    let now = fresh();
    while (Date.now() < deadline && now.length === 0) { await new Promise(r => setTimeout(r, 150)); now = fresh(); }
    const partialDeadline = Date.now() + 8000;
    while (now.some(f => f.partial) && Date.now() < partialDeadline) { await new Promise(r => setTimeout(r, 250)); now = fresh(); }
    return now.filter(f => !f.partial).map(f => ({ name: f.name, bytes: f.bytes, sha256: digestFile(path.join(downloads.dir, f.name), fsImpl) }));
  }

  async function actSession(session, { selector, frame, role, name, text, key, modifiers, files, expectedUrl, expect }, kind) {
    if (!['click', 'type', 'press', 'upload'].includes(kind)) throw new Error('ACTION_KIND_UNSUPPORTED');
    if (kind === 'press') {
      if (!Object.hasOwn(KEYS, key)) throw new Error('KEY_NOT_SUPPORTED');
    } else if (!(typeof selector === 'string' && selector) && !(typeof name === 'string' && name)) throw new Error('SELECTOR_REQUIRED');
    if (kind === 'type' && typeof text !== 'string') throw new Error('TEXT_REQUIRED');
    const uploadPaths = kind === 'upload' ? checkUploadFiles(files, uploads?.roots, fsImpl) : null;
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
        target = await resolveTarget(session, { selector, frame, role, name });
        info = (await callOn(session, target.objectId, TARGET_FN)).result?.value;
        if (!info || info.disabled) throw new Error('TARGET_NOT_UNIQUE_OR_ACTIONABLE');
        if (kind === 'upload') { if (!info.fileInput) throw new Error('NOT_A_FILE_INPUT'); }
        else {
          if (info.w <= 0 || info.h <= 0) throw new Error('TARGET_NOT_UNIQUE_OR_ACTIONABLE');
          if (info.covered) throw new Error('TARGET_COVERED');
          if (kind === 'type' && info.password) throw new Error('PASSWORD_FIELD_REFUSED');
        }
      }
      const tabsBefore = kind === 'click' || kind === 'press' ? new Set((await pageTabs()).map(t => t.id)) : null;
      const filesBefore = downloads && (kind === 'click' || kind === 'press') ? listDownloadFiles(downloads.dir, fsImpl) : null;
      if (filesBefore) { try { await session.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads.dir }); } catch { /* downloads are then not collected */ } }
      // From here an input may have reached the page: a failure is an unknown outcome and is not repeated blindly.
      try {
        let input = 'trusted', verified = false, uploaded = null;
        if (kind === 'press') await trustedKey(session, key, mask);
        else if (kind === 'upload') {
          await session.send('DOM.setFileInputFiles', { files: uploadPaths, objectId: target.objectId });
          uploaded = (await callOn(session, target.objectId, FILES_FN)).result?.value || [];
          verified = uploaded.length === uploadPaths.length && uploadPaths.every((p, i) => uploaded[i] === path.basename(p));
        } else {
          try {
            if (kind === 'click') await trustedClick(session, info);
            else { await callOn(session, target.objectId, FOCUS_FN); await session.send('Input.insertText', { text }); }
          } catch (error) {
            // Fallback only for an explicitly unsupported CDP input method.
            // Do not repeat a potentially dispatched click or insertion after a timeout.
            if (!inputMethodUnavailable(error) || error?.inputDispatchStarted || target.via !== 'selector' || frame || String(selector).includes('>>>')) throw error;
            input = 'synthetic';
            const script = kind === 'click'
              ? 'e.click();'
              : `e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`;
            await evaluate(session, `(() => { const es=document.querySelectorAll(${JSON.stringify(selector)});if(es.length!==1)throw new Error('TARGET_CHANGED');const e=es[0];e.focus();${script}return true; })()`);
          }
          if (kind === 'type') verified = (await callOn(session, target.objectId, READ_FN)).result?.value === text;
        }
        // A real asynchronous postcondition: a click may await an API response before anything renders.
        if ((kind === 'click' || kind === 'press') && predicate && !alreadySatisfied) {
          const deadline = Date.now() + 5000;
          do { verified = Boolean(await evaluate(session, predicate)); if (verified) break; await new Promise(r => setTimeout(r, 100)); } while (Date.now() < deadline);
        }
        const extra = {};
        if (tabsBefore) {
          await new Promise(r => setTimeout(r, settleMs));
          const created = (await pageTabs()).filter(t => !tabsBefore.has(t.id));
          if (created.length) { for (const tab of created) tabs.adopt(tab); extra.newTabs = created.map(t => ({ id: t.id, url: String(t.url || '').slice(0, 300) })); }
        }
        if (filesBefore) { const got = await awaitDownloads(filesBefore); if (got.length) extra.downloads = got; }
        let observation = await observe(session);
        // A link to a slow site has not left the page yet when the click returns. Without this wait the click was
        // reported as having changed nothing, and the mission stopped as if the outcome were unknown (2026-11-07).
        if (kind === 'click' && !verified && before?.url && observation?.url === before.url) {
          const settle = Date.now() + navigationSettleMs;
          while (Date.now() < settle) {
            await new Promise(r => setTimeout(r, 250));
            const href = await evaluate(session, 'location.href').catch(() => null);
            if (href && href !== before.url) { observation = await observe(session).catch(() => observation); break; }
          }
        }
        // A click that named no expectation is still verified by what the browser itself saw it do: the page moved
        // to another address, a tab opened or a file arrived. A click that changed nothing stays unverified.
        // When the model named an expectation that did not come true but the page did move, the click happened and its
        // effect was seen: it is reported as verified with expectationMet:false, so the model reads where it landed
        // instead of repeating the whole task (a real run clicked the right link three times and never finished).
        if (kind === 'click' && !verified) {
          if (predicate) extra.expectationMet = false;
          if (observation?.url && before?.url && observation.url !== before.url) { verified = true; extra.effect = 'navigated'; }
          else if (extra.newTabs?.length) { verified = true; extra.effect = 'new-tab'; }
          else if (extra.downloads?.length) { verified = true; extra.effect = 'download'; }
        }
        return { ok: true, verified: Boolean(verified), input, via: target?.via || 'keyboard', ...(uploaded ? { uploaded } : {}), ...extra, ...seen(), observation };
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
