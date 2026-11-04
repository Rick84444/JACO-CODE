import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCreateChatMission } from '../../agents/lib/chat-mission-intent.mjs';

test('information requests mentioning action verbs do not create missions', () => {
  for(const text of [
    'How do I create a new file?',
    'How do I run tests and update dependencies?',
    'Why does my build fail when I click save?',
    'Tell me how to create a plugin',
    'Hur skapar jag ett nytt plugin?',
    'Vad händer när jag klickar på starta?',
    'Can I open the GUI without creating a mission?',
    'The create button is broken',
  ]) assert.equal(shouldCreateChatMission({kind:'chat',text}),false,text);
});
test('explicit user commands in English and Swedish still create missions', () => {
  for(const text of [
    'Create a new file',
    'Please run the test suite',
    'Could you open the workspace',
    'I want you to fix the startup issue',
    'Skapa ett produktutkast',
    'Kan du bygga pluginet',
    'Öppna min lokala testsida och kontrollera titeln',
  ]) assert.equal(shouldCreateChatMission({kind:'chat',text}),true,text);
});
test('explicit mission kinds override informational wording, unknown kinds are not privileged', () => {
  assert.equal(shouldCreateChatMission({kind:'mission',text:'How do I create a new file?'}),true);
  assert.equal(shouldCreateChatMission({kind:'coding-mission',text:'Why does test fail?'}),true);
  assert.equal(shouldCreateChatMission({kind:'observation',text:'Run it'}),false);
  assert.equal(shouldCreateChatMission({kind:'chat',text:'Can you explain how to build a plugin?'}),false);
});
