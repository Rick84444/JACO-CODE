// The Nova bridge clicks, types and presses keys with real input events, names targets by role and name, and
// stays inside the browser scope. A scripted fake session stands in for Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { actSession, axSession } from '../../agents/nova-bridge.mjs';
import { createInputActions, deepResolver, checkUploadFiles, listDownloadFiles } from '../../agents/lib/browser-input.mjs';
import { inputAllowed, browserScope, mutationsEnabled, hardDenied, isPrivateHost } from '../../agents/lib/browser-scope.mjs';

const OBSERVATION = { url: 'https://example.test/', title: 't', text: '', targets: [] };

// A page that answers the way Chrome does for the calls the bridge makes.
function page({ unique = true, covered = false, password = false, activePassword = false, value = '', inputFails = false, axNodes = [], tree = [], predicate = [], dialog = null } = {}) {
  const calls = [];
  const handlers = new Map();
  let typed = '';
  const session = {
    calls,
    on(method, fn) { handlers.set(method, fn); return () => handlers.delete(method); },
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        const e = String(params.expression);
        if (e.includes("split('>>>')")) return unique ? { result: { objectId: 'node-1' } } : { result: {} };
        if (e.includes('activeElement')) return { result: { value: activePassword } };
        if (e.includes("querySelectorAll('a,button,input")) return { result: { value: OBSERVATION } };
        if (e.includes('location.href===') || e.includes('document.querySelector(')) return { result: { value: predicate.length ? predicate.shift() : false } };
        return { result: { value: true } };
      }
      if (method === 'Runtime.callFunctionOn') {
        const fn = String(params.functionDeclaration);
        if (fn.includes('scrollIntoView')) return { result: { value: { x: 60, y: 35, w: 100, h: 30, covered, password, disabled: false, tag: 'button' } } };
        if (fn.includes('this.focus()')) return { result: { value: true } };
        return { result: { value: typed || value } };
      }
      if (method === 'Input.insertText') { if (inputFails) throw new Error('Input domain unavailable'); typed = params.text; return {}; }
      if (method.startsWith('Input.')) {
        if (inputFails) throw new Error('Input domain unavailable');
        if (dialog && params.type === 'mouseReleased') handlers.get('Page.javascriptDialogOpening')?.(dialog);
        return {};
      }
      if (method === 'DOM.getDocument') return { root: { backendNodeId: 1 } };
      if (method === 'Accessibility.queryAXTree') return { nodes: axNodes };
      if (method === 'DOM.resolveNode') return { object: { objectId: 'node-ax' } };
      if (method === 'Accessibility.getFullAXTree') return { nodes: tree };
      return {};
    },
  };
  return session;
}
const names = s => s.calls.map(c => c.method);

test('a click is a real mouse move, press and release at the element\'s centre', async () => {
  const s = page();
  const r = await actSession(s, { selector: 'button.save' }, 'click');
  assert.equal(r.ok, true);
  assert.equal(r.input, 'trusted');
  assert.equal(r.via, 'selector');
  const mouse = s.calls.filter(c => c.method === 'Input.dispatchMouseEvent').map(c => [c.params.type, c.params.x, c.params.y]);
  assert.deepEqual(mouse, [['mouseMoved', 60, 35], ['mousePressed', 60, 35], ['mouseReleased', 60, 35]]);
  assert.equal(r.verified, false, 'an acknowledged click without a postcondition is not proof');
});

test('the postcondition decides whether a click is verified', async () => {
  const already = await actSession(page({ predicate: [true, true] }), { selector: 'b', expect: { url: OBSERVATION.url } }, 'click');
  assert.equal(already.verified, false, 'a condition that already held proves nothing');
  const changed = await actSession(page({ predicate: [false, true] }), { selector: 'b', expect: { selector: '#saved' } }, 'click');
  assert.equal(changed.verified, true);
});

