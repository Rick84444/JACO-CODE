import test from 'node:test';
import assert from 'node:assert/strict';

// The helper only needs window.sessionStorage; give it a tiny one.
const store = new Map();
globalThis.window = { sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }, location: { reload() {} } };
const { isStaleBuildError, reloadForNewBuild } = await import('../../runtime/src/lib/staleBuild.ts').catch(async () => import('../../runtime/src/lib/staleBuild.mjs'));

test('a failed lazy import is recognised as a stale build, other errors are not', () => {
  assert.equal(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:3000/assets/RevenueView-DPJkFqf3.js')), true);
  assert.equal(isStaleBuildError(new Error('error loading dynamically imported module')), true);
  assert.equal(isStaleBuildError(new Error('Cannot read properties of undefined')), false);
});

test('the page reloads once, and not again within a minute', () => {
  store.clear();
  let reloads = 0;
  assert.equal(reloadForNewBuild(1_000_000, () => reloads++), true);
  assert.equal(reloadForNewBuild(1_030_000, () => reloads++), false);
  assert.equal(reloadForNewBuild(1_070_000, () => reloads++), true);
  assert.equal(reloads, 2);
});
