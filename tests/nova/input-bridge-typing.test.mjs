// The Windows 11 Notepad kept the first characters and repeated the last one when every key-down and key-up of a text was sent
// as one block ("Aura 444444444444444", 2026-11-25). Text is now sent one character at a time, and each character is re-verified
// against the foreground window by SendChecked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../../agents/input-bridge.ps1', import.meta.url), 'utf8');

test('type_text sends one character per SendChecked, with a pause, never one block', () => {
  const start = source.indexOf('public static void TypeBatch(string text)');
  const body = source.slice(start, source.indexOf('\n  }', start));
  assert.ok(start > 0, 'TypeBatch exists');
  assert.match(body, /for\(int i=0;i<text\.Length;i\+\+\)/);
  assert.match(body, /INPUT\[\] pair=new INPUT\[2\]/, 'a key-down and a key-up per character');
  assert.match(body, /SendChecked\(pair\)/);
  assert.match(body, /Thread\.Sleep\(/);
  assert.equal(/new INPUT\[text\.Length\*2\]/.test(body), false, 'the single block is gone');
});

test('the bridge still compiles and passes its own self test', { skip: process.platform !== 'win32' }, () => {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', new URL('../../agents/input-bridge.ps1', import.meta.url).pathname.replace(/^\//, ''), '-Op', 'self_test'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(JSON.parse(out.trim().split('\n').at(-1)).ok, true);
});