test('nothing is sent when the target is missing, ambiguous, covered or a password field', async () => {
  for (const [options, kind, expected] of [
    [{ unique: false }, 'click', /TARGET_NOT_UNIQUE/],
    [{ covered: true }, 'click', /TARGET_COVERED/],
    [{ password: true }, 'type', /PASSWORD_FIELD_REFUSED/],
    [{ activePassword: true }, 'press', /PASSWORD_FIELD_REFUSED/],
  ]) {
    const s = page(options);
    await assert.rejects(actSession(s, { selector: 'input', text: 'x', key: 'Enter' }, kind), expected);
    assert.ok(!names(s).some(m => m.startsWith('Input.')), `${JSON.stringify(options)} sent input`);
  }
  await assert.rejects(actSession(page(), { selector: 'b', expectedUrl: 'https://other.test/' }, 'click'), /STALE_PAGE/);
  await assert.rejects(actSession(page(), { key: 'F13' }, 'press'), /KEY_NOT_SUPPORTED/);
  await assert.rejects(actSession(page(), {}, 'click'), /SELECTOR_REQUIRED/);
});

test('typing selects the field, inserts the text as input and reads the value back', async () => {
  const s = page();
  const r = await actSession(s, { selector: 'input[name=q]', text: 'hej världen' }, 'type');
  assert.equal(r.ok, true);
  assert.equal(r.verified, true, 'the value was read back from the page');
  assert.ok(names(s).indexOf('Input.insertText') > names(s).indexOf('Runtime.callFunctionOn'));
  assert.equal(s.calls.find(c => c.method === 'Input.insertText').params.text, 'hej världen');
});

test('a key press is a real key down and key up, with modifiers', async () => {
  const s = page();
  const r = await actSession(s, { key: 'Enter', modifiers: ['shift'] }, 'press');
  assert.equal(r.ok, true);
  const keys = s.calls.filter(c => c.method === 'Input.dispatchKeyEvent').map(c => [c.params.type, c.params.key, c.params.modifiers, c.params.text]);
  assert.deepEqual(keys, [['keyDown', 'Enter', 8, '\r'], ['keyUp', 'Enter', 8, undefined]]);
  assert.equal(r.via, 'keyboard');
});

test('a target can be named by its accessible role and name, and must be unique', async () => {
  const node = { ignored: false, backendDOMNodeId: 7 };
  const s = page({ axNodes: [node] });
  const r = await actSession(s, { role: 'button', name: 'Spara' }, 'click');
  assert.equal(r.ok, true);
  assert.equal(r.via, 'accessibility');
  assert.deepEqual(s.calls.find(c => c.method === 'Accessibility.queryAXTree').params.accessibleName, 'Spara');
  await assert.rejects(actSession(page({ axNodes: [node, { ...node, backendDOMNodeId: 8 }] }), { role: 'button', name: 'Spara' }, 'click'), /AX_TARGET_NOT_UNIQUE:2/);
  await assert.rejects(actSession(page({ axNodes: [] }), { name: 'Finns inte' }, 'click'), /AX_TARGET_NOT_FOUND/);
  await assert.rejects(actSession(page({ axNodes: [{ ignored: true, backendDOMNodeId: 9 }] }), { name: 'Dold' }, 'click'), /AX_TARGET_NOT_FOUND/);
});

test('the accessibility list names what can be clicked or typed into', async () => {
  const tree = [
    { ignored: false, role: { value: 'button' }, name: { value: ' Spara  ändringar ' } },
    { ignored: false, role: { value: 'textbox' }, name: { value: 'Sök' }, value: { value: 'abc' } },
    { ignored: false, role: { value: 'paragraph' }, name: { value: 'Brödtext' } },
    { ignored: true, role: { value: 'button' }, name: { value: 'Gömd' } },
    { ignored: false, role: { value: 'link' }, name: { value: '' } },
  ];
  const r = await axSession(page({ tree }));
  assert.deepEqual(r.nodes, [{ role: 'button', name: 'Spara ändringar' }, { role: 'textbox', name: 'Sök', value: 'abc' }]);
});

test('a dialog is dismissed, never accepted, and the receipt says it appeared', async () => {
  const s = page({ dialog: { type: 'confirm', message: 'Delete everything?' } });
  const r = await actSession(s, { selector: 'button.delete' }, 'click');
  assert.deepEqual(r.dialogs, [{ type: 'confirm', message: 'Delete everything?' }]);
  const handled = s.calls.filter(c => c.method === 'Page.handleJavaScriptDialog');
  assert.equal(handled.length, 1);
  assert.equal(handled[0].params.accept, false);
});

