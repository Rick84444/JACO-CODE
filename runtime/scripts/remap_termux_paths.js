import fs from 'fs';
import path from 'path';

/**
 * Termux Path Remapper & File Existence Verifier
 * Remaps or aliases build directory paths for local Node.js environments in Termux,
 * ensuring 'dist/server.cjs' is correctly located, copied/aliased, and loaded.
 */
export function remapTermuxBuildPaths(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  

  const primaryTarget = path.join(rootDir, 'dist', 'server.cjs');

  console.log('🔍 [TERMUX PATH REMAPPER] Checking build artifact paths in:', rootDir);

  const candidatePaths = [
    path.join(rootDir, 'dist', 'server.cjs'),
    path.join(rootDir, 'dist', 'server.js'),
    path.join(rootDir, 'build', 'server.cjs'),
    path.join(rootDir, 'build', 'server.js'),
    path.join(rootDir, 'server.cjs'),
    path.join(rootDir, 'dist', 'server', 'index.cjs')
  ];

  // 1. Check if primary target already exists and is non-empty
  if (fs.existsSync(primaryTarget) && fs.statSync(primaryTarget).size > 0) {
    console.log(`✅ [OK] Verified primary target exists: ${primaryTarget} (${fs.statSync(primaryTarget).size} bytes)`);
    return { status: 'verified', path: primaryTarget };
  }

  // 2. Search for alternate candidate files
  let matchedCandidate = null;
  for (const cand of candidatePaths) {
    if (fs.existsSync(cand) && fs.statSync(cand).size > 0) {
      matchedCandidate = cand;
      break;
    }
  }

  // Ensure 'dist' directory exists
  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 3. Remap / Alias candidate to primary target
  if (matchedCandidate && matchedCandidate !== primaryTarget) {
    try {
      fs.copyFileSync(matchedCandidate, primaryTarget);
      console.log(`🔀 [REMAPPED] Successfully copied/aliased '${matchedCandidate}' -> '${primaryTarget}'`);
      return { status: 'remapped', path: primaryTarget, original: matchedCandidate };
    } catch (err) {
      console.warn(`⚠️ [REMAP WARNING] Failed to copy candidate: ${err.message}. Attempting symlink...`);
      try {
        fs.symlinkSync(matchedCandidate, primaryTarget);
        return { status: 'symlinked', path: primaryTarget, original: matchedCandidate };
      } catch (symErr) {
        console.error(`❌ [REMAP ERROR] Could not create alias: ${symErr.message}`);
      }
    }
  }

  // 4. Automated verification check
  const exists = fs.existsSync(primaryTarget);
  const size = exists ? fs.statSync(primaryTarget).size : 0;

  return {
    status: exists && size > 0 ? 'exists' : 'missing',
    path: primaryTarget,
    exists,
    size
  };
}

// If executed directly from CLI: node scripts/remap_termux_paths.js
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('remap_termux_paths.js')) {
  const result = remapTermuxBuildPaths();
  console.log('Result:', result);
  if (result.status === 'missing') {
    process.exit(1);
  }
}
