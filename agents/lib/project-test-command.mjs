// Read-only test discovery at the project boundary. One canonical source for
// full IDE and Lite missions. The selected command is attached to the contract
// once, so Aura can execute, debug and rerun it inside the mission worktree.
import fs from 'node:fs';
import path from 'node:path';

export function detectProjectTestCommand(projectRoot, fsImpl = fs) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return null;
  const has = relative => fsImpl.existsSync(path.join(projectRoot, relative));
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fsImpl.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      const script = pkg?.scripts?.test;
      if (typeof script === 'string' && script.trim() &&
          !/no test specified/i.test(script) && !/^echo\b/i.test(script.trim())) return 'npm test';
    } catch { /* No verified test command inferred from unreadable project metadata. */ }
  }
  if (has('pytest.ini') || has('conftest.py')) return 'python -m pytest';
  if (has('pyproject.toml')) {
    try {
      const pyproject = String(fsImpl.readFileSync(path.join(projectRoot, 'pyproject.toml'), 'utf8'));
      if (/\bpytest\b/i.test(pyproject)) return 'python -m pytest';
    } catch {}
  }
  if (has('go.mod')) return 'go test ./...';
  if (has('Cargo.toml')) return 'cargo test';
  return null;
}
