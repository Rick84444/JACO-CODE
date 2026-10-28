#!/usr/bin/env node
import path from 'node:path';
import {runCycles,inspectCycles,adversarialChecks,MAX_CYCLES} from './cycle-runtime.mjs';
const args=process.argv.slice(2),mode=args[0]||'run';
const value=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined};
const state=path.resolve(value('--state')||'.jaco/autonomous-cycles');
try{
 let out;
 if(mode==='run')out=await runCycles(state,{until:Number(value('--until')||MAX_CYCLES)});
 else if(mode==='inspect')out=inspectCycles(state);
 else if(mode==='adversarial')out=adversarialChecks(state);
 else throw Error('Usage: run|inspect|adversarial [--state PATH] [--until 1..33]');
 console.log(JSON.stringify(out,null,2));
}catch(e){console.error(`JACO Autonomous Cycles: ${e.message}`);process.exitCode=1}