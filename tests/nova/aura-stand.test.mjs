// Aura seen whole on the start page: how she is lit, what she stands on and how the camera frames both
// (operator 2026-11-28: "it should have texture and lower the light on her", "make a base she stands on").
import test from 'node:test';
import assert from 'node:assert/strict';
// Resolve Three through the same dependency tree as the renderer.
import { createRequire } from 'node:module';
import { frameFigure, createStand, preparePhotoMaterials, createFigureLights } from '../../runtime/src/lib/auraStand.mjs';

const THREE = createRequire(new URL('../../runtime/package.json', import.meta.url))('three');

test('the camera fits every given point and fills the canvas, tall or narrow', () => {
  const fovDeg = 42, half = Math.tan(fovDeg * Math.PI / 360);
  const points = [
    { x: 0, y: 1.78, z: .2 }, { x: 0, y: -.07, z: .6 },          // top of the head, front edge of the stand
    { x: -.53, y: 1.2, z: .2 }, { x: .53, y: 1.2, z: .2 },       // the hands
  ];
  for (const aspect of [1.6, .74, .3]) {
    const camera = frameFigure({ points, aspect, fovDeg, centreX: 0 });
    let fill = 0;
    for (const p of points) {
      const depth = camera.z - p.z;
      const v = Math.abs(p.y - camera.y) / (half * depth), h = Math.abs(p.x) / (half * aspect * depth);
      assert.ok(v <= 1 && h <= 1, `cut off at aspect ${aspect}: ${JSON.stringify(p)}`);
      fill = Math.max(fill, v, h);
    }
    assert.ok(fill > .9, `too small at aspect ${aspect}: ${fill}`);
  }
});

test('the stand lies under her soles, covers both boots and releases what it made', () => {
  const stand = createStand({ floor: 0, centre: { x: 0, z: .02 }, feet: [{ x: -.12, z: 0 }, { x: .12, z: 0 }] });
  stand.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(stand.group);
  assert.ok(box.max.y <= .006, 'nothing rises over the soles: ' + box.max.y);
  assert.ok(box.min.x <= -.3 && box.max.x >= .3, 'both boots stand on it');
  assert.ok(stand.edge.y < 0 && stand.edge.z > .3 && stand.edge.radius > .3, 'the camera is told where it ends');
  let released = 0;
  stand.group.traverse(o => { if (o.isMesh) { o.geometry.addEventListener('dispose', () => released++); o.material.addEventListener('dispose', () => released++); } });
  const meshes = stand.group.children.length;
  stand.update(1, 1);
  stand.dispose();
  assert.equal(released, meshes * 2);
});

test('photographed surfaces keep their texture under soft light', () => {
  const map = new THREE.Texture();
  const suit = new THREE.MeshStandardMaterial({ map, metalness: 1 }); suit.name = 'Aura suit / technical_textile';
  const hair = new THREE.MeshStandardMaterial({ map }); hair.name = 'Aura V26 neutral platinum photo hair';
  const trim = new THREE.MeshStandardMaterial({ metalness: 1 }); trim.name = 'trim without a photo';
  const model = new THREE.Group();
  for (const m of [suit, hair, trim]) model.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
  preparePhotoMaterials(model);
  preparePhotoMaterials(model);
  assert.equal(suit.metalness, .25, 'full metal without surroundings hides the photograph; applied once');
  assert.equal(hair.emissiveMap, map, 'the hair keeps its platinum colour');
  assert.ok(hair.emissive.getHex() > 0 && hair.emissive.r < .05);
  assert.equal(trim.metalness, 1);
  assert.equal(suit.emissiveMap, null);
});

test('her light is low and even', () => {
  const lights = createFigureLights();
  const ambient = lights.find(l => l.isAmbientLight);
  assert.ok(ambient.intensity < 2, 'dimmer than the textures drawn unlit (pi)');
  assert.ok(lights.filter(l => l.isDirectionalLight).every(l => l.intensity <= .8));
});