test('without Input.* a click falls back to a script and the receipt says so; a failure after input is not repeated', async () => {
  const r = await actSession(page({ inputFails: true }), { selector: 'button' }, 'click');
  assert.equal(r.ok, true);
  assert.equal(r.input, 'synthetic');
  const byName = await actSession(page({ inputFails: true, axNodes: [{ ignored: false, backendDOMNodeId: 7 }] }), { name: 'Spara' }, 'click');
  assert.equal(byName.ok, false, 'there is no script fallback for an accessibility target');
  assert.equal(byName.outcomeUnknown, true);
});

test('browser scope: broad web by default in Aura, hard denials always, the old allow-list elsewhere', () => {
  const aura = { JACO_AURA_UNIFIED_RUNTIME: '1' };
  assert.equal(browserScope(aura), 'broad_web');
  assert.equal(browserScope({}), 'origins');
  assert.equal(browserScope({ ...aura, JACO_BROWSER_SCOPE: 'origins' }), 'origins');
  assert.equal(inputAllowed('https://news.example.org/story', aura), true);
  // JACO's own GUI and the private network are not "the web": an agent must not be able to approve its own approvals.
  for (const url of ['http://127.0.0.1:3000/', 'http://localhost:3000/', 'http://[::1]:3000/', 'http://192.168.1.10/', 'http://10.0.0.5/', 'http://172.20.0.1/', 'http://printer.local/', 'http://169.254.169.254/'])
    assert.equal(inputAllowed(url, aura), false, url);
  assert.equal(isPrivateHost('8.8.8.8'), false);
  assert.equal(isPrivateHost('172.32.0.1'), false);
  for (const url of ['https://accounts.google.com/signin', 'https://shop.example.org/checkout', 'https://example.org/wp-login.php', 'https://www.paypal.com/pay', 'file:///C:/secret.txt', 'javascript:alert(1)', 'not a url'])
    assert.equal(inputAllowed(url, aura), false, url);
  assert.equal(hardDenied('https://example.org/login'), 'AUTH_OR_PAYMENT_SURFACE');
  assert.equal(inputAllowed('https://news.example.org/', {}), false);
  assert.equal(inputAllowed('https://news.example.org/', { JACO_BROWSER_ALLOWED_ORIGINS: 'https://news.example.org' }), true);
});

test('browser mutations are on in Aura unless switched off, and off elsewhere unless switched on', () => {
  assert.equal(mutationsEnabled({ JACO_AURA_UNIFIED_RUNTIME: '1' }), true);
  assert.equal(mutationsEnabled({ JACO_AURA_UNIFIED_RUNTIME: '1', JACO_GATEWAY_ALLOW_MUTATIONS: '0' }), false);
  assert.equal(mutationsEnabled({}), false);
  assert.equal(mutationsEnabled({ JACO_GATEWAY_ALLOW_MUTATIONS: '1' }), true);
});

test('a target can sit inside a shadow root or a same-origin frame, still one match at a time', () => {
  const plain = deepResolver('button.save');
  assert.match(plain, /split\('>>>'\)/);
  assert.doesNotMatch(plain, /contentDocument/);
  const deep = deepResolver('x-card >>> button.save', 'iframe#checkout');
  assert.match(deep, /querySelectorAll\("iframe#checkout"\)/);
  assert.match(deep, /contentDocument/);
  assert.match(deep, /shadowRoot/);
  assert.match(deep, /found\.length !== 1\) return null/, 'a plural match is refused at every step');
});

