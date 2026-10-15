import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = [
  'agents/cdp-bridge.mjs',
  'gateway/src/seer.mjs',
  'gateway/src/chatgpt-nova-gateway.mjs',
  'agents/hands-off-agent.mjs',
  'agents/nova-bridge.mjs',
  ...readdirSync('agents/lib').filter(file => file.endsWith('.mjs')).map(file => `agents/lib/${file}`),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('JACO runtime JavaScript syntax checks passed (not a full runtime build).');
