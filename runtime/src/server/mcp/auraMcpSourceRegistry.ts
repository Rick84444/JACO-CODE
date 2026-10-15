import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AuraMcpSourceStatus = 'STAGED' | 'OPERATOR_APPROVED' | 'QUARANTINED';

export interface AuraMcpSource {
  id: string;
  schema: 'jaco.mcp-source/v1';
  repoUrl: string;
  requestedRef: string | null;
  resolvedSha: string;
  localPath: string;
  status: AuraMcpSourceStatus;
  importedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  quarantinedAt: string | null;
  quarantineReason: string | null;
  manifest: {
    packageName: string | null;
    packageVersion: string | null;
    packageManager: 'npm' | 'python' | 'unknown';
    scripts: string[];
    bins: string[];
    dependencies: number;
    candidateFiles: string[];
  };
}

const safeJson = (file: string) => {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.length > 512 * 1024) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const sanitize = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 96) || 'mcp-source';

function normalizeGithubUrl(raw: string) {
  const value = String(raw || '').trim();
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('MCP_GIT_URL_INVALID'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('MCP_GIT_GITHUB_HTTPS_REQUIRED');
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('MCP_GIT_REPOSITORY_REQUIRED');
  if (!/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) throw new Error('MCP_GIT_REPOSITORY_INVALID');
  return {
    owner: parts[0],
    repo: parts[1],
    url: `https://github.com/${parts[0]}/${parts[1]}.git`,
  };
}

export class AuraMcpSourceRegistry {
  private root: string;
  private stateDir: string;
  private sourcesDir: string;
  private registryFile: string;

  constructor(workspaceRoot: string) {
    this.root = path.resolve(workspaceRoot);
    this.stateDir = path.join(this.root, '.jaco', 'mcp');
    this.sourcesDir = path.join(this.stateDir, 'sources');
    this.registryFile = path.join(this.stateDir, 'sources.json');
    fs.mkdirSync(this.sourcesDir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.registryFile)) fs.writeFileSync(this.registryFile, '[]\n', { mode: 0o600 });
  }

  private read(): AuraMcpSource[] {
    try {
      const rows = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  private write(rows: AuraMcpSource[]) {
    const tmp = `${this.registryFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.registryFile);
  }

  list() {
    return this.read().sort((a,b) => b.importedAt.localeCompare(a.importedAt));
  }

  get(id: string) {
    return this.read().find(row => row.id === String(id)) || null;
  }

  private inspect(localPath: string): AuraMcpSource['manifest'] {
    const pkg = safeJson(path.join(localPath, 'package.json'));
    const candidates = [
      'mcp.json', '.mcp.json', 'server.json', 'package.json', 'pyproject.toml',
      'src/index.ts', 'src/index.js', 'src/server.ts', 'src/server.js',
      'index.ts', 'index.js', 'server.ts', 'server.js', 'server.py',
    ].filter(file => fs.existsSync(path.join(localPath, file)));

    return {
      packageName: pkg?.name ? String(pkg.name).slice(0, 200) : null,
      packageVersion: pkg?.version ? String(pkg.version).slice(0, 80) : null,
      packageManager: pkg ? 'npm' : fs.existsSync(path.join(localPath, 'pyproject.toml')) ? 'python' : 'unknown',
      scripts: pkg?.scripts && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts).slice(0, 100) : [],
      bins: pkg?.bin
        ? (typeof pkg.bin === 'string' ? [pkg.bin] : Object.keys(pkg.bin).slice(0, 100))
        : [],
      dependencies: pkg
        ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) }).length
        : 0,
      candidateFiles: candidates,
    };
  }

  async stageGit(input: { repoUrl: string; ref?: string | null }): Promise<AuraMcpSource> {
    const remote = normalizeGithubUrl(input.repoUrl);
    const requestedRef = String(input.ref || '').trim().slice(0, 200) || null;
    const refs = requestedRef
      ? [requestedRef, `refs/heads/${requestedRef}`, `refs/tags/${requestedRef}`]
      : ['HEAD'];

    const { stdout } = await execFileAsync('git', ['ls-remote', '--exit-code', remote.url, ...refs], {
      cwd: this.root,
      timeout: 20_000,
      maxBuffer: 512 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const first = String(stdout || '').split(/\r?\n/).map(line => line.trim()).find(Boolean);
    const sha = first?.split(/\s+/)[0] || '';
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('MCP_GIT_REF_NOT_RESOLVED');

    const id = sanitize(`${remote.owner}-${remote.repo}-${sha.slice(0,12)}`);
    const existing = this.get(id);
    if (existing) return existing;

    const localPath = path.join(this.sourcesDir, id);
    fs.rmSync(localPath, { recursive: true, force: true });
    fs.mkdirSync(localPath, { recursive: true, mode: 0o700 });

    try {
      await execFileAsync('git', ['init', '--quiet'], {
        cwd: localPath, timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      await execFileAsync('git', ['remote', 'add', 'origin', remote.url], {
        cwd: localPath, timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', 'fetch', '--depth', '1', 'origin', sha], {
        cwd: localPath, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
      });
      await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', '--quiet', 'FETCH_HEAD'], {
        cwd: localPath, timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
      });
    } catch (error) {
      fs.rmSync(localPath, { recursive: true, force: true });
      throw error;
    }

    const record: AuraMcpSource = {
      id,
      schema: 'jaco.mcp-source/v1',
      repoUrl: remote.url,
      requestedRef,
      resolvedSha: sha.toLowerCase(),
      localPath: path.relative(this.root, localPath).replace(/\\/g, '/'),
      status: 'STAGED',
      importedAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
      quarantinedAt: null,
      quarantineReason: null,
      manifest: this.inspect(localPath),
    };
    const rows = this.read();
    rows.push(record);
    this.write(rows);
    return record;
  }

  promote(id: string, operator = 'Aura operator') {
    const rows = this.read();
    const index = rows.findIndex(row => row.id === String(id));
    if (index < 0) throw new Error('MCP_SOURCE_NOT_FOUND');
    if (rows[index].status === 'QUARANTINED') throw new Error('MCP_SOURCE_QUARANTINED');
    rows[index] = {
      ...rows[index],
      status: 'OPERATOR_APPROVED',
      approvedAt: new Date().toISOString(),
      approvedBy: String(operator).slice(0, 200),
    };
    this.write(rows);
    return rows[index];
  }

  quarantine(id: string, reason = 'Rejected by operator') {
    const rows = this.read();
    const index = rows.findIndex(row => row.id === String(id));
    if (index < 0) throw new Error('MCP_SOURCE_NOT_FOUND');
    rows[index] = {
      ...rows[index],
      status: 'QUARANTINED',
      quarantinedAt: new Date().toISOString(),
      quarantineReason: String(reason).slice(0, 1000),
    };
    this.write(rows);
    return rows[index];
  }
}

export default AuraMcpSourceRegistry;
