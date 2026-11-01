import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

test('the integrated app starts on the v2 workspace and keeps core modules in the app shell', () => {
  const entrypoint = read('src/main.tsx');
  const html = read('index.html');
  const app = read('src/App.tsx');
  const navigation = read('src/components/Navigation.tsx');

  assert.match(entrypoint, /import App from '\.\/App\.tsx'/);
  assert.match(html, /<title>Bastilla OS 2<\/title>/);
  assert.match(app, /activeTab === 'bastilla_os_2'/);
  assert.match(app, /activeTab === 'comms'/);
  assert.match(app, /activeTab === 'terminal'/);
  assert.match(navigation, /: 'bastilla_os_2'/);
  assert.match(navigation, /bastilla_os_2: 'Zadania'/);
});

test('the v2 workspace keeps task operations and uses the mobile-ready dark interface', () => {
  const view = read('src/components/BastillaOS2View.tsx');
  const styles = read('src/index.css');

  assert.match(view, /\/api\/agent-tasks\/run/);
  assert.match(view, /\/api\/agent-tasks\/cancel/);
  assert.match(view, /NEXUS · 02/);
  assert.match(view, /flex min-h-0 flex-1 flex-col overflow-y-auto/);
  assert.match(styles, /\.bastilla-v2 \{/);
  assert.match(styles, /@media \(max-width: 639px\)/);
});
