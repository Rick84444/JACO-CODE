import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuraTerminal} from '../components/AuraTerminal';
import {UiLanguageProvider} from '../i18n/UiLanguage';
import {humanizeEvent} from './humanChat';
import type {CognitiveEvent} from '../hooks/useCognitiveLive';

const base:CognitiveEvent={id:'x',at:'2026-11-11T13:00:00Z',type:'NOVA_ACTION_STARTED',category:'action',title:'Working',text:'Steg 2: Jag kontrollerar modellvalet JACO_PRIMARY_PROVIDER för att förstå varför planeringen stoppas.',durable:true,seq:1,missionId:'m',missionGoal:null,actionId:'a',evidence:{outcome:'observed',path:null,url:null,commit:null,exitCode:null,error:null}};
test('human intent survives a configuration name while genuine errors remain human-readable',()=>{
  assert.equal(humanizeEvent(base,'sv').text,base.text);
  assert.doesNotMatch(humanizeEvent({...base,category:'blocked',text:'PAID_PROVIDER_DISABLED',evidence:{...base.evidence,outcome:'failed'}},'sv').text,/PAID_PROVIDER_DISABLED/);
});
test('the visible terminal renders escaped observed output and labels interrupted observation honestly',()=>{
  const event={...base,terminal:{phase:'finished',command:'npm test',stdout:'<script>unsafe</script>\ntests passed',stderr:'',exitCode:0,truncated:false}};
  const html=renderToStaticMarkup(<UiLanguageProvider initialLanguage="sv"><AuraTerminal events={[event]} missionId="m" connection="unavailable"/></UiLanguageProvider>);
  assert.match(html,/npm test/);assert.match(html,/tests passed/);assert.match(html,/Slutkod/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Anslutningen är avbruten/);
});
