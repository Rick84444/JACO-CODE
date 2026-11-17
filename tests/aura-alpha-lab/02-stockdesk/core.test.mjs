import test from 'node:test';
import assert from 'node:assert/strict';
import {inventory} from './core.mjs';
test("receives stock",()=>{assert.deepEqual(inventory(...[[],{"type":"receive","sku":"a-1","name":"Bracket","quantity":5}]),[{"sku":"A-1","name":"Bracket","quantity":5}]);});
test("issues stock",()=>{assert.deepEqual(inventory(...[[{"sku":"A","name":"Part","quantity":5}],{"type":"issue","sku":"A","quantity":2}]),[{"sku":"A","name":"Part","quantity":3}]);});
test("rejects negative stock",()=>{assert.throws(()=>inventory(...[[{"sku":"A","name":"Part","quantity":1}],{"type":"issue","sku":"A","quantity":2}]),new RegExp("Insufficient stock"));});
test("rejects fractional stock",()=>{assert.throws(()=>inventory(...[[],{"type":"receive","sku":"A","name":"Part","quantity":1.5}]),new RegExp("Invalid quantity"));});
