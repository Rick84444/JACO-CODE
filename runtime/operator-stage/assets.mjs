// The Operator Stage's files: the page, its script and style, and the modules it shares with the IDE
// (Aura's rig, three.js, the workspace directives, the speech splitter). The runtime serves them on this
// computer's start page (operator 2026-11-25: Aura first, the IDE stays at /ide). Nothing here runs anything.
// Paths come from the runtime root, not import.meta: the server is bundled to CommonJS.
//
// Two layouts: a source checkout (operator-stage/, src/lib/, node_modules/three) and a release, where
// scripts/build-operator-stage.mjs copied the same files to dist/operator-stage/ (Lite and the installers ship
// dist/, not src/). The source wins when it is complete, so an edit shows without a rebuild.
import fs from 'node:fs';
import path from 'node:path';

const JS = 'text/javascript; charset=utf-8';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': JS, '.mjs': JS };

function layout(runtimeRoot) {
  const stage = path.join(runtimeRoot, 'operator-stage');
  const source = {
    files: {
      '/': path.join(stage, 'index.html'), '/stage.css': path.join(stage, 'stage.css'), '/stage.js': path.join(stage, 'stage.js'),
      '/vendor/aura-rig.mjs': path.join(runtimeRoot, 'src/lib/auraRigLightform.mjs'),
      '/vendor/workspace-actions.mjs': path.join(runtimeRoot, 'src/lib/workspaceActions.mjs'),
      '/vendor/speech-parts.mjs': path.join(runtimeRoot, 'src/lib/speechParts.mjs'),
    },
    threeRoots: {
      '/vendor/three/build/': path.join(runtimeRoot, 'node_modules/three/build'),
      '/vendor/three/addons/': path.join(runtimeRoot, 'node_modules/three/examples/jsm'),
    },
  };
  const built = path.join(runtimeRoot, 'dist', 'operator-stage');
  const release = {
    files: {
      '/': path.join(built, 'index.html'), '/stage.css': path.join(built, 'stage.css'), '/stage.js': path.join(built, 'stage.js'),
      '/vendor/aura-rig.mjs': path.join(built, 'vendor/aura-rig.mjs'),
      '/vendor/workspace-actions.mjs': path.join(built, 'vendor/workspace-actions.mjs'),
      '/vendor/speech-parts.mjs': path.join(built, 'vendor/speech-parts.mjs'),
    },
    threeRoots: {
      '/vendor/three/build/': path.join(built, 'vendor/three/build'),
      '/vendor/three/addons/': path.join(built, 'vendor/three/addons'),
    },
  };
  const complete = l => Object.values(l.files).every(f => fs.existsSync(f)) && fs.existsSync(path.join(l.threeRoots['/vendor/three/build/'], 'three.module.js'));
  return complete(source) ? { ...source, kind: 'source' } : complete(release) ? { ...release, kind: 'release' } : null;
}

/** @param {string} runtimeRoot the runtime release folder */
export function operatorStageAssets(runtimeRoot) {
  const found = layout(runtimeRoot);
  return {
    /** Which layout is served: 'source', 'release', or null (then the runtime keeps the IDE at /). */
    kind: found?.kind || null,
    available: () => Boolean(found),
    /** @param {string} pathname @returns {{ file: string, type: string } | null} */
    resolve(pathname) {
      if (!found) return null;
      const known = found.files[pathname];
      if (known) return { file: known, type: TYPES[path.extname(known)] || JS };
      for (const [prefix, root] of Object.entries(found.threeRoots)) {
        if (!pathname.startsWith(prefix) || !pathname.endsWith('.js')) continue;
        const full = path.resolve(root, '.' + pathname.slice(prefix.length - 1));
        if (full.startsWith(root + path.sep) && fs.existsSync(full)) return { file: full, type: JS };
      }
      return null;
    },
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
  };
}
