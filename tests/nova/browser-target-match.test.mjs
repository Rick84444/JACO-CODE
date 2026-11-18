import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTarget,trackDomTarget } from '../../agents/lib/browser-target-match.mjs';

const t = (text, visible = true, selector = text) => ({ text, visible, selector });

test('an exact name wins, ignoring case, spacing and a trailing ellipsis', () => {
  assert.equal(pickTarget([t('More information...'), t('Home')], 'more information').target.text, 'More information...');
  assert.equal(pickTarget([t('Learn   more')], 'learn more').matched, 'exact');
});

test('a name quoted from memory still finds the one element it clearly means', () => {
  assert.equal(pickTarget([t('More information...'), t('Home')], 'information').matched, 'partial');
  assert.equal(pickTarget([t('Sign up for the newsletter')], 'Sign up').target.text, 'Sign up for the newsletter');
});

test('no match returns the names that are on the page so the model can correct itself', () => {
  const r = pickTarget([t('More information...'), t('Home'), t('Hidden', false)], 'Learn more');
  assert.equal(r.error, 'NO_TARGET');
  assert.deepEqual(r.available, ['More information...', 'Home']);
});

test('two partial matches are ambiguous, never a guess', () => {
  const r = pickTarget([t('Buy now'), t('Buy later')], 'buy');
  assert.equal(r.error, 'AMBIGUOUS_TARGET');
  assert.deepEqual(r.available, ['Buy now', 'Buy later']);
  assert.equal(pickTarget([t('Save'), t('Save')], 'save').error, 'AMBIGUOUS_TARGET');
  assert.equal(pickTarget([t('A')], '').error, 'NO_TARGET');
});

test('a description like "click the link" finds the page\'s only link, never one of several', () => {
  const link = (text) => ({ text, visible: true, selector: text, role: 'a' });
  const button = (text) => ({ text, visible: true, selector: text, role: 'button' });
  assert.equal(pickTarget([link('Learn more')], 'click the link').matched, 'only-one-of-kind');
  assert.equal(pickTarget([link('Learn more'), button('Go')], 'klicka på länken').target.text, 'Learn more');
  assert.equal(pickTarget([link('Go'), button('Save')], 'the button').target.text, 'Save');
  assert.equal(pickTarget([link('A'), link('B')], 'click the link').error, 'NO_TARGET');
  assert.equal(pickTarget([link('Learn more')], 'Sign in').error, 'NO_TARGET', 'an unrelated name is not guessed');
});

test('DOM Traction reacquires a moved unique control using a fresh observation',async()=>{
 const now=Date.now(),page=targets=>({ok:true,url:'https://example.test',targetId:'tab-a',at:new Date(now).toISOString(),targets});
 const pages=[page([t('Save',true,'#old')]),page([t('Save',true,'#new')])];
 let reads=0;const picked=await trackDomTarget(async()=>pages[reads++],'Save',{now:()=>now});
 assert.equal(reads,2);assert.equal(picked.target.selector,'#new');assert.equal(picked.traction.reidentified,true);
});
test('DOM Traction refuses stale, ambiguous or switched tab observations before dispatch',async()=>{
 const now=Date.now(),p={ok:true,url:'https://example.test',targetId:'tab-a',at:new Date(now).toISOString(),targets:[t('Save')]};
 for(const [next,error] of [[{...p,targetId:'tab-b'},'DOM_TARGET_PAGE_CHANGED'],[{...p,targets:[t('Save'),t('Save')]},'AMBIGUOUS_TARGET'],[{...p,at:new Date(now-6000).toISOString()},'DOM_OBSERVATION_STALE_OR_UNAVAILABLE']]){
  let n=0;const result=await trackDomTarget(async()=>n++?next:p,'Save',{now:()=>now});assert.equal(result.error,error);assert.equal(result.outcomeUnknown,false);
 }
});
