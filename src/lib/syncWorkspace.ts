import path from 'node:path';

export const SYNC_ROOT_RELATIVE = 'data/bastilla-sync';
export const SYNC_FOLDERS = ['projects','apps','files','databases','chat','agents','dashboards','incidents','events','outbox','backups'] as const;

export function getSyncPaths(baseDir: string = process.cwd()) {
  const root = path.resolve(baseDir, process.env.BASTILLA_SYNC_ROOT?.trim() || SYNC_ROOT_RELATIVE);
  return { root, folders: Object.fromEntries(SYNC_FOLDERS.map(name => [name, path.join(root, name)])) };
}
