/** Global Sync: typed metadata-only event envelope. No secrets or file contents. */
export const SYNC_DOMAINS = [
  'chat', 'agents', 'tasks', 'apps', 'projects', 'files', 'databases',
  'dashboards', 'incidents', 'services', 'github', 'integrations',
] as const;

export type SyncDomain = typeof SYNC_DOMAINS[number];
export type SyncPhase = 'queued' | 'saved' | 'syncing' | 'confirmed' | 'failed' | 'conflict';
export type SyncTarget = 'backend' | 'preview' | 'github' | 'ai-studio' | 'codespaces';

export interface SyncEvent {
  readonly id: string;
  readonly domain: SyncDomain;
  readonly resourceId: string;
  readonly projectId?: string;
  readonly revision: number;
  readonly phase: SyncPhase;
  readonly target: SyncTarget;
  readonly timestamp: string;
}

/**
 * In-memory event transport for process-local subscribers only.
 * Not a durable outbox, cross-instance synchronization, or delivery confirmation.
 * Call publish only after the authoritative write succeeds; the caller must supply
 * the authoritative revision. Never treat local delivery as external sync success.
 */
export class LocalSyncBus {
  private listeners = new Set<(event: SyncEvent) => void>();
  private lastRevision = new Map<string, number>();
  private seenIds = new Set<string>();
  private readonly maxTrackedEvents = 2000;

  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(event: SyncEvent): boolean {
    if (!SYNC_DOMAINS.includes(event.domain) || !['queued', 'saved', 'syncing', 'confirmed', 'failed', 'conflict'].includes(event.phase) || !['backend', 'preview', 'github', 'ai-studio', 'codespaces'].includes(event.target) || !Number.isSafeInteger(event.revision) || event.revision < 1) {
      throw new Error('Invalid sync event');
    }
    if (typeof event.id !== 'string' || !event.id.trim() || typeof event.resourceId !== 'string' || !event.resourceId.trim() || (event.projectId !== undefined && typeof event.projectId !== 'string') || typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp))) {
      throw new Error('Invalid sync event metadata');
    }
    if (this.seenIds.has(event.id)) return false;
    const key = JSON.stringify([event.domain, event.projectId ?? '', event.resourceId, event.target]);
    const previous = this.lastRevision.get(key) ?? 0;
    if (event.revision < previous) return false;
    this.lastRevision.set(key, event.revision);
    this.seenIds.add(event.id);
    if (this.seenIds.size > this.maxTrackedEvents) {
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* one UI subscriber cannot block others */ }
    }
    return true;
  }
}
