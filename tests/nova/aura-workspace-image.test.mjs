import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectWorkspaceImage } from '../../runtime/src/server/connected/workspaceImage.mjs';

const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const jpg=Buffer.from([255,216,255,225,0,0]);
const webp=Buffer.from('RIFFabcdefghWEBP','ascii');

test('legitimate image magic signatures are accepted only for matching extensions',()=>{
  assert.equal(inspectWorkspaceImage(png,'captures/screen.png'),'image/png');
  assert.equal(inspectWorkspaceImage(jpg,'images/photo.jpeg'),'image/jpeg');
  assert.equal(inspectWorkspaceImage(jpg,'images/photo.jpg'),'image/jpeg');
  assert.equal(inspectWorkspaceImage(webp,'images/output.webp'),'image/webp');
});
test('SVG, HTML, mismatched formats and huge content fail closed',()=>{
  assert.throws(()=>inspectWorkspaceImage(Buffer.from('<svg><script>alert(1)</script></svg>'),'capture.svg'),/UNSUPPORTED/);
  assert.throws(()=>inspectWorkspaceImage(Buffer.from('<html>bad</html>'),'screen.png'),/UNSUPPORTED/);
  assert.throws(()=>inspectWorkspaceImage(png,'screen.jpg'),/UNSUPPORTED/);
  assert.throws(()=>inspectWorkspaceImage(Buffer.alloc(6_000_001),'screen.png'),/SIZE_LIMIT/);
});
test('server image endpoint retains existing local access checks and excludes raw SVG',()=>{
  const server=fs.readFileSync(new URL('../../runtime/server.ts',import.meta.url),'utf8');
  assert.match(server,/app\.get\('\/api\/aura\/workbench\/image',requireLocalUi/);
  assert.match(server,/inspectWorkspaceImage\(bytes,requested\)/);
  assert.match(server,/WORKBENCH_IMAGE_PATH_DENIED/);
  assert.match(server,/nosniff/);
  assert.match(server,/private, no-store, max-age=0/);
});
test('Aura shows actual fetched project image bytes and does not invent URLs',()=>{
  const component=fs.readFileSync(new URL('../../runtime/src/components/AuraLiveStage.tsx',import.meta.url),'utf8');
  assert.match(component,/\/api\/aura\/workbench\/image\?path=/);
  assert.match(component,/encodeURIComponent\(event\.evidence\.path\)/);
  assert.match(component,/onError=\{\(\)=>setImageLoad\('failed'\)\}/);
  assert.match(component,/aktuell bild/i);
});
