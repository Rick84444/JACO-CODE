import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTarget } from '../../agents/lib/browser-target-match.mjs';

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
