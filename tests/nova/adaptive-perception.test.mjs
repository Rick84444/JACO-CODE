import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectPerceptionRegion, captureMetrics } from '../../agents/lib/adaptive-perception.mjs';

const terminalObservation = (x, y) => ({
  observedAt: '2026-09-26T15:00:00.000Z',
  window: { hwnd: 99, name: 'JACO — Visual Studio Code', processName: 'Code', rect: { x, y, width: 1200, height: 800 } },
  root: {
    name: 'JACO — Visual Studio Code', controlType: 'Window', rect: { x, y, width: 1200, height: 800 },
    children: [
      { name: 'Explorer', controlType: 'Pane', rect: { x, y: y + 50, width: 260, height: 750 } },
      { name: 'Terminal', automationId: 'workbench.panel.terminal', controlType: 'Pane',
        rect: { x: x + 270, y: y + 500, width: 910, height: 280 } },
    ],
  },
});

test('adaptive perception uses the current terminal ROI, not stored coordinates', () => {
  const first = selectPerceptionRegion(terminalObservation(100, 80));
  const moved = selectPerceptionRegion(terminalObservation(620, 310));
  assert.equal(first.mode, 'terminal_roi');
  assert.equal(moved.mode, 'terminal_roi');
  assert.equal(first.hwnd, 99);
  assert.notDeepEqual(first.rect, moved.rect);
  assert.equal(moved.rect.x - first.rect.x, 520);
  assert.equal(moved.rect.y - first.rect.y, 230);
});

test('terminal window falls back to current UIA window bounds when no child terminal is exposed', () => {
  const observation = {
    window: { hwnd: 7, name: 'PowerShell', processName: 'pwsh', rect: { x: 40, y: 50, width: 1000, height: 700 } },
    root: { name: 'PowerShell', controlType: 'Window', rect: { x: 40, y: 50, width: 1000, height: 700 } },
  };
  const plan = selectPerceptionRegion(observation);
  assert.equal(plan.mode, 'terminal_window');
  assert.equal(plan.maxWidth, 768);
  assert.equal(plan.maxHeight, 512);
});

test('sensitive observations fail closed before visual capture', () => {
  const plan = selectPerceptionRegion({ blocked: 'credential surface', window: { rect: { x: 0, y: 0, width: 900, height: 600 } } });
  assert.equal(plan.ok, false);
  assert.equal(plan.mode, 'blocked');
});

test('capture metrics expose desktop-to-model pixel reduction explicitly', () => {
  assert.deepEqual(captureMetrics({
    desktopWidth: 2560, desktopHeight: 1440,
    sourceWidth: 1280, sourceHeight: 720,
    outputWidth: 640, outputHeight: 360,
  }), {
    desktopPixels: 3686400,
    sourcePixels: 921600,
    outputPixels: 230400,
    roiReductionRatio: 4,
    desktopReductionRatio: 16,
    reductionRatio: 16,
  });
});

test('VS Code without an exposed terminal child is a window ROI, not a guessed terminal', () => {
  const plan = selectPerceptionRegion({
    window: { hwnd: 8, name: 'JACO — Visual Studio Code', processName: 'Code', rect: { x: 20, y: 30, width: 1200, height: 800 } },
    root: { name: 'JACO — Visual Studio Code', controlType: 'Window', rect: { x: 20, y: 30, width: 1200, height: 800 } },
  });
  assert.equal(plan.mode, 'window_roi');
  assert.equal(plan.maxWidth, 896);
});


test('production wiring keeps ROI capture, UIA geometry and Nova adaptive screenshot connected', () => {
  const inputBridge = readFileSync(new URL('../../agents/input-bridge.ps1', import.meta.url), 'utf8');
  const uiaBridge = readFileSync(new URL('../../runtime/scripts/windows/jaco-uia-bridge.ps1', import.meta.url), 'utf8');
  const nova = readFileSync(new URL('../../agents/hands-off-agent.mjs', import.meta.url), 'utf8');

  assert.match(inputBridge, /\[Nullable\[int\]\]\$CropWidth/);
  assert.match(inputBridge, /\[Nullable\[int\]\]\$MaxWidth/);
  assert.match(inputBridge, /Copy only the requested region from the framebuffer/);
  assert.match(inputBridge, /MaxWidth/);
  assert.match(uiaBridge, /descriptor\.rect/);
  assert.match(uiaBridge, /fresh visual ROI after a window has moved/);
  assert.match(nova, /selectPerceptionRegion\(structural/);
  assert.match(nova, /case "screenshot":\s+return computerTools\.screenshot\(task\.data \|\| \{\}\)/);
  assert.match(nova, /adaptive UIA-guided ROI\/downscale/);
});
