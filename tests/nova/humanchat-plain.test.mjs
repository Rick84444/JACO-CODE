// Aura's chat text shows no emoji or status symbols; the agent's status line and log marks are plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plainChatText } from '../../runtime/src/lib/humanChat.ts';

test('plainChatText removes emoji and status symbols and keeps the words', () => {
  assert.equal(plainChatText('Klart ✔ tester ✖ varning ⚠ info ℹ 🚀 nu'), 'Klart tester varning info nu');
  assert.equal(plainChatText('Plain text stays the same.'), 'Plain text stays the same.');
});

test('the agent status line and log marks no longer use symbols', () => {
  const agent = fs.readFileSync(new URL('../../agents/hands-off-agent.mjs', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../../agents/agent-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(agent, /[✔✖]/);
  assert.doesNotMatch(ui, /content:"[✔ℹ⚠✖]"/);
});
