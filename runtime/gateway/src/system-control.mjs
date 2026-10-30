import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { readStartupEvidence } from '../../../agents/lib/startup-evidence.mjs';
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
    fetchImpl = fetch,
    workplaceUrl = process.env.JACO_WORKPLACE_URL || 'http://127.0.0.1:2995',
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
    this.fetchImpl = fetchImpl;
    this.workplaceUrl = String(workplaceUrl).replace(/\/$/, '');
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
    // Windows uses the canonical Node CLI; Termux retains its executable wrapper.
    const nodeCli = typeof this.jacoctl === 'string' && this.jacoctl.endsWith('.mjs');
    const file = nodeCli ? process.execPath : this.jacoctl;
    const argv = nodeCli ? [this.jacoctl, ...args] : args;
    let stdout, stderr;
    try {
      ({ stdout, stderr } = await this.runFile(file, argv));
    } catch (error) {
      // The CLI deliberately exits 1 for DEGRADED but still emits a structured
      // jaco.activation/v2 report. Preserve it; do not turn a nonzero exit
      // into a generic failure or publish raw stderr/local paths in GitHub.
      try {
        const parsed = JSON.parse(String(error?.stdout || ''));
        if (parsed?.schema === 'jaco.activation/v2' && typeof parsed.ok === 'boolean') return parsed;
      } catch {}
      throw error;
    }
    let parsed;
    try { parsed = JSON.parse(stdout); }
    catch { parsed = { stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() }; }
    return parsed;
  }

  // Independent, bounded, read-only target-host probes. No shell, Git or remote network.
  async health() {
    const workplaceTarget = new URL(this.workplaceUrl);
    if (workplaceTarget.protocol !== 'http:' ||
        !['127.0.0.1','localhost','[::1]'].includes(workplaceTarget.hostname) ||
        workplaceTarget.username || workplaceTarget.password) {
      throw new Error('JACO_HEALTH_WORKPLACE_MUST_BE_LOOPBACK');
    }
    const [coreProbe, workplaceProbe] = await Promise.allSettled([
      this.core.request
        ? this.core.request('/api/runtime/identity', {signal:AbortSignal.timeout(4000)})
        : this.core.identity(),
      this.fetchImpl(this.workplaceUrl + '/health', {
        method:'GET', redirect:'error', signal:AbortSignal.timeout(4000),
      }).then(async response => {
        if (!response.ok) throw new Error('WORKPLACE_HTTP_NOT_OK');
        const body = await response.json();
        if (body?.product !== 'JACO Workplace') throw new Error('WRONG_WORKPLACE_IDENTITY');
        return body;
      }),
    ]);
    const coreUp = coreProbe.status === 'fulfilled' &&
      coreProbe.value && coreProbe.value.success !== false;
    const w = workplaceProbe.status === 'fulfilled' ? workplaceProbe.value : null;
    const workplaceUp = Boolean(w);
    const wpState = w?.supervisedAgents?.state === 'RUNNING' ? 'RUNNING'
      : workplaceUp ? 'DEGRADED' : 'DOWN';
    const novaState = w?.supervisedAgents?.nova?.state === 'RUNNING' ? 'RUNNING'
      : workplaceUp ? 'DEGRADED' : 'DOWN';
    const startup = String(this.jacoctl || '').endsWith('.mjs')
      ? readStartupEvidence(this.repoRoot) : null;
    const status = coreUp && wpState === 'RUNNING' && novaState === 'RUNNING'
      ? (startup && !startup.ok ? 'DEGRADED' : 'READY')
      : coreUp || workplaceUp ? 'DEGRADED' : 'DOWN';
    return {
      schema:'jaco.service-health/v1', status,
      core:{up:Boolean(coreUp)},
      workplace:{up:workplaceUp,state:wpState,novaState},
      aura:{state:'NOT_INDEPENDENTLY_PROBED'},
      ...(startup ? { startup } : {}),
    };
  }

  async status() {
    try {
      const report = await this.runCtl(['status', '--json']);
      if (String(this.jacoctl || '').endsWith('.mjs') && report?.schema === 'jaco.activation/v2') {
        const startup = readStartupEvidence(this.repoRoot);
        const ok = report.ok === true && startup.ok;
        return { ...report, startup, ok };
      }
      return report;
    }
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
    if (branch !== 'main') throw new Error(`REMOTE_UPDATE_BRANCH_UNSUPPORTED:${branch || 'DETACHED'}`);

    const before = (await this.runFile(this.gitBin, ['-C', this.repoRoot, 'rev-parse', 'HEAD'])).stdout.trim();
    await this.runFile(this.gitBin, ['-C', this.repoRoot, 'fetch', 'origin', 'main']);
    await this.runFile(this.gitBin, ['-C', this.repoRoot, 'merge', '--ff-only', 'origin/main']);
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
