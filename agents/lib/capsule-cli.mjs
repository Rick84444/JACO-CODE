#!/usr/bin/env node
// Operator-facing CLI. Initialization is never triggered by agent execution.
import { agentHomeDir, ensureHome } from './agent-home.mjs';
import { initCognitiveCapsule, loadCognitiveCapsule } from './cognitive-capsule.mjs';

const [, , command, agentId = 'nova'] = process.argv;
try {
  const dir = agentHomeDir(agentId);
  if (command === 'init') {
    ensureHome(dir);
    const result = initCognitiveCapsule(dir, agentId);
    console.log(JSON.stringify({ status: 'CREATED', ...result }, null, 2));
  } else if (command === 'show') {
    // Inspect the configuration without granting capabilities or exposing memory.
    const capsule = loadCognitiveCapsule(dir, {
      agentId, mission: { id: 'inspection-only', allowedTasks: [
        'repo-list', 'repo-read', 'repo-edit', 'repo-test', 'git-status', 'git-diff',
        'shell', 'mcp-call', 'mcp-write', 'web-fetch', 'browser-click', 'git-push',
      ] },
    });
    console.log(JSON.stringify({ dir, enabled: capsule.enabled, agentId, fingerprint: capsule.fingerprint || null,
      configuredKnownAllowedTools: capsule.allowedTasks, skillCatalog: capsule.skills || [] }, null, 2));
  } else {
    console.error('Usage: node agents/lib/capsule-cli.mjs init|show [agent-id]');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`Cognitive Capsule: ${error.message}`);
  process.exitCode = 1;
}
