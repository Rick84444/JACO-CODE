import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// server.ts is too large to boot in a unit test, so this checks the wiring textually: the IDE's
// editable surfaces use the selected project root while JACO's own state stays in WORKSPACE_ROOT.
const server = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.ts'), 'utf8');
const between = (start, end) => {
  const from = server.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  return server.slice(from, server.indexOf(end, from + start.length));
};

test('server.ts creates and serves the project root', () => {
  assert.match(server, /import \{ createProjectRoot \} from '\.\/src\/server\/projectRoot\.mjs';/);
  assert.match(server, /const projectRoot = createProjectRoot\(\{ stateDir: path\.join\(WORKSPACE_ROOT, '\.jaco'\)/);
  assert.ok(server.includes("app.get('/api/aura/workbench/project'"));
  assert.ok(server.includes("app.post('/api/aura/workbench/project'"));
});

test('workbench surfaces use the project root', () => {
  assert.ok(between('const listAuraWorkbenchFiles', 'return files;').includes("walk(projectRoot.get(), '', 0)"));
  assert.ok(between('function resolveWorkspacePath', '\n}\n').includes('const base = projectRoot.get();'));
  assert.ok(between('const getAuraWorkbenchGitStatus', 'timeout: 3000').includes('cwd: projectRoot.get()'));
  assert.ok(between('const readAuraGitDiff', 'timeout: 5000').includes('cwd: projectRoot.get()'));
  assert.ok(server.includes('spawn(executable, args, { cwd: projectRoot.get(), shell: false'));
});

test('invalid wiring', () => {
  for (const stale of [
    "walk(WORKSPACE_ROOT, '', 0)",
    'resolveWorkspacePath(requested) : WORKSPACE_ROOT',
    'spawn(executable, args, { cwd: WORKSPACE_ROOT',
  ]) assert.ok(!server.includes(stale), `stale workspace wiring: ${stale}`);
  assert.ok(!between('function resolveWorkspacePath', '\n}\n').includes('path.resolve(WORKSPACE_ROOT, relativePath)'));
  assert.ok(between('function resolveWorkspacePath', '\n}\n').includes('fs.realpathSync'), 'symlink guard missing');
  // JACO's own state must not follow the project.
  assert.ok(server.includes("path.join(WORKSPACE_ROOT, '.jaco', 'skills')"));
  assert.ok(server.includes("path.join(WORKSPACE_ROOT, '.jaco', 'mcp', 'servers.json')"));
});
