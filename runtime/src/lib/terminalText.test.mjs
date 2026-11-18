import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalText} from './terminalText.mjs';
test('preserves text and line breaks',()=>assert.equal(terminalText('Hej\n\t✓'),'Hej\n\t✓'));
test('neutralizes OSC clipboard and CSI',()=>assert.equal(terminalText('\x1b]52;c;abc\x07\x1b[2J'),'�]52;c;abc��[2J'));
test('neutralizes C1 escape and bidi overrides',()=>assert.equal(terminalText('\x9b2J\u202eabc'),'�2J�abc'));
test('does not stringify objects',()=>assert.equal(terminalText({}),''));
test('neutralizes carriage returns',()=>assert.equal(terminalText('a\rb'),'a�b'));
