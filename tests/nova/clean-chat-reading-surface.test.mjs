import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(name)=>fs.readFileSync(new URL('../../runtime/src/'+name,import.meta.url),'utf8');
test('conversation focus uses full workspace width with the stage removed, including landscape phones',()=>{
  const ui=read('components/CognitiveWorkspace.tsx');
  const css=read('cognitive-workspace.css');
  assert.match(ui,/data-focus=\{showStage\?'stage':'conversation'\}/);
  assert.match(css,/\.cognitive-main\[data-focus="conversation"\]>\.cognitive-conversation\s*\{[^}]*flex:1 1 100%/s);
  assert.match(css,/\.cognitive-main\[data-focus="conversation"\]>\.cognitive-canvas\s*\{\s*display:none/s);
  assert.match(css,/@media \(max-height:600px\)/);
});
test('assistant and operator are primary; runtime cards and controls are collapsible, not in chat transcript',()=>{
  const chat=read('components/AuraChatPanel.tsx');
  const ui=read('components/CognitiveWorkspace.tsx');
  const css=read('cognitive-workspace.css');
  assert.match(chat,/data-testid="jaco-chat-diagnostics"/);
  assert.match(chat,/<details className="cognitive-chat-diagnostics"/);
  assert.match(chat,/\.\.\.humanEvents\.background,\.\.\.humanEvents\.conversation/);
  assert.match(chat,/messages\.filter\(m=>m\.id!=='welcome'\)/);
  assert.doesNotMatch(chat,/\.\.\.conversationEvents\.map\(event=>\(\{kind:'event'/);
  assert.match(chat,/<ChatMarkdown text=\{message\.content\}/);
  assert.match(chat,/className="cognitive-background-events-list"/);
  assert.match(ui,/<details className="cognitive-chat-attention"/);
  assert.match(css,/\.cognitive-chat-diagnostics-content\s*\{[^}]*max-height:/s);
  assert.match(css,/\.cognitive-chat-attention\[open\]\s*\{[^}]*overflow-y:auto/s);
});
