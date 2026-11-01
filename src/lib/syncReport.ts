import { SYNC_DOMAINS, type SyncDomain } from './globalSync';

export type SyncCheckState = 'confirmed' | 'unavailable' | 'failed';
export interface SyncCheck { domain: SyncDomain; state: SyncCheckState; detail: string }

/** Read-only synchronization status. Never reports external writes without proof. */
export function buildSyncReport(kernelFresh: boolean): SyncCheck[] {
  return SYNC_DOMAINS.map(domain => {
    if (kernelFresh && (domain === 'chat' || domain === 'agents')) {
      return { domain, state: 'confirmed', detail: 'Odczytano aktualny stan jądra z serwera; nie potwierdza synchronizacji innych urządzeń.' };
    }
    return { domain, state: kernelFresh ? 'unavailable' : 'failed', detail: kernelFresh
      ? 'Brak potwierdzonej synchronizacji tego modułu.'
      : 'Nie udało się pobrać aktualnego stanu jądra.' };
  });
}

export function formatSyncReport(checks: SyncCheck[]): string {
  const confirmed = checks.filter(c => c.state === 'confirmed').length;
  const failed = checks.filter(c => c.state === 'failed').length;
  return [
    `SYNC — potwierdzone odczyty: ${confirmed}/${checks.length}; błędy: ${failed}; bez potwierdzenia: ${checks.length - confirmed - failed}.`,
    ...checks.map(c => `• ${c.domain}: ${c.state === 'confirmed' ? 'ODCZYT OK' : c.state === 'failed' ? 'BŁĄD' : 'NIEPOTWIERDZONE'} — ${c.detail}`),
    'Polecenie nie wykonuje automatycznego git push, migracji bazy ani wdrożenia produkcyjnego.',
  ].join('\\n');
}
