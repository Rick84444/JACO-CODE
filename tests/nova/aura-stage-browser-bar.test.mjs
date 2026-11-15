import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../runtime/src/', import.meta.url);
const stage = fs.readFileSync(new URL('components/AuraLiveStage.tsx', root), 'utf8');
const presence = fs.readFileSync(new URL('components/AuraPresence.tsx', root), 'utf8');
const css = fs.readFileSync(new URL('cognitive-workspace.css', root), 'utf8');

test("Aura's browser is reachable at the top of Work, before the status panel", () => {
  const bar = stage.indexOf('{cdpReady && !screenshot && !capturedPage && <div className="aura-live-browser-bar"');
  assert.ok(bar > 0);
  assert.ok(bar < stage.indexOf('<AuraPresence data={presence} language={language}/>'), 'above the status, not below the fold');
  const block = stage.slice(bar, stage.indexOf('</div>}', bar));
  assert.match(block, /captureBrowser\(\)/);
  assert.match(block, /capturePageHtml\(\)/);
});

test('the status panel scrolls with the work instead of covering it, and shows blockers without unfolding', () => {
  assert.doesNotMatch(css, /\.aura-presence\{[^}]*position:sticky/);
  assert.match(presence, /\(data\.mode==='stalled'\|\|data\.mode==='blocked'\) && <dl className="aura-presence-blocker"/);
  assert.match(presence, /<details className="aura-presence-details">[\s\S]*aura-presence-mission/);
});
