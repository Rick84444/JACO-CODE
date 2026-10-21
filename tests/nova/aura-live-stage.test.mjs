import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auraStageCandidate, auraMaterialKind, auraStageHistory, stageFileAllowed } from '../../runtime/src/lib/auraStage.mjs';

const event = (id, category, text, outcome='observed', path=null, more={})=>({
  id, category, text, missionId:'mission-1', at:'2026-10-21T12:00:00Z', type:'NOVA_ACTION_RESULT',
  evidence:{outcome,path,url:null,commit:null,exitCode:null,error:null,...more},
});

test('Stage chooses a verified project HTML artifact ahead of repeated repo reads',()=>{
  const list=[
    event('goal','goal','Bygg webbplatsen'),
    event('html','result','HTML skapad','verified','src/index.html'),
    ...Array.from({length:30},(_,i)=>event('read-'+i,'result','Läser en fil: resultatet är verifierat.','verified','src/config.ts')),
  ];
  assert.equal(auraStageCandidate(list).event.id,'html');
  assert.equal(auraStageCandidate(list).material,'html');
  assert.equal(auraStageHistory(list).find(x=>x.event.id==='read-29').count,30);
});

test('Later blocker surfaces instead of a previously verified HTML preview',()=>{
  const list=[
    event('html','result','HTML skapad','verified','src/index.html'),
    event('error','blocked','Modellen svarar inte','failed',null,{error:'MODEL_UNAVAILABLE'}),
  ];
  assert.equal(auraStageCandidate(list).event.id,'error');
  assert.equal(auraStageCandidate(list).material,null);
});

test('Unverified or unsafe paths never become visual HTML or image material',()=>{
  for (const path of ['/etc/passwd.html','C:/secret.html','../secret.html','src/../../a.html','src/../a.png','\\\\host\\share\\x.png']) {
    assert.equal(stageFileAllowed(path),false,path);
    assert.equal(auraMaterialKind(event('bad','result','Fångad','verified',path)),null,path);
  }
  assert.equal(auraMaterialKind(event('pending','result','Genererar HTML','unverified','src/index.html')),null);
  assert.equal(auraMaterialKind(event('image','result','Hämtad bild','verified','screenshots/a.png')),'image-reference');
  assert.equal(auraStageCandidate([event('raw','result','Läser en fil','verified','src/auth.ts')]),null);
  assert.equal(auraStageCandidate([event('test','result','Kör tester: resultatet är verifierat.','verified')]).event.id,'test');
});

test('Stage history groups identical events per mission and keeps newest ID',()=>{
  const list=[
    ...Array.from({length:12},(_,i)=>event('a'+i,'action','Läser en fil')),
    event('b','action','Kör ett test'),
    {...event('c','action','Läser en fil'),missionId:'mission-2'},
  ];
  const entries=auraStageHistory(list);
  assert.equal(entries.length,3);
  assert.equal(entries.find(x=>x.event.id==='a11').count,12);
  assert.equal(entries.find(x=>x.event.id==='c').count,1);
});

test('One stage is mounted by canonical IDE without permanent tool tabs or a second chat',()=>{
  const base=new URL('../../runtime/src/components/',import.meta.url);
  const read=name=>fs.readFileSync(new URL(name,base),'utf8');
  const ui=read('CognitiveWorkspace.tsx'),ide=read('JacoAuraComputeIDE.tsx'),stage=read('AuraLiveStage.tsx');
  assert.match(ui,/aria-label="Aura Live Workspace"/);
  assert.match(ui,/hasDetail\?props\.detail:props\.stage/);
  assert.match(ui,/aria-pressed=\{props\.stagePinned\}/);
  assert.doesNotMatch(ui,/className="cognitive-view-tabs"/);
  assert.equal((ide.match(/<AuraChatPanel/g)||[]).length,1);
  assert.match(ide,/workspacePinned \|\| !candidate/);
  assert.match(ide,/auraStageCandidate\(cognitiveEvents\)/);
  assert.match(stage,/auraStageHistory\(events\)/);
  assert.match(stage,/onDraftChange/);
  assert.match(ide,/expectedHash:source\.hash/);
});

test('CDP screenshots use only existing authorized read tool and remain bounded',()=>{
  const component=fs.readFileSync(new URL('../../runtime/src/components/AuraLiveStage.tsx',import.meta.url),'utf8');
  assert.match(component,/providerId:'cdp',toolName:'nova_screenshot'/);
  assert.match(component,/png\.length>8_000_000/);
  assert.doesNotMatch(component,/nova_navigate|nova_click|nova_type/);
  const preview=fs.readFileSync(new URL('../../runtime/src/components/CognitivePreview.tsx',import.meta.url),'utf8');
  assert.match(preview,/strict\?'':'allow-scripts'/);
  assert.match(preview,/strict\?'&#39;none&#39;':'&#39;unsafe-inline&#39;'/);
});
