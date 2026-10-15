import assert from 'node:assert/strict';
import { selectRollupNativePackage } from './ensure_rollup_native.mjs';

const cases = [
  ['win32', 'x64', false, '@rollup/rollup-win32-x64-msvc'],
  ['win32', 'arm64', false, '@rollup/rollup-win32-arm64-msvc'],
  ['android', 'arm64', false, '@rollup/rollup-android-arm64'],
  ['android', 'arm', false, '@rollup/rollup-android-arm-eabi'],
  ['linux', 'x64', false, '@rollup/rollup-linux-x64-gnu'],
  ['linux', 'x64', true, '@rollup/rollup-linux-x64-musl'],
];

for (const [platform, arch, musl, expected] of cases) {
  assert.equal(selectRollupNativePackage(platform, arch, { musl }), expected);
}
console.log(`rollup-native-resolver: PASS (${cases.length}/${cases.length})`);
