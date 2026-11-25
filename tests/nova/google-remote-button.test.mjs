// Google refuses to be framed (X-Frame-Options: SAMEORIGIN on remotedesktop.google.com), so the Live Terminal opens it in its own window.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../runtime/src/components/AuraLiveTerminalWindow.tsx', import.meta.url), 'utf8');

test('the Live Terminal opens Google Remote in a separate window, never inside an iframe', () => {
  assert.ok(source.includes("GOOGLE_REMOTE_URL = 'https://remotedesktop.google.com/access'"));
  assert.ok(/window\.open\(GOOGLE_REMOTE_URL, 'jaco-google-remote', 'popup,[^']*noopener'\)/.test(source), 'a popup that cannot reach back to the interface');
  assert.ok(source.includes('onClick={openGoogleRemote}'));
  assert.equal(/<iframe/i.test(source), false);
});
