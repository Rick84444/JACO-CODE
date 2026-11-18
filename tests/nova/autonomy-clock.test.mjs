// The autonomy clock's rules, checked against the mandate store the GUI uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutonomyMandateStore } from '../../runtime/src/server/autonomy/autonomyMandate.ts';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-clock-'));

test('the clock grants free work with a chosen end and keeps money on review', () => {
  const store = new AutonomyMandateStore(dir());
  const created = store.create({ name: 'Autonomi-klocka', maxHours: 168, mission: 'Aura arbetar fritt inom kontraktet under vald tid.' });
  const signed = store.sign(created.id);
  assert.equal(store.isActive(signed.id), true);
  const hours = (Date.parse(signed.expiresAt) - Date.now()) / 3_600_000;
  assert.ok(hours > 167 && hours <= 168, `window is one week, got ${hours.toFixed(2)} h`);
  assert.equal(signed.decisions.FINANCIAL, 'REVIEW', 'money is never free');
  assert.equal(signed.decisions.READ, 'ALLOW');
  assert.equal(signed.decisions.LOCAL_MUTATION, 'ALLOW');
});

test('a longer window is possible up to one year, and no more', () => {
  const store = new AutonomyMandateStore(dir());
  const month = store.sign(store.create({ name: 'Autonomi-klocka', maxHours: 720, mission: 'Aura arbetar fritt under en månad.' }).id);
  assert.ok(Date.parse(month.expiresAt) - Date.now() > 719 * 3_600_000);
  const capped = store.create({ name: 'Autonomi-klocka', maxHours: 999_999, mission: 'Aura arbetar fritt tills vidare inom taket.' });
  assert.equal(capped.maxHours, 8760);
});

test('stopping the clock revokes it, so nothing stays active', () => {
  const store = new AutonomyMandateStore(dir());
  const signed = store.sign(store.create({ name: 'Autonomi-klocka', maxHours: 8, mission: 'Aura arbetar fritt en kort stund.' }).id);
  assert.equal(store.isActive(signed.id), true);
  store.revoke(signed.id);
  assert.equal(store.isActive(signed.id), false);
});

test('an unsigned or expired clock grants nothing', () => {
  const store = new AutonomyMandateStore(dir());
  const unsigned = store.create({ name: 'Autonomi-klocka', maxHours: 8, mission: 'Aura väntar på operatörens signering.' });
  assert.equal(store.isActive(unsigned.id), false);
});

test('startup keeps active and expired default signatures unchanged; corrupt state cannot recreate authority', () => {
  const root=dir(), previous=process.env.JACO_LEVEL5_AUTONOMY;
  process.env.JACO_LEVEL5_AUTONOMY='1';
  try {
    let store=new AutonomyMandateStore(root);
    const id='operator-level5-default', initial=store.get(id);
    assert.equal(store.isActive(id),true);
    store=new AutonomyMandateStore(root);
    assert.deepEqual(store.get(id),initial);
    const expired={...initial,expiresAt:new Date(Date.now()-1000).toISOString()};
    store.save(expired);
    store=new AutonomyMandateStore(root);
    assert.equal(store.isActive(id),false);
    assert.equal(store.get(id).expiresAt,expired.expiresAt);
    assert.equal(store.sign(id).enabled,true);
    const file=path.join(root,'.jaco','state','autonomy','mandates.json');
    fs.writeFileSync(file,'corrupt');
    store=new AutonomyMandateStore(root);
    assert.equal(store.isActive(id),false);
    assert.equal(fs.readFileSync(file,'utf8'),'corrupt');
    fs.unlinkSync(file);
    store=new AutonomyMandateStore(root);
    assert.equal(store.isActive(id),false);
  } finally { if(previous===undefined)delete process.env.JACO_LEVEL5_AUTONOMY;else process.env.JACO_LEVEL5_AUTONOMY=previous;fs.rmSync(root,{recursive:true,force:true}); }
});
