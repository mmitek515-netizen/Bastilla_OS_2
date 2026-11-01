#!/usr/bin/env node
// Read-only local sync inventory. No git push, database mutation or deployment.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const checks = [
  ['server', 'server.ts'],
  ['chat', 'src/components/AgentCommsView.tsx'],
  ['apps', 'apps'],
  ['projects', 'projects'],
  ['exports', 'exports'],
  ['database', 'data'],
  ['git', '.git'],
  ['global-sync', 'src/lib/globalSync.ts'],
];
const results = checks.map(([name, relativePath]) => {
  const target = resolve(root, relativePath);
  const exists = existsSync(target);
  const type = exists ? statSync(target).isDirectory() ? 'directory' : 'file' : null;
  return { name, path: relativePath, state: exists ? 'present' : 'missing', type };
});
const report = {
  command: 'sync:status',
  timestamp: new Date().toISOString(),
  scope: 'local-filesystem-read-only',
  results,
  externalSync: {
    github: 'not-verified',
    aiStudio: 'not-verified',
    codespaces: 'not-verified',
    production: 'not-verified',
  },
  warning: 'This command inventories local paths; it does not synchronize applications, files, databases or remote services.',
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
