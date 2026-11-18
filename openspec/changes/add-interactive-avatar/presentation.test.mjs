import test from 'node:test';import assert from 'node:assert/strict';import {advancePresentation as a} from './presentation.mjs';
test('initial snapshot silent',()=>assert.deepEqual(a(null,['a'],true).fresh,[]));
test('live duplicate suppressed',()=>assert.deepEqual(a(a(null,['a'],true),['a','b','b'],true).fresh,['b']));
test('reconnect silent',()=>assert.deepEqual(a(a(a(null,['a'],true),[],false),['a','b'],true).fresh,[]));
test('invalid ids rejected',()=>assert.deepEqual(a(a(null,[],true),[null,'','x'.repeat(257),'ok'],true).fresh,['ok']));
test('bounded state',()=>assert.equal(a(null,['a','b','c'],true,2).seen.length,2));
test('out of order retained ids suppressed',()=>assert.deepEqual(a(a(null,['a','b'],true),['b','a','c'],true).fresh,['c']));
