import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
const execFileAsync = promisify(execFile);

export class SystemControl {
  constructor({
    jacoctl,
    allowMcpActivation = false,
    allowMcpUpdate = false,
    core,
    timeoutMs = Number(process.env.JACO_SYSTEM_CONTROL_TIMEOUT_MS || 420000),
    // The default jacoctl is the installed wrapper in ~/.local/bin, so paths derived from it
    // pointed at $HOME. JACO_ROOT (set by install-activation.sh) is the runtime checkout.
    runtimeRoot = process.env.JACO_ROOT || resolve(dirname(jacoctl), '..'),
    repoRoot = process.env.JACO_REPO_ROOT || resolve(runtimeRoot, '..'),
    gitBin = process.env.JACO_GIT_BIN || 'git',
    bashBin = process.env.JACO_BASH_BIN || '/data/data/com.termux/files/usr/bin/bash',
    npmBin = process.env.JACO_NPM_BIN || 'npm',
    execFileImpl = execFileAsync,
    spawnImpl = spawn,
  }) {
    this.jacoctl = jacoctl;
    this.allowMcpActivation = allowMcpActivation;
    this.allowMcpUpdate = allowMcpUpdate;
    this.core = core;
    this.timeoutMs = Math.max(60000, Number(timeoutMs) || 420000);
    this.runtimeRoot = runtimeRoot;
    this.repoRoot = repoRoot;
    this.gitBin = gitBin;
    this.bashBin = bashBin;
    this.npmBin = npmBin;
    this.execFileImpl = execFileImpl;
    this.spawnImpl = spawnImpl;
    this.sentinelRestartHelper = join(runtimeRoot, 'termux', 'restart-sentinel-after-delay.sh');
  }

  async runFile(file, args, extra = {}) {
    return this.execFileImpl(file, args, {
      timeout: this.timeoutMs,
      maxBuffer: 1024 * 1024,
      env: process.env,
      ...extra,
    });
  }

  async runCtl(args) {
    // Windows has no bash jacoctl wrapper; a Node entry point runs under the current Node executable.
    const [file, argv] = this.jacoctl.endsWith('.mjs') ? [process.execPath, [this.jacoctl, ...args]] : [this.jacoctl, args];
    const { stdout, stderr } = await this.runFile(file, argv, {
    });
    let parsed;
    try { parsed = JSON.parse(stdout); } catch { parsed = { stdout: stdout.trim(), stderr: stderr.trim() }; }
    return parsed;
  }

  async status() {
    try { return await this.runCtl(['status', '--json']); }
    catch (error) {
      let core = null;
      try { core = await this.core.identity(); } catch {}
      return { sentinel: 'RUNNING', supervisor: 'UNAVAILABLE', core, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async activate(profile = 'full', { fromMcp = true } = {}) {
    if (profile !== 'full') throw new Error('UNSUPPORTED_ACTIVATION_PROFILE');
    if (fromMcp && !this.allowMcpActivation) throw new Error('MCP_ACTIVATION_DISABLED: set JACO_MCP_ALLOW_ACTIVATION=1 after operator review');
    return this.runCtl(['activate', '--profile', 'full', '--json']);
  }

  async restart({ fromMcp = true } = {}) {
    if (fromMcp && !this.allowMcpActivation) throw new Error('MCP_ACTIVATION_DISABLED: set JACO_MCP_ALLOW_ACTIVATION=1 after operator review');
    return this.runCtl(['restart', '--json']);
  }

  async update({ fromMcp = true } = {}) {
    if (fromMcp && !this.allowMcpUpdate) throw new Error('MCP_UPDATE_DISABLED: set JACO_MCP_ALLOW_UPDATE=1 after operator review');

    const tracked = (await this.runFile(this.gitBin, ['-C', this.repoRoot, 'status', '--porcelain', '--untracked-files=no'])).stdout.trim();
    if (tracked) throw new Error('REMOTE_UPDATE_TRACKED_CHANGES: clean or stash tracked changes before remote update');

    const branch = (await this.runFile(this.gitBin, ['-C', this.repoRoot, 'branch', '--show-current'])).stdout.trim();
    if (branch !== 'master') throw new Error(`REMOTE_UPDATE_BRANCH_UNSUPPORTED:${branch || 'DETACHED'}`);

    const before = (await this.runFile(this.gitBin, ['-C', this.repoRoot, 'rev-parse', 'HEAD'])).stdout.trim();
    await this.runFile(this.gitBin, ['-C', this.repoRoot, 'fetch', 'origin', 'master']);
    await this.runFile(this.gitBin, ['-C', this.repoRoot, 'merge', '--ff-only', 'origin/master']);
    const after = (await this.runFile(this.gitBin, ['-C', this.repoRoot, 'rev-parse', 'HEAD'])).stdout.trim();

    // New dependencies arrive with the pull; the runtime only installs when tsx is missing.
    const dependencyDirs = [];
    if (before !== after) {
      const changed = (await this.runFile(this.gitBin, ['-C', this.repoRoot, 'diff', '--name-only', before, after])).stdout
        .split('\n').map(line => line.trim()).filter(line => /(^|\/)package(-lock)?\.json$/.test(line));
      for (const dir of new Set(changed.map(file => dirname(file)))) {
        await this.runFile(this.npmBin, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: join(this.repoRoot, dir) });
        dependencyDirs.push(dir);
      }
    }

    const runtime = await this.runCtl(['restart', '--json']);
    if (String(runtime?.state || '') !== 'READY') {
      throw new Error(`REMOTE_UPDATE_RUNTIME_NOT_READY:${String(runtime?.state || 'UNKNOWN')}`);
    }

    const child = this.spawnImpl(this.bashBin, [this.sentinelRestartHelper, '3'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref?.();

    return {
      state: 'UPDATED',
      before,
      after,
      changed: before !== after,
      dependenciesInstalled: dependencyDirs,
      runtime: 'READY',
      sentinelRestartScheduled: true,
    };
  }

  async deactivateCore() {
    return this.runCtl(['deactivate', '--json']);
  }
}
