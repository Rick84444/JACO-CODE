import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkspaceActions, workspaceReplyText, STAGE_PANELS, STAGE_CONTROL_INSTRUCTION } from './workspaceActions.mjs';

test('focus directives light up stage panels and are removed from the reply', () => {
  const { text, actions } = extractWorkspaceActions('Here is what is running.\n[[jaco:focus mission]]\nAnd the page:\n[[jaco:focus Browser]]');
  assert.deepEqual(actions, [{ type: 'focus', panel: 'mission' }, { type: 'focus', panel: 'browser' }]);
  assert.equal(text, 'Here is what is running.\n\nAnd the page:');
});

test('unknown focus panels are dropped, never passed on', () => {
  const { text, actions } = extractWorkspaceActions('Look [[jaco:focus shell; rm -rf]] here [[jaco:focus ../secrets]]');
  assert.deepEqual(actions, []);
  assert.equal(text, 'Look  here');
});

test('a directive with an unknown verb is removed from the reply, not shown to the operator', () => {
  const { text, actions } = extractWorkspaceActions('[[jaco:browser]]\n\nJag navigerade till sidan.');
  assert.deepEqual(actions, []);
  assert.equal(text, 'Jag navigerade till sidan.');
});

test('the stage instruction names every stage panel', () => {
  for (const panel of STAGE_PANELS) assert.match(STAGE_CONTROL_INSTRUCTION, new RegExp(`\\b${panel}\\b`));
});

test('existing workspace directives are unchanged', () => {
  const { actions } = extractWorkspaceActions('[[jaco:open evidence]] [[jaco:terminal]] [[jaco:file src/App.tsx]]');
  assert.deepEqual(actions, [{ type: 'open', view: 'evidence' }, { type: 'terminal' }, { type: 'file', path: 'src/App.tsx' }]);
  assert.equal(workspaceReplyText('[[jaco:focus tools]]'), 'Showing it in the workspace.');
});

test('motion directives are a closed presentation-only contract with one motion per reply',()=>{
  const a=extractWorkspaceActions('Show it.\n[[jaco:focus browser]]\n[[jaco:motion advance]]\n[[jaco:motion return]]\n[[jaco:motion shell]]');
  assert.deepEqual(a.actions,[{type:'focus',panel:'browser'},{type:'motion',motion:'advance'}]);assert.equal(a.text,'Show it.');
});
