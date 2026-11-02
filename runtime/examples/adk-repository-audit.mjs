#!/usr/bin/env node
/**
 * Executable JACO Native ADK example.
 * Default: inspect the real Aura runtime (no mutations).
 * --submit requires a deliberate operator command; no background daemon.
 */
import { createAuraAdk, defineAuraProgram } from '../src/adk/aura-adk.mjs';

const program = defineAuraProgram({
  id: 'repository-audit',
  version: '1.0.0',
  description: 'Inspect project architecture and produce a source-grounded audit through Aura.',
  execution: { type: 'goal' },
  // Tool declarations do NOT grant permissions; the canonical Tool Fabric decides.
  readTools: [],
});
const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log('JACO Native ADK — real Aura runtime\n'
    + 'Usage:\n'
    + '  node runtime/examples/adk-repository-audit.mjs --inspect\n'
    + '  node runtime/examples/adk-repository-audit.mjs --mission mission-UUID\n'
    + '  node runtime/examples/adk-repository-audit.mjs --submit "Audit this repository"\n\n'
    + 'Actions require a running, local Aura runtime. --submit sends exactly one authorized\n'
    + 'goal request, never automatically retries, and does not claim mission completion.\n'
    + 'The runtime enforces local UI, mission/approval and tool policies.');
  process.exit(0);
}
const adk = createAuraAdk({
  endpoint: process.env.JACO_ENDPOINT || 'http://127.0.0.1:3000',
  token: process.env.JACO_TOKEN || '',
});
try {
  let output;
  if (args[0] === '--inspect' && args.length === 1) {
    output = await adk.inspect();
  } else if (args[0] === '--mission' && args.length === 2) {
    output = await adk.mission(args[1]);
  } else if (args[0] === '--submit' && args.length === 2) {
    output = await adk.dispatch(program, { goal: args[1], operatorAuthorized: true });
  } else {
    throw Error('INVALID_ARGUMENTS: run --help');
  }
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  // No raw response body, token, tool arguments or stack in the operator console.
  console.error(JSON.stringify({
    ok: false, error: error.code || 'ADK_ERROR',
    outcomeUnknown: error.outcomeUnknown === true,
  }));
  process.exitCode = 1;
}
