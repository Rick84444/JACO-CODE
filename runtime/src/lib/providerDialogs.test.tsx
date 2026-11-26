import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {UiLanguageProvider} from '../i18n/UiLanguage';
import {ProviderConnect} from '../components/ProviderConnect';

test('provider launcher keeps account forms out of the initial visible UI',()=>{
  const html=renderToStaticMarkup(<UiLanguageProvider initialLanguage="sv"><ProviderConnect onConnected={()=>{}}/></UiLanguageProvider>);
  assert.equal((html.match(/aria-haspopup="dialog"/g)||[]).length,4);
  for(const label of ['OpenAI','Claude','Gemini','Fler'])assert.match(html,new RegExp('aria-label="'+label+' — '));
  assert.match(html,/<dialog\b[^>]*aria-labelledby=/);
  assert.doesNotMatch(html,/<dialog\b[^>]*\bopen(?:=| |>)/);
  assert.doesNotMatch(html,/type="password"/);
  assert.doesNotMatch(html,/Modellsvar verifierat|Behörighet mottagen/);
});
