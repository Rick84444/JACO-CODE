import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDesktopTraction } from '../../runtime/src/server/desktop/desktopTraction.mjs';
import { TargetTractionEngine, DomTractionEngine, NovaTractionEngine } from '../../runtime/src/server/nova/tractionCore.mjs';

test('Target Track is the same engine as the legacy DOM and Nova aliases', () => {
  assert.equal(TargetTractionEngine, DomTractionEngine);
  assert.equal(TargetTractionEngine, NovaTractionEngine);
});

const action = { type: 'invoke', hwnd: 321, selector: { automationId: 'saveBtn', name: 'Save', controlType: 'Button' } };
const target = () => ({ automationId: 'saveBtn', name: 'Save', controlType: 'Button', className: 'Button', enabled: true, offscreen: false, rect: { x: 100, y: 80, width: 90, height: 34 } });
const observation = (extras = {}) => ({
  window: { hwnd: 321, processId: 54, processName: 'code', rect: { x: 0, y: 0, width: 1400, height: 900 } },
  root: { controlType: 'Window', children: [target()] },
  ...extras,
});

test('Aura reuses canonical Target Track to lock a fresh Windows UIA target', () => {
  const initial = observation();
  const next = observation();
  const result = verifyDesktopTraction(initial, next, action);
  assert.equal(result.source, 'uia-dom-traction');
  assert.equal(result.verifiedTarget, true);
  assert.equal(result.state, 'VERIFYING');
  assert.equal(result.hwnd, 321);
  assert.equal(result.processId, 54);
  assert.ok(!JSON.stringify(result).includes('Save'), 'no control text persisted in lock evidence');
});

test('desktop traction refuses foreign apps, guessed windows and unbound targets', () => {
  assert.throws(() => verifyDesktopTraction(observation(), observation(), { ...action, hwnd: 999 }), /WINDOW_IDENTITY_CHANGED/);
  assert.throws(() => verifyDesktopTraction(observation(), observation({ window: { hwnd: 321, processId: 99, processName: 'code' } }), action), /APP_CHANGED/);
  assert.throws(() => verifyDesktopTraction(observation(), observation(), { ...action, selector: {} }), /SEMANTIC_TARGET_REQUIRED/);
  assert.throws(() => verifyDesktopTraction(observation(), observation(), { ...action, selector: { ...action.selector, index: 0 } }), /INDEX_NOT_STABLE/);
});

test('desktop traction refuses ambiguous or changed UIA elements before input', () => {
  const dupe = observation({ root: { children: [target(), target()] } });
  assert.throws(() => verifyDesktopTraction(observation(), dupe, action), /AMBIGUOUS_TARGET/);
  const renamed = observation({ root: { children: [{ ...target(), name: 'Save as' }] } });
  assert.throws(() => verifyDesktopTraction(observation(), renamed, { ...action, selector: { automationId: 'saveBtn' } }), /TARGET_CHANGED/);
  assert.throws(() => verifyDesktopTraction(observation(), renamed, action), /TARGET_MISSING/);
  const blocked = observation({ blocked: 'credential window', root: null });
  assert.throws(() => verifyDesktopTraction(observation(), blocked, action), /OBSERVATION_UNAVAILABLE/);
});

test('desktop traction rejects moved, stale or disabled targets and avoids false READY', () => {
  const moved = observation({ root: { children: [{ ...target(), rect: { x: 800, y: 80, width: 90, height: 34 } }] } });
  assert.throws(() => verifyDesktopTraction(observation(), moved, action), /TARGET_DRIFT/);
  const disabled = observation({ root: { children: [{ ...target(), enabled: false }] } });
  assert.throws(() => verifyDesktopTraction(observation(), disabled, action), /TARGET_MISSING/);
  const now = Date.now();
  assert.throws(() => verifyDesktopTraction(observation(), observation(), action, { firstAt: now - 6000, secondAt: now, now }), /OBSERVATION_STALE/);
  const noGeometry = observation({ root: { children: [{ ...target(), rect: null }] } });
  assert.throws(() => verifyDesktopTraction(observation(), noGeometry, action), /GEOMETRY_UNCERTAIN/);
});
