// Read-only test discovery at the project boundary. One canonical source for
// full IDE and Lite missions. The selected command is attached to the contract
// once, so Aura can execute, debug and rerun it inside the mission worktree.
import fs from 'node:fs';
import path from 'node:path';

// We only need to distinguish harmless echo/exit stubs from test commands.
// Shell separators inside quotes are *data*, not another command.
function shellStages(source) {
  const stages = [];
  let current = '', quote = null, escaped = false;
  const script = String(source);
  for (let i = 0; i < script.length; i++) {
    const char = script[i];
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\' && quote !== "'") { current += char; escaped = true; continue; }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === ';' || char === '\n' ||
        (char === '&' && script[i + 1] === '&') ||
        (char === '|' && script[i + 1] === '|')) {
      if (current.trim()) stages.push(current.trim());
      current = '';
      if (char === '&' || char === '|') i++;
      continue;
    }
    current += char;
  }
  if (current.trim()) stages.push(current.trim());
  // Unknown quoting is not evidence of a valid test runner.
  return quote ? [] : stages;
}

export function detectProjectTestCommand(projectRoot, fsImpl = fs) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return null;
  const has = relative => fsImpl.existsSync(path.join(projectRoot, relative));
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fsImpl.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      const script = pkg?.scripts?.test;
      // Reject the common no-op npm scripts, but preserve real test commands
      // preceded by banners: "echo Running tests && node --test" must be runnable.
      if (typeof script === 'string' && script.trim() && !/no test specified/i.test(script)) {
        const stages = shellStages(script);
        if (stages.length && !stages.every(part => /^(?:echo|exit)\b/i.test(part))) return 'npm test';
      }
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
