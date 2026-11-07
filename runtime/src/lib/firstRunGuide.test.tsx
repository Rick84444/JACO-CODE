import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UiLanguageProvider } from '../i18n/UiLanguage';
import { FirstRunGuide, AI_STUDIO_KEY_URL } from '../components/FirstRunGuide';

const render = (language: 'sv' | 'en') => renderToStaticMarkup(<UiLanguageProvider initialLanguage={language}><FirstRunGuide onConnected={() => {}} onClose={() => {}} /></UiLanguageProvider>);

test('the first-run guide explains in plain Swedish what is needed and links to the free key page', () => {
  const html = render('sv');
  assert.match(html, /Aura behöver en AI-hjärna först/);
  assert.match(html, /gratis att börja med/);
  assert.match(html, /inget betalkort/);
  assert.ok(html.includes(AI_STUDIO_KEY_URL));
  assert.match(html, /Kostar det pengar\?/);
  assert.match(html, /Vad är en nyckel\?/);
  // Google's own button is called "Create API key", so that label is quoted as it appears there.
  assert.doesNotMatch(html.replace(/Create API key/g, ''), /API key|provider|endpoint/i, 'no developer words in the Swedish guide');
});

test('the English guide is wholly English', () => {
  const html = render('en');
  assert.match(html, /Aura needs an AI brain first/);
  assert.doesNotMatch(html, /Välkommen|Kostar|nyckel/);
});
