import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {resolveBuildInfo} from './scripts/build-info.mjs';

export default defineConfig(() => {
  const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  let commitSha = '';
  let dirty = false;
  try {
    commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    commitSha = process.env.GITHUB_SHA ?? '';
  }
  try {
    dirty = Boolean(execFileSync('git', ['status', '--porcelain'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
  } catch {
    dirty = false;
  }
  const buildInfo = resolveBuildInfo(packageJson.version, commitSha, dirty);

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __BUILD_VERSION__: JSON.stringify(buildInfo.version),
      __BUILD_COMMIT__: JSON.stringify(buildInfo.commit),
      __BUILD_DIRTY__: JSON.stringify(buildInfo.dirty),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      allowedHosts: ['terminal.local'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
