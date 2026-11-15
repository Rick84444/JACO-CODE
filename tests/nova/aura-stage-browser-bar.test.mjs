import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stage = fs.readFileSync(new URL('../../runtime/src/components/AuraLiveStage.tsx', import.meta.url), 'utf8');

test("Aura's browser stays reachable in Work while other material is on stage", () => {
  assert.match(stage, /\{cdpReady && event && !screenshot && !capturedPage && <div className="aura-live-browser-bar"/);
  const bar = stage.slice(stage.indexOf('aura-live-browser-bar'), stage.indexOf('</div>}', stage.indexOf('aura-live-browser-bar')));
  assert.match(bar, /captureBrowser\(\)/, 'the bar captures the attached tab with the same read-only tool');
  assert.match(bar, /capturePageHtml\(\)/);
});
