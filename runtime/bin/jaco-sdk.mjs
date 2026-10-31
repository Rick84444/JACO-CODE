#!/usr/bin/env node
/** JACO SDK CLI. Zero dependencies; does not start services automatically. */
import { JacoClient } from '../src/sdk/jaco-client.mjs';
import { createAuraAdk } from '../src/adk/aura-adk.mjs';

const args = process.argv.slice(2);
const command = args.shift() || 'help';
function option(name, fallback = '') {
  const i = args.indexOf('--' + name);
  if (i < 0) return fallback;
  if (!args[i + 1]) throw new Error('Missing value for --' + name);
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}
if (command === 'help' || command === '--help' || command === '-h') {
  console.log('JACO SDK CLI - native JavaScript (Node 22+)\nUsage: node runtime/bin/jaco-sdk.mjs <status|providers|tools|missions|file|chat|mission|adk:inspect|adk:mission> [argument] [--endpoint URL] [--token TOKEN]\nMutating commands require explicit invocation.');
  process.exit(0);
}
try {
  const endpoint = option('endpoint', process.env.JACO_ENDPOINT || 'http://127.0.0.1:3000');
  const token = option('token', process.env.JACO_TOKEN || '');
  const client = new JacoClient({ endpoint, token });
  const arg = args.join(' ').trim();
  let result;
  switch (command) {
    case 'status': result = await client.workbench.status(); break;
    case 'adk:inspect': result = await createAuraAdk({client}).inspect(); break;
    case 'adk:mission':
      if (!arg) throw new Error('adk:mission requires a Nova mission ID');
      result = await createAuraAdk({client}).mission(arg);
      break;
    case 'providers': result = await client.providers.list(); break;
    case 'tools': result = await client.tools.list(); break;
    case 'missions': result = await client.missions.list(); break;
    case 'file':
      if (!arg) throw new Error('file requires path');
      result = await client.workbench.getFile(arg);
      break;
    case 'chat':
      if (!arg) throw new Error('chat requires message');
      result = await client.chat.send(arg);
      break;
    case 'mission':
      if (!arg) throw new Error('mission requires goal');
      result = await client.missions.startGoal(arg);
      break;
    default: throw new Error('Unknown command: ' + command);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, status: error.status || null, code: error.code || null }));
  process.exitCode = 1;
}
