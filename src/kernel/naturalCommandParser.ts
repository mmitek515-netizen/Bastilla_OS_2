import { parseChatApprovalCommand, type ChatApprovalAction } from './chatApprovals.ts';

export type NaturalCommand =
  | { type: 'read'; operation: 'system-status' | 'list-apps' }
  | { type: 'propose'; action: ChatApprovalAction };

function normalizeCommand(message: string): string {
  return message
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (character) => ({
      ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
    })[character] || character)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNaturalCommand(message: string): NaturalCommand | null {
  const command = normalizeCommand(message);
  if (!command || command.length > 200) return null;

  if (/^(?:(?:pokaz|wyswietl|podaj|show|get|check)(?:\s+(?:mi|me))?\s+)?(?:(?:the\s+)?(?:system|server)\s+status|(?:status|stan)(?:\s+(?:systemu|system|serwera|server))?)$/.test(command) ||
      /^(?:jaki jest|jaka jest|what is)\s+(?:the\s+)?(?:status|stan)(?:\s+(?:systemu|system|serwera|server))?$/.test(command) ||
      /^what is (?:the )?(?:system|server) status$/.test(command)) {
    return { type: 'read', operation: 'system-status' };
  }

  if (/^(?:(?:pokaz|wyswietl|show|list)(?:\s+(?:mi|me))?\s+)?(?:(?:installed|zainstalowane)\s+)?(?:(?:liste|lista)\s+)?(?:aplikacje|aplikacji|apps|applications)(?:\s+(?:w systemie|installed))?$/.test(command)) {
    return { type: 'read', operation: 'list-apps' };
  }

  const createApp = command.match(/^(?:utworz|stworz|create|make)\s+(?:(?:mi|me)\s+)?(?:(?:a|an|new|nowa|nowy|nowe)\s+)*(?:aplikacje|aplikacja|app|application)\s+(?:(?:o nazwie|named|called)\s+)?([a-z0-9][a-z0-9_-]{0,31})(?:\s+(?:typu|type)\s+([a-z0-9-]+))?$/);
  if (createApp) {
    const parsed = parseChatApprovalCommand(`/propose create-app ${createApp[1]}${createApp[2] ? ` ${createApp[2]}` : ''}`);
    return parsed?.type === 'propose' ? parsed : null;
  }

  const createDatabase = command.match(/^(?:utworz|stworz|create|make)\s+(?:(?:mi|me)\s+)?(?:(?:a|an|new|nowa|nowy|nowe)\s+)*(?:baze danych|database|db)\s+(?:(?:o nazwie|named|called)\s+)?([a-z0-9][a-z0-9_-]{0,47})$/);
  if (createDatabase) {
    const parsed = parseChatApprovalCommand(`/propose create-db ${createDatabase[1]}`);
    return parsed?.type === 'propose' ? parsed : null;
  }

  const launch = command.match(/^(?:uruchom|otworz|launch|open)\s+(?:(?:podglad|preview)(?:\s+(?:for|dla))?\s+)?(?:aplikacje|aplikacja|aplikacji|app|application)\s+([a-z0-9][a-z0-9_-]{0,31})$/);
  if (launch) {
    const parsed = parseChatApprovalCommand(`/propose launch ${launch[1]}`);
    return parsed?.type === 'propose' ? parsed : null;
  }

  return null;
}
