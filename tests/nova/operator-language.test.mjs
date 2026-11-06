import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readOperatorLanguage, writeOperatorLanguage, operatorLanguageFile, languageInstruction } from '../../agents/lib/operator-language.mjs';
import { agentSystemFor } from '../../agents/hands-off-agent.mjs';

test('the language chosen in the GUI is saved next to the planner choice and read back by the executor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-'));
  try {
    const env = { JACO_PLANNER_CHOICE_FILE: path.join(dir, 'provider-preference.json') };
    assert.equal(readOperatorLanguage(env), null);
    writeOperatorLanguage(operatorLanguageFile(env), 'sv');
    assert.equal(readOperatorLanguage(env), 'sv');
    assert.throws(() => writeOperatorLanguage(operatorLanguageFile(env), 'de'), /LANGUAGE_INVALID/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the planner is told to narrate and answer in the chosen language, whatever the goal is written in', () => {
  assert.match(agentSystemFor(['web-fetch'], 'win32', false, 'sv'), /in Swedish, the language the operator chose/);
  assert.match(agentSystemFor(['web-fetch'], 'win32', false, 'en'), /in English, the language the operator chose/);
  assert.doesNotMatch(agentSystemFor(['web-fetch'], 'win32', false, null), /the language the operator chose in the interface/);
  assert.equal(languageInstruction('xx'), '');
});
