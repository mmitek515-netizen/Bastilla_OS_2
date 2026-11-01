/** Exact operator command recognition. Never interpret ordinary prose as a sync request. */
export function isSyncCommand(message: string): boolean {
  const normalized = message.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL');
  return /^(?:\/sync|sync|synchronizuj|synchronizuj całą aplikację|synchronizuj cala aplikacje)[.!]?$/.test(normalized);
}
