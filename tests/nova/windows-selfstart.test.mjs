import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').split('\r\n').join('\n');

test('the installer offers sign-in autostart that needs no assistant and no browser window', () => {
  const iss = read('windows/product/JACO.iss');
  assert.match(iss, /^Name: autostart;/m);
  assert.doesNotMatch(iss, /^Name: autostart;.*unchecked/m, 'autostart is on by default');
  assert.match(iss, /CurrentVersion\\Run"[^\n]*JACO-launch\.vbs""[^\n]*--background[^\n]*Tasks: autostart/);
  assert.match(iss, /uninsdeletevalue/);
});

test('background launch is silent and still goes through the canonical launcher', () => {
  const vbs = read('windows/product/JACO-launch.vbs');
  assert.match(vbs, /--background/);
  assert.match(vbs, /-NoBrowser/);
  assert.match(vbs, /And Not background/);
  assert.match(vbs, /Start-JACO\.ps1/);
});

test('the launcher follows a runtime that was moved off the default port', () => {
  const ps = read('windows/product/Start-JACO.ps1');
  assert.match(ps, /status\.json/);
  assert.doesNotMatch(ps, /Invoke-RestMethod -Uri 'http:\/\/127\.0\.0\.1:3000/);
});

test('emergency stop follows resolved ports and spares a foreign program on a default port', () => {
  const ps = read('agents/emergency-stop.ps1');
  assert.match(ps, /resolved-ports\.json/);
  assert.match(ps, /\$_ -ne \$requested/);
});
