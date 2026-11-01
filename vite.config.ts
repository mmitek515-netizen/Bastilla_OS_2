import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';
import {createBuildMetadata} from './src/lib/buildMetadata.mjs';

const packageMetadata = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {version: string};
let sourceRevision = '';
let isDirty = true;

try {
  sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  isDirty = Boolean(execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim());
} catch {
  sourceRevision = '';
  isDirty = true;
}

const buildMetadata = createBuildMetadata(packageMetadata.version, sourceRevision, isDirty);

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(buildMetadata.version),
      'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(buildMetadata.commit),
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
