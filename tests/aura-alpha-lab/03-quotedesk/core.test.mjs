import test from 'node:test';
import assert from 'node:assert/strict';
import {quote} from './core.mjs';
test("tax and discount",()=>{assert.deepEqual(quote(...[[{"qty":2,"unitOre":10000}],10,25]),{"net":20000,"rebate":2000,"taxable":18000,"tax":4500,"total":22500});});
test("rounds ore",()=>{assert.deepEqual(quote(...[[{"qty":1,"unitOre":99}],0,25]),{"net":99,"rebate":0,"taxable":99,"tax":25,"total":124});});
test("zero VAT",()=>{assert.deepEqual(quote(...[[{"qty":1,"unitOre":100}],0,0]),{"net":100,"rebate":0,"taxable":100,"tax":0,"total":100});});
test("invalid quantities",()=>{assert.throws(()=>quote(...[[{"qty":0,"unitOre":1}],0,25]),new RegExp("Invalid line"));});
