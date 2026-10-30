#!/usr/bin/env node
// Windows receiver for [JACO BOOT] GitHub control issues: runs the Sentinel with the local stack's
// jaco CLI as its control command, so JACO can be inspected and started while the stack is off.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyWindowsHubRole } from './windows-local-hub-env.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { parse } = createRequire(path.join(repo, 'package.json'))('dotenv');
const envFile = path.join(repo, '.env');
for (const [key, value] of Object.entries(fs.existsSync(envFile) ? parse(fs.readFileSync(envFile)) : {})) process.env[key] ??= value;
// Local hub role remains authoritative across Windows logins, even when .env
// still contains an old remote pairing. No .env file is changed or exposed.
applyWindowsHubRole(process.env);
// Same rule as the local stack: the receiver talks to GitHub and never with certificate checks off.
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

let token = process.env.JACO_GITHUB_BOOTSTRAP_TOKEN || process.env.JACO_GITHUB_CONTROL_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
// Without a token the Sentinel can read but never answer or close an issue; take the gh CLI login from the OS keyring.
if (!token) try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { /* git-ref transport */ }

// The Sentinel reads its bind settings from names the local stack uses for the ChatGPT gateway. Set them only while
// the frozen Sentinel config loads, so the jaco CLI and the stack it starts still see the stack's own values.
const sentinelOnly = {
  JACO_GATEWAY_HOST: '127.0.0.1',
  JACO_GATEWAY_PORT: process.env.JACO_SENTINEL_PORT || '2999',
  JACO_GATEWAY_MODE: 'loopback',
  JACO_GITHUB_BOOTSTRAP_TOKEN: token,
};
const saved = Object.fromEntries(Object.keys(sentinelOnly).map(key => [key, process.env[key]]));
Object.assign(process.env, sentinelOnly, {
  JACO_GITHUB_BOOTSTRAP_ENABLE: '1',
  JACOCTL_PATH: path.join(repo, 'agents', 'jaco-cli.mjs'),
  JACO_ROOT: path.join(repo, 'runtime'),
  JACO_REPO_ROOT: repo,
});
await import('../gateway/src/config.mjs');
for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
await import('../gateway/src/sentinel.mjs');
