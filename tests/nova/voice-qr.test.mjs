import test from 'node:test';
import assert from 'node:assert/strict';
import { qrSvg, qrModules, qrSvgFromModules } from '../../runtime/src/server/connected/qrSvg.mjs';

test('the link code becomes a square SVG QR with a quiet zone', async () => {
  const rows = await qrModules('2@abcdefg,hijklmn,opqrstu==');
  assert.ok(rows.length >= 21, 'a QR version 1 symbol is at least 21 modules');
  assert.ok(rows.every(row => row.length === rows.length), 'square');
  assert.ok(rows.flat().some(Boolean) && rows.flat().some(v => !v), 'both dark and light modules');
  const svg = await qrSvg('2@abcdefg,hijklmn,opqrstu==');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /aria-label="WhatsApp QR-kod"/);
});

test('run-length path covers exactly the dark modules', () => {
  const rows = [[true, true, false], [false, true, false], [true, false, true]];
  const svg = qrSvgFromModules(rows, { margin: 0 });
  assert.match(svg, /M0 0h2v1h-2z/);
  assert.match(svg, /M1 1h1v1h-1z/);
  assert.match(svg, /M0 2h1v1h-1z/);
  assert.match(svg, /M2 2h1v1h-1z/);
});

test('an empty code is refused instead of drawing a blank image', async () => {
  await assert.rejects(qrSvg(''), /QR_TEXT_REQUIRED/);
});
