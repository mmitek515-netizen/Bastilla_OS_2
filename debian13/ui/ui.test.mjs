import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AGENT_PROFILES,
  getInitialAgentStatuses,
  getUnavailableActionMessage,
} from './app.mjs';

const uiDirectory = new URL('./', import.meta.url);
const readUiFile = (name) => readFile(new URL(name, uiDirectory), 'utf8');

test('exposes four uniquely named profiles without claiming they are running', () => {
  const statuses = getInitialAgentStatuses();
  assert.deepEqual(statuses.map(({ id }) => id), ['aria', 'astyria', 'aurelius', 'alex']);
  assert.equal(new Set(statuses.map(({ name }) => name)).size, 4);
  assert.ok(statuses.every(({ status, statusLabel }) =>
    status === 'unknown' && statusLabel === 'Niepodłączony'));
  assert.equal(AGENT_PROFILES.length, 4);
});

test('reports chat and terminal drafts as not executed without a runtime', () => {
  assert.match(getUnavailableActionMessage('chat'), /nie została wysłana/);
  assert.match(getUnavailableActionMessage('terminal'), /nie zostało wykonane/);
});

test('provides responsive, accessible mobile UI and labels non-connected state', async () => {
  const [html, css, app] = await Promise.all([
    readUiFile('index.html'),
    readUiFile('styles.css'),
    readUiFile('app.mjs'),
  ]);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /aria-labelledby="agents-title"/);
  assert.match(html, /id="chat-message"/);
  assert.match(html, /id="terminal-command"/);
  assert.match(html, /Runtime niepodłączony/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
});