test('uploads: only files inside the given roots, never credentials, bounded in number and size', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  try {
    const ok = path.join(root, 'report.pdf'); fs.writeFileSync(ok, 'x');
    const secret = path.join(root, '.env'); fs.writeFileSync(secret, 'K=v');
    const key = path.join(root, 'deploy.pem'); fs.writeFileSync(key, 'k');
    const elsewhere = path.join(outside, 'notes.txt'); fs.writeFileSync(elsewhere, 'n');
    assert.deepEqual(checkUploadFiles([ok], [root]), [fs.realpathSync(ok)]);
    assert.throws(() => checkUploadFiles([secret], [root]), /UPLOAD_PATH_REFUSED/);
    assert.throws(() => checkUploadFiles([key], [root]), /UPLOAD_PATH_REFUSED/);
    assert.throws(() => checkUploadFiles([elsewhere], [root]), /UPLOAD_PATH_OUTSIDE_ROOTS/);
    assert.throws(() => checkUploadFiles(['relative.txt'], [root]), /UPLOAD_PATH_REFUSED/);
    assert.throws(() => checkUploadFiles([path.join(root, 'missing.txt')], [root]), /UPLOAD_FILE_MISSING/);
    assert.throws(() => checkUploadFiles([root], [root]), /UPLOAD_NOT_A_FILE/);
    assert.throws(() => checkUploadFiles([], [root]), /UPLOAD_FILES_INVALID/);
    assert.throws(() => checkUploadFiles(Array(11).fill(ok), [root]), /UPLOAD_FILES_INVALID/);
    assert.throws(() => checkUploadFiles([ok], []), /UPLOAD_NOT_CONFIGURED/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('an upload attaches the checked files to one file input and reads the names back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-'));
  try {
    const file = path.join(root, 'report.pdf'); fs.writeFileSync(file, 'pdf');
    const s = page();
    const original = s.send.bind(s);
    s.send = async (method, params = {}) => {
      if (method === 'Runtime.callFunctionOn' && String(params.functionDeclaration).includes('scrollIntoView')) return { result: { value: { x: 1, y: 1, w: 0, h: 0, covered: false, password: false, disabled: false, tag: 'input', fileInput: true } } };
      if (method === 'Runtime.callFunctionOn' && String(params.functionDeclaration).includes('this.files')) return { result: { value: ['report.pdf'] } };
      return original(method, params);
    };
    const actions = createInputActions({ evaluate: async (session, expression) => (await session.send('Runtime.evaluate', { expression })).result.value, observe: async () => OBSERVATION, uploads: { roots: [root] } });
    const r = await actions.actSession(s, { selector: 'input[type=file]', files: [file], expectedUrl: OBSERVATION.url }, 'upload');
    assert.equal(r.ok, true);
    assert.equal(r.verified, true);
    assert.deepEqual(r.uploaded, ['report.pdf']);
    assert.deepEqual(s.calls.find(c => c.method === 'DOM.setFileInputFiles').params.files, [fs.realpathSync(file)]);
    // Anything but a file input is refused before the browser is touched.
    const notFile = page();
    const send = notFile.send.bind(notFile);
    notFile.send = async (method, params = {}) => (method === 'Runtime.callFunctionOn' && String(params.functionDeclaration).includes('scrollIntoView')
      ? { result: { value: { x: 1, y: 1, w: 10, h: 10, covered: false, password: false, disabled: false, tag: 'button', fileInput: false } } } : send(method, params));
    await assert.rejects(actions.actSession(notFile, { selector: 'button', files: [file], expectedUrl: OBSERVATION.url }, 'upload'), /NOT_A_FILE_INPUT/);
    assert.ok(!notFile.calls.some(c => c.method === 'DOM.setFileInputFiles'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a click that opens a new tab reports it and adopts it; new downloads are reported by name and digest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-'));
  try {
    const adopted = [];
    let listed = [{ id: 'a', url: 'https://example.test/' }];
    const s = page();
    const original = s.send.bind(s);
    s.send = async (method, params = {}) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
        listed = [...listed, { id: 'b', url: 'https://other.example/popup' }];
        fs.writeFileSync(path.join(dir, 'invoice.pdf'), 'pdf-bytes');
      }
      return original(method, params);
    };
    const actions = createInputActions({
      evaluate: async (session, expression) => (await session.send('Runtime.evaluate', { expression })).result.value, observe: async () => OBSERVATION,
      tabs: { list: async () => listed, adopt: tab => adopted.push(tab.id) }, downloads: { dir }, settleMs: 5,
    });
    const r = await actions.actSession(s, { selector: 'a.download', expectedUrl: OBSERVATION.url }, 'click');
    assert.deepEqual(r.newTabs, [{ id: 'b', url: 'https://other.example/popup' }]);
    assert.deepEqual(adopted, ['b']);
    assert.equal(r.downloads.length, 1);
    assert.equal(r.downloads[0].name, 'invoice.pdf');
    assert.match(r.downloads[0].sha256, /^[0-9a-f]{64}$/);
    assert.ok(s.calls.some(c => c.method === 'Page.setDownloadBehavior' && c.params.downloadPath === dir));
    assert.deepEqual(listDownloadFiles(dir).map(f => f.name), ['invoice.pdf']);
    assert.equal(listDownloadFiles(path.join(dir, 'nope')).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
