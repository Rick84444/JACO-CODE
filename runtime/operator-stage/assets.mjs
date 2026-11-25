// The Operator Stage's files: the page, its script and style, and the modules it shares with the IDE
// (Aura's rig, three.js, the workspace directives, the speech splitter). The runtime serves them on this
// computer's start page (operator 2026-11-25: Aura first, the IDE stays at /ide). Nothing here runs anything.
// Paths come from the runtime root, not import.meta: the server is bundled to CommonJS.
import fs from 'node:fs';
import path from 'node:path';

/** @param {string} runtimeRoot the runtime release folder (the one holding operator-stage/ and src/lib/) */
export function operatorStageAssets(runtimeRoot) {
  const here = path.join(runtimeRoot, 'operator-stage');
  const js = 'text/javascript; charset=utf-8';
  const fixed = {
    '/': [path.join(here, 'index.html'), 'text/html; charset=utf-8'],
    '/stage.css': [path.join(here, 'stage.css'), 'text/css; charset=utf-8'],
    '/stage.js': [path.join(here, 'stage.js'), js],
    '/vendor/aura-rig.mjs': [path.join(runtimeRoot, 'src/lib/auraRigLightform.mjs'), js],
    '/vendor/workspace-actions.mjs': [path.join(runtimeRoot, 'src/lib/workspaceActions.mjs'), js],
    '/vendor/speech-parts.mjs': [path.join(runtimeRoot, 'src/lib/speechParts.mjs'), js],
  };
  // three.js for the rig, limited to its build and examples/jsm folders.
  const threeRoots = {
    '/vendor/three/build/': path.join(runtimeRoot, 'node_modules/three/build'),
    '/vendor/three/addons/': path.join(runtimeRoot, 'node_modules/three/examples/jsm'),
  };
  return {
    /** Every file the page needs is present (a slim release without the stage falls back to the IDE). */
    available: () => Object.values(fixed).every(([file]) => fs.existsSync(file)),
    /**
     * The file's bytes, with the bare `three` imports pointed at the served copies. The runtime's CSP allows no
     * inline script, so an import map is not an option, and without this the rig could not load (the operator
     * saw the particle fallback instead of Aura, 2026-11-25).
     * @param {{ file: string, type: string }} asset
     */
    read(asset) {
      const body = fs.readFileSync(asset.file);
      if (!asset.type.startsWith('text/javascript')) return body;
      return Buffer.from(body.toString('utf8')
        .replace(/(from\s*|import\s*\(?\s*)(['"])three\2/g, '$1$2/vendor/three/build/three.module.js$2')
        .replace(/(from\s*|import\s*\(?\s*)(['"])three\/addons\//g, '$1$2/vendor/three/addons/'), 'utf8');
    },
    /** @param {string} pathname @returns {{ file: string, type: string } | null} */
    resolve(pathname) {
      const known = fixed[pathname];
      if (known) return { file: known[0], type: known[1] };
      for (const [prefix, root] of Object.entries(threeRoots)) {
        if (!pathname.startsWith(prefix) || !pathname.endsWith('.js')) continue;
        const full = path.resolve(root, '.' + pathname.slice(prefix.length - 1));
        if (full.startsWith(root + path.sep) && fs.existsSync(full)) return { file: full, type: js };
      }
      return null;
    },
  };
}
