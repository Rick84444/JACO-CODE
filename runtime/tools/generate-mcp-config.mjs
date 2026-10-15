#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const windows = process.platform === 'win32';
const config = {
  mcpServers: {
    'jaco-autonomus-ide': windows ? {
      command: path.join(root, 'tools', 'START_JACO_MCP_WINDOWS.cmd'),
      env: { JACO_BASE_URL: 'http://127.0.0.1:3000', JACO_MODEL_ID: 'external-model' },
    } : {
      command: process.execPath,
      args: [path.join(root, 'tools', 'jaco-mcp-server.mjs')],
      env: { JACO_BASE_URL: 'http://127.0.0.1:3000', JACO_MODEL_ID: 'external-model' },
    },
  },
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (output) { fs.writeFileSync(output, JSON.stringify(config, null, 2) + '\n'); console.log(output); }
else console.log(JSON.stringify(config, null, 2));
