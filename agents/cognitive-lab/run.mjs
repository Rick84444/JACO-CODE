#!/usr/bin/env node
import path from 'node:path';
import { runCognitiveLab, inspectCognitiveLab } from '../lib/cognitive-lab.mjs';
const argv = process.argv.slice(2);
const command = argv[0] || 'demo';
const p = argv.indexOf('--state');
const state = path.resolve(p >= 0 ? argv[p + 1] : '.jaco/cognitive-lab');
try {
  if (command === 'demo' || command === 'run') {
    const output = await runCognitiveLab(state);
    console.log(JSON.stringify(output, null, 2));
    if (!output.accepted) process.exitCode = 2;
  } else if (command === 'inspect') console.log(JSON.stringify(inspectCognitiveLab(state), null, 2));
  else { console.error('Usage: node agents/cognitive-lab/run.mjs demo|run|inspect [--state PATH]'); process.exitCode = 2; }
} catch (error) { console.error(`JACO Cognitive Lab: ${error.message}`); process.exitCode = 1; }
