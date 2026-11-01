import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('only the Bastilla OS 2 standalone app is registered', () => {
  const app = JSON.parse(readFileSync(path.join(repoRoot, 'apps/bastilla_os_2/app.json'), 'utf8'));

  assert.equal(app.id, 'bastilla_os_2');
  assert.equal(app.name, 'Bastilla OS 2');
  assert.equal(app.version, '2.0.0');
  assert.equal(existsSync(path.join(repoRoot, 'apps/bastillaos/app.json')), false);
  assert.equal(existsSync(path.join(repoRoot, 'apps/bastillaos/index.html')), false);
});

test('root and AI Studio metadata identify Bastilla OS 2', () => {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const metadata = JSON.parse(readFileSync(path.join(repoRoot, 'metadata.json'), 'utf8'));
  const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const entrypoint = readFileSync(path.join(repoRoot, 'src/main.tsx'), 'utf8');

  assert.match(packageJson.description, /Bastilla OS 2/);
  assert.equal(metadata.name, 'Bastilla OS 2');
  assert.match(html, /<title>Bastilla OS 2<\/title>/);
  assert.match(entrypoint, /import \{ BastillaOS2View \} from '\.\/components\/BastillaOS2View'/);
  assert.match(entrypoint, /render\(<BastillaOS2View \/>/);
  assert.doesNotMatch(entrypoint, /from '\.\/App\.tsx'/);
});
