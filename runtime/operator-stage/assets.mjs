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
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': JS, '.mjs': JS, '.bin':'application/octet-stream','.md':'text/plain; charset=utf-8','':'text/plain; charset=utf-8' };
export const AURA_STAGE_FILES=Object.freeze({
  "vendor/auraSpeechTimeline.mjs": "src/lib/auraSpeechTimeline.mjs",
  "vendor/auraSpeechAnalysis.mjs": "src/lib/auraSpeechAnalysis.mjs",
  "vendor/auraSpeechWorker.mjs": "src/lib/auraSpeechWorker.mjs",
  "vendor/auraSpeechClassifier.mjs": "src/lib/auraSpeechClassifier.mjs",
  "vendor/auraBodyMotion.mjs": "src/lib/auraBodyMotion.mjs",
  "vendor/auraBodyRig.mjs": "src/lib/auraBodyRig.mjs",
  "vendor/auraHumanBehavior.mjs": "src/lib/auraHumanBehavior.mjs",
  "vendor/auraPerformance.mjs": "src/lib/auraPerformance.mjs",
  "vendor/speechParts.mjs": "src/lib/speechParts.mjs",
  "vendor/workspaceActions.mjs": "src/lib/workspaceActions.mjs",
  "vendor/auraOptics.mjs": "src/lib/auraOptics.mjs",
  "vendor/auraV31OpticalRig.mjs": "src/lib/auraV31OpticalRig.mjs",
  "vendor/auraSurfaceDetail.mjs": "src/lib/auraSurfaceDetail.mjs",
  "vendor/auraSecondaryMotion.mjs": "src/lib/auraSecondaryMotion.mjs",
  "vendor/auraSecondaryRig.mjs": "src/lib/auraSecondaryRig.mjs",
  "vendor/auraStudioFloor.mjs": "src/lib/auraStudioFloor.mjs",
  "vendor/vendor/headaudio/LICENSE": "src/lib/vendor/headaudio/LICENSE",
  "vendor/vendor/headaudio/NOTICE.md": "src/lib/vendor/headaudio/NOTICE.md",
  "vendor/vendor/headaudio/classifier.mjs": "src/lib/vendor/headaudio/classifier.mjs",
  "vendor/vendor/headaudio/mfcc.mjs": "src/lib/vendor/headaudio/mfcc.mjs",
  "vendor/vendor/headaudio/model-en-mixed.bin": "src/lib/vendor/headaudio/model-en-mixed.bin",
  "vendor/vendor/headaudio/parameters.mjs": "src/lib/vendor/headaudio/parameters.mjs",
  "vendor/vendor/headaudio/processor.mjs": "src/lib/vendor/headaudio/processor.mjs",
  "vendor/vendor/headaudio/ringbuffer.mjs": "src/lib/vendor/headaudio/ringbuffer.mjs",
  "vendor/vendor/headaudio/training.mjs": "src/lib/vendor/headaudio/training.mjs",
  "vendor/vendor/headaudio/vadgate.mjs": "src/lib/vendor/headaudio/vadgate.mjs"
});

function layout(runtimeRoot) {
  const stage = path.join(runtimeRoot, 'operator-stage');
  const source = {
    files: {
      '/': path.join(stage, 'index.html'), '/stage.css': path.join(stage, 'stage.css'), '/stage.js': path.join(stage, 'stage.js'),
      '/setup.js': path.join(stage, 'setup.js'), '/setup-steps.mjs': path.join(stage, 'setupSteps.mjs'),
      '/vendor/aura-rig.mjs': path.join(runtimeRoot, 'src/lib/auraRigLightform.mjs'),
      '/vendor/workspace-actions.mjs': path.join(runtimeRoot, 'src/lib/workspaceActions.mjs'),
      '/vendor/speech-parts.mjs': path.join(runtimeRoot, 'src/lib/speechParts.mjs'),
      ...Object.fromEntries(Object.entries(AURA_STAGE_FILES).map(([target,source])=>['/'+target,path.join(runtimeRoot,source)])),
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
      '/setup.js': path.join(built, 'setup.js'), '/setup-steps.mjs': path.join(built, 'setup-steps.mjs'),
      '/vendor/aura-rig.mjs': path.join(built, 'vendor/aura-rig.mjs'),
      '/vendor/workspace-actions.mjs': path.join(built, 'vendor/workspace-actions.mjs'),
      '/vendor/speech-parts.mjs': path.join(built, 'vendor/speech-parts.mjs'),
      ...Object.fromEntries(Object.keys(AURA_STAGE_FILES).map(target=>['/'+target,path.join(built,target)])),
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
