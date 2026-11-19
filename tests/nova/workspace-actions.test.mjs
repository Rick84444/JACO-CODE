import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorkspaceActions, WORKSPACE_CONTROL_INSTRUCTION } from '../../runtime/src/lib/workspaceActions.mjs';

test('directives become workspace actions and disappear from the reply', () => {
  const { text, actions } = extractWorkspaceActions('Jag öppnar koden.\n[[jaco:open code]]\n[[jaco:terminal]]\n[[jaco:file runtime/src/App.tsx]]\nKlart.');
  assert.deepEqual(actions, [{ type: 'open', view: 'code' }, { type: 'terminal' }, { type: 'file', path: 'runtime/src/App.tsx' }]);
  assert.equal(text, 'Jag öppnar koden.\n\nKlart.');
});

test('unknown views, unsafe paths and excess directives are dropped, never executed', () => {
  const { text, actions } = extractWorkspaceActions('[[jaco:open settings]] [[jaco:file ../secrets.env]] [[jaco:file C:/Windows/x]] [[jaco:file /etc/passwd]] hej');
  assert.deepEqual(actions, []);
  assert.equal(text, 'hej');
  const many = extractWorkspaceActions('[[jaco:terminal]][[jaco:open code]][[jaco:open preview]][[jaco:open evidence]]');
  assert.equal(many.actions.length, 3);
});

test('plain replies are unchanged and the instruction names every directive', () => {
  assert.deepEqual(extractWorkspaceActions('Inga kommandon här.'), { text: 'Inga kommandon här.', actions: [] });
  for (const word of ['[[jaco:open', '[[jaco:terminal]]', '[[jaco:file']) assert.ok(WORKSPACE_CONTROL_INSTRUCTION.includes(word));
});
