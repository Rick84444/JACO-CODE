import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cdpRefreshDelay, CDP_REFRESH_MS, CDP_REFRESH_MAX_MS } from '../../runtime/src/lib/auraStage.mjs';

test('a displayed CDP still refreshes every 15 s and backs off to at most 2 minutes after failures', () => {
  assert.equal(cdpRefreshDelay(0), CDP_REFRESH_MS);
  assert.equal(cdpRefreshDelay(1), 30_000);
  assert.equal(cdpRefreshDelay(2), 60_000);
  assert.equal(cdpRefreshDelay(3), CDP_REFRESH_MAX_MS);
  assert.equal(cdpRefreshDelay(50), CDP_REFRESH_MAX_MS);
  for (const bad of [-1, 1.5, NaN, undefined, '3']) assert.equal(cdpRefreshDelay(bad), CDP_REFRESH_MS);
});

test('the stage refresh uses only the read-only screenshot tool and pauses when pinned, hidden or idle', () => {
  const stage = fs.readFileSync(new URL('../../runtime/src/components/AuraLiveStage.tsx', import.meta.url), 'utf8');
  assert.match(stage, /if\(!cdpReady \|\| pinned \|\| !activeMission \|\| !showingCdp\)return;/);
  assert.match(stage, /document\.visibilityState!=='hidden'/);
  assert.doesNotMatch(stage, /nova_(navigate|click|type)/, 'the stage never controls the tab');
});

test('the stage keeps a rewritten project file current in the views where it is visible', () => {
  const ide = fs.readFileSync(new URL('../../runtime/src/components/JacoAuraComputeIDE.tsx', import.meta.url), 'utf8');
  assert.match(ide, /\['code','preview','stage','conversation'\]\.includes\(workspaceView\)/);
});
