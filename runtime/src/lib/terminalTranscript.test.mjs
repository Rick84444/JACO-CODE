import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalTranscript} from './terminalTranscript.mjs';
const receipt=(id,fields={})=>({id,at:'2026-11-18T12:00:00Z',terminal:{command:'npm test',phase:'result',stdout:'success',exitCode:0,...fields}});
test('only observed terminal receipts are displayed',()=>{assert.equal(terminalTranscript([{text:'unverified claim'}]),'No observed command receipts.'); assert.match(terminalTranscript([receipt('1')]),/Exit code: 0/);});
test('unknown exit code is not reported as success',()=>assert.doesNotMatch(terminalTranscript([receipt('1',{exitCode:null})]),/Exit code:/));
test('control bytes are rendered literally',()=>{const result=terminalTranscript([receipt('1',{stdout:'\x1b]52;c;abc\x07\x1b[2J'})]);assert.doesNotMatch(result,/[\x1b\x07]/);});
test('old receipts and oversized output are bounded',()=>{let result=terminalTranscript(Array.from({length:41},(_,i)=>receipt('id'+i,{stdout:'x'.repeat(9000)})));assert.ok(!result.includes('] id0\n'));assert.ok(result.includes('] id40\n'));assert.match(result,/\[output truncated\]/);});
test('runtime truncation and failed exit are explicit',()=>{const result=terminalTranscript([receipt('1',{stderr:'failure',exitCode:1,truncated:true})]);assert.match(result,/stderr:\nfailure/);assert.match(result,/Exit code: 1/);assert.match(result,/receipt truncated by runtime/);});
