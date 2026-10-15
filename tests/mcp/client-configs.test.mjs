#!/usr/bin/env node
import assert from 'node:assert/strict';
// Verifies the checked-in MCP client configs by executing exactly what they
// declare and completing a real MCP handshake through the launcher.
//
// This catches the failure mode that left JACO unreachable from Claude Code:
// a config entry whose command points at a path that no longer exists still
// looks fine on inspection and only fails at spawn time.
//
// Exit 0 = every declared server handshakes and exposes tools.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMcpCoreBaseUrl } from '../../runtime/tools/mcp-runtime-url.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mcpLauncherSource = readFileSync(join(root, 'runtime', 'tools', 'jaco-mcp-launch.mjs'), 'utf8');
assert.match(mcpLauncherSource, /RUNTIME_ONLY[^\n]+JACO_CHATGPT_WORKPLACE_TOKEN/);

assert.equal(resolveMcpCoreBaseUrl({ JACO_BASE_URL:'http://127.0.0.1:3999', JACO_RUNTIME_URL:'http://127.0.0.1:3107' }), 'http://127.0.0.1:3999');
assert.equal(resolveMcpCoreBaseUrl({ JACO_RUNTIME_URL:'http://127.0.0.1:3107/' }), 'http://127.0.0.1:3107');
assert.equal(resolveMcpCoreBaseUrl({ JACO_CORE_URL:'http://127.0.0.1:3200/' }), 'http://127.0.0.1:3200');
assert.equal(resolveMcpCoreBaseUrl({}), 'http://127.0.0.1:3000');

const targets = [
  { label: 'Claude Code', file: join(root, '.mcp.json'), key: 'mcpServers' },
  { label: 'VS Code', file: join(root, '.vscode', 'mcp.json'), key: 'servers' },
];

function handshake(command, args, env) {
  return new Promise(resolve_ => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let buf = '';
    let settled = false;
    const finish = r => { if (!settled) { settled = true; clearTimeout(timer); child.kill(); resolve_(r); } };
    const timer = setTimeout(() => finish({ ok: false, detail: 'timeout' }), 30000);
    child.on('error', e => finish({ ok: false, detail: e.message }));
    child.on('exit', c => finish({ ok: false, detail: `process exited code=${c}` }));
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buf += chunk;
      let cut;
      while ((cut = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, cut).trim();
        buf = buf.slice(cut + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) return finish({ ok: false, detail: JSON.stringify(msg.error) });
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        }
        if (msg.id === 2) {
          const tools = msg.result?.tools || [];
          const untyped = tools.filter(t => !t.inputSchema).map(t => t.name);
          if (untyped.length) return finish({ ok: false, detail: `tools without inputSchema: ${untyped.join(',')}` });
          return finish({ ok: tools.length > 0, detail: `${tools.length} tools, all typed` });
        }
      }
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'client-config-test', version: '1' } },
    }) + '\n');
  });
}

let checked = 0;
let failed = 0;

for (const target of targets) {
  if (!existsSync(target.file)) {
    console.log(`FAIL  ${target.label.padEnd(12)} missing config: ${target.file}`);
    failed++;
    continue;
  }
  const cfg = JSON.parse(readFileSync(target.file, 'utf8'));
  const servers = cfg[target.key] || {};
  if (Object.keys(servers).length === 0) {
    console.log(`FAIL  ${target.label.padEnd(12)} declares no servers under "${target.key}"`);
    failed++;
    continue;
  }
  for (const [name, spec] of Object.entries(servers)) {
    const args = (spec.args || []).map(a => a.replaceAll('${workspaceFolder}', root));
    // A config that points at a missing file spawns and dies; check first so
    // the failure names the path instead of an opaque exit code.
    const scriptArg = args.find(a => a.endsWith('.mjs') || a.endsWith('.js'));
    if (scriptArg && !existsSync(resolve(root, scriptArg))) {
      console.log(`FAIL  ${target.label.padEnd(12)} server="${name}" command target does not exist: ${scriptArg}`);
      failed++; checked++;
      continue;
    }
    const r = await handshake(spec.command, args, spec.env || {});
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${target.label.padEnd(12)} server="${name}"  ${r.detail}`);
    checked++;
    if (!r.ok) failed++;
  }
}

console.log(`\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'}  (${checked - failed}/${checked})`);
process.exit(failed === 0 ? 0 : 1);
