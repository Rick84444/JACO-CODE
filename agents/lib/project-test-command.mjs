// Read-only test discovery at the project boundary. One canonical source for
// full IDE and Lite missions. The selected command is attached to the contract
// once, so Aura can execute, debug and rerun it inside the mission worktree.
import fs from 'node:fs';
import path from 'node:path';

// A tiny abstract interpreter for common npm-script control flow. Unlike simply
// searching the script text for "test", this rejects a successful no-op path.
// The model can still inspect/edit/test in its workspace; only the claim that a
// successful script verified code is withheld when success did not require work.
function shellStages(source) {
  const stages = [];
  let current = '', quote = null, escaped = false, join = ';';
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
    if (char === '#' && (i === 0 || /\s/.test(script[i - 1]))) {
      // In a POSIX shell an unquoted comment discards the rest of this line.
      // Ignore apparent test commands inside it.
      while (i < script.length && script[i] !== '\n') i++;
      if (i < script.length) {
        if (current.trim()) stages.push({ command: current.trim(), join });
        current = ''; join = ';';
      }
      continue;
    }
    // A plain pipeline reports the last process status unless pipefail is
    // explicitly active. It can mask a failed test, so do not certify it.
    if ((char === '|' && script[i + 1] !== '|' && script[i - 1] !== '|') ||
        (char === '&' && script[i + 1] !== '&' && script[i - 1] !== '&')) return [];
    const operator = char === ';' || char === '\n' ? ';' :
      char === '&' && script[i + 1] === '&' ? '&&' :
      char === '|' && script[i + 1] === '|' ? '||' : null;
    if (operator) {
      if (current.trim()) stages.push({ command: current.trim(), join });
      current = ''; join = operator;
      if (operator.length === 2) i++;
      continue;
    }
    current += char;
  }
  if (current.trim()) stages.push({ command: current.trim(), join });
  return quote ? [] : stages;
}

function npmScriptCanCertifyTests(script) {
  const stages = shellStages(script);
  if (!stages.length || stages.length > 32) return false;
  // State represents last exit code, whether a meaningful command succeeded,
  // and whether the script explicitly terminated.
  let states = [{ ok: true, verified: false, failedTest: false, ended: false }];
  for (const { command, join } of stages) {
    const next = [];
    for (const state of states) {
      const run = !state.ended && (join === ';' || (join === '&&' ? state.ok : !state.ok));
      if (!run) { next.push(state); continue; }
      const exit = command.match(/^exit(?:\s+([0-9]+))?\s*$/i);
      if (exit) { next.push({ ...state, ended: true, ok: Number(exit[1] || 0) === 0 }); continue; }
      if (/^(?:echo\b|true\s*$|:\s*$)/i.test(command)) {
        next.push({ ...state, ok: true }); continue;
      }
      if (/^false\s*$/i.test(command)) { next.push({ ...state, ok: false }); continue; }
      // Lint/build and display commands may prepare a test, but cannot certify
      // one by themselves. Any other script command may be a custom test runner.
      const preparatory = /^(?:npm\s+run\s+(?:lint|build|format|typecheck)\b|(?:eslint|tsc|prettier|pwd|date|git\s+status)\b)/i.test(command);
      next.push({ ...state, ok: true, verified: state.verified || !preparatory });
      next.push({ ...state, ok: false, failedTest: state.failedTest || !preparatory });
    }
    // Only four boolean combinations plus the termination flag are possible.
    states = [...new Map(next.map(x => [String([x.ok, x.verified, x.failedTest, x.ended]), x])).values()];
  }
  const success = states.filter(state => state.ok);
  return success.length > 0 && success.every(state => state.verified && !state.failedTest);
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
        if (npmScriptCanCertifyTests(script)) return 'npm test';
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
