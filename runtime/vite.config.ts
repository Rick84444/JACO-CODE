import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, searchForWorkspaceRoot} from 'vite';

// Runtime worktrees share one node_modules through a junction. Vite resolves it to its real
// path, which lies outside this root, and refused to serve Monaco's CSS and fonts from there.
function sharedNodeModules(): string[] {
  try {
    const real = fs.realpathSync(path.resolve(__dirname, 'node_modules'));
    return real === path.resolve(__dirname, 'node_modules') ? [] : [real];
  } catch {
    return [];
  }
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...sharedNodeModules()] },
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Runtime state (.jaco*: ledger, backups, agent state; about 67 000 files) is data, not source.
      // Watching it kept the runtime event loop busy with file watcher setup, so every request took 15-60 s.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/.jaco/**', '**/.jaco-*/**', '**/logs/**', '**/.agent-state/**', '**/dist/**'],
      },
    },
  };
});
