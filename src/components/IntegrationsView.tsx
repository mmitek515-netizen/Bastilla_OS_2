import React, { useEffect, useState } from 'react';

type Service = { name: string; status: 'potwierdzone' | 'wymaga konfiguracji' | 'dostępne opcjonalnie'; details: string; url?: string };
type McpDiagnostics = {
  publicUrl: string | null;
  publicUrlConfigured: boolean;
  legacyBearerConfigured: boolean;
  serverAvailable: boolean;
  handshakeOk: boolean;
  error: string | null;
  chatGptConnected: null;
  externalConnectionVerified: false;
};
const services: Service[] = [
  { name:'GitHub (ChatGPT)', status:'potwierdzone', details:'Połączenie ChatGPT z repozytorium BastillaOS zostało zweryfikowane. Nie oznacza to automatycznego połączenia kont w BastillaOS.' },
  { name:'Ollama (BastillaOS)', status:'wymaga konfiguracji', details:'Aplikacja zawiera obsługę lokalnych modeli; stan działającego serwera należy sprawdzić w diagnostyce.' },
  { name:'Google AI Studio / Gemini', status:'wymaga konfiguracji', details:'Projekt ma komponenty Gemini; połączenie produkcyjne i klucze należy zweryfikować na serwerze.' },
  { name:'ChatGPT / OpenAI API', status:'wymaga konfiguracji', details:'Wymaga osobnej konfiguracji API lub MCP. Subskrypcja ChatGPT nie zapewnia automatycznie kredytów API.' },
  { name:'Google Zdjęcia', status:'wymaga konfiguracji', details:'Import ręczny jest dostępny w module Zdjęcia i notatki. Bezpośredni Picker wymaga OAuth i backendu.', url:'https://photos.google.com/' },
  { name:'Samsung Notes', status:'wymaga konfiguracji', details:'Obsługiwany jest wybór wyeksportowanych plików PDF/TXT. Brak potwierdzonego publicznego API synchronizacji.' },
  { name:'Google Drive / Dokumenty / Arkusze / Prezentacje', status:'dostępne opcjonalnie', details:'Dostępny konektor ChatGPT, wymaga osobnego podłączenia; BastillaOS wymaga własnej integracji.', url:'https://chatgpt.com/plugins' },
  { name:'Gmail', status:'dostępne opcjonalnie', details:'Konektor ChatGPT dostępny do podłączenia.', url:'https://chatgpt.com/plugins' },
  { name:'Google Calendar', status:'dostępne opcjonalnie', details:'Konektor ChatGPT dostępny do podłączenia.', url:'https://chatgpt.com/plugins' },
  { name:'Google Contacts', status:'dostępne opcjonalnie', details:'Konektor ChatGPT dostępny do podłączenia.', url:'https://chatgpt.com/plugins' },
  { name:'Outlook Calendar / iCloud Calendar', status:'dostępne opcjonalnie', details:'Konektory dostępne w katalogu ChatGPT.', url:'https://chatgpt.com/plugins' },
  { name:'Todoist / TickTick', status:'dostępne opcjonalnie', details:'Aplikacje z katalogu ChatGPT do zadań i przypomnień.', url:'https://chatgpt.com/plugins' },
  { name:'Windsor.ai / narzędzia marketingowe', status:'dostępne opcjonalnie', details:'Zewnętrzne źródła danych po osobnym podłączeniu.', url:'https://chatgpt.com/plugins' },
];

export function IntegrationsView({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const [mcp, setMcp] = useState<McpDiagnostics | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  const refreshMcp = async () => {
    setMcpLoading(true);
    setMcpError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/mcp/setup', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMcp(await response.json());
    } catch {
      setMcpError('Nie udało się odczytać diagnostyki MCP. Sprawdź dostępność API Bastilla OS 2.');
    } finally {
      clearTimeout(timeout);
      setMcpLoading(false);
    }
  };

  const copyMcpUrl = async () => {
    if (!mcp?.publicUrl) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(mcp.publicUrl);
      setCopiedMcp(true);
    } catch {
      setMcpError('Nie można skopiować adresu. Skopiuj go ręcznie.');
    }
  };

  useEffect(() => {
    void refreshMcp();
  }, []);

  const statusLabel = (value: boolean | null, yes: string, no: string) =>
    value === null ? 'Niezweryfikowane' : value ? yes : no;

  return <section className="min-h-0 flex-1 overflow-y-auto bg-[#050b18] p-4 text-slate-100">
    <h1 className="text-xl font-semibold text-cyan-200">Integracje BastillaOS</h1>
    <p className="my-3 text-sm text-slate-400">Katalog możliwości i stanów zweryfikowanych podczas konfiguracji. Połączenia ChatGPT nie są automatycznie połączeniami BastillaOS. Lista możliwych aplikacji nie jest wyczerpująca.</p>
    <button type="button" onClick={onOpenLibrary} className="mb-5 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">Otwórz Zdjęcia i notatki</button>
    <article className="mb-5 rounded-xl border border-cyan-800/70 bg-slate-900/90 p-4" aria-labelledby="mcp-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="mcp-title" className="font-semibold text-cyan-200">Diagnostyka MCP</h2>
          <p className="mt-1 text-xs text-slate-400">Sprawdza skonfigurowany adres i lokalny most Streamable HTTP. Nie wykrywa zdalnego klienta ChatGPT.</p>
        </div>
        <button type="button" onClick={() => void refreshMcp()} disabled={mcpLoading} className="rounded-lg border border-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50">
          {mcpLoading ? 'Sprawdzanie…' : 'Sprawdź ponownie'}
        </button>
      </div>
      {mcpError && <p className="mt-3 text-sm text-rose-300" role="alert">{mcpError}</p>}
      <dl aria-live="polite" className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Publiczny HTTPS MCP skonfigurowany</dt>
          <dd className="mt-1 font-medium">{mcp ? statusLabel(mcp.publicUrlConfigured, 'Tak', 'Nie') : 'Oczekiwanie na diagnostykę'}</dd>
        </div>
        <div className="rounded-lg bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Lokalny most dostępny</dt>
          <dd className="mt-1 font-medium">{mcp ? statusLabel(mcp.serverAvailable, 'Tak', 'Nie') : 'Oczekiwanie na diagnostykę'}</dd>
        </div>
        <div className="rounded-lg bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">MCP initialize / ping / tools/list</dt>
          <dd className="mt-1 font-medium">{mcp ? statusLabel(mcp.handshakeOk, 'OK', 'Niepowodzenie') : 'Oczekiwanie na diagnostykę'}</dd>
        </div>
        <div className="rounded-lg bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Klient ChatGPT podłączony</dt>
          <dd className="mt-1 font-medium">{mcp ? statusLabel(mcp.chatGptConnected, 'Tak', 'Nie') : 'Niezweryfikowane'}</dd>
        </div>
        <div className="rounded-lg bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Uwierzytelnienie publicznego ingressu</dt>
          <dd className="mt-1 font-medium">Niezweryfikowane</dd>
        </div>
      </dl>
      {mcp?.publicUrl && <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="block min-w-0 flex-1 break-all rounded bg-slate-950 px-2 py-1 text-xs text-cyan-200">{mcp.publicUrl}</code>
        <button type="button" onClick={() => void copyMcpUrl()} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200">{copiedMcp ? 'Skopiowano' : 'Kopiuj URL'}</button>
      </div>}
      {mcp?.error && <p className="mt-3 text-sm text-amber-200" role="status">{mcp.error}</p>}
      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        Konfiguracja na telefonie: ustaw publiczny adres HTTPS `/mcp` oraz uwierzytelniony ingress po stronie hostingu, uruchom most na serwerze i użyj adresu w ustawieniach konektorów MCP ChatGPT. Nie publikuj portów 3000/8000 bez ochrony. Test lokalny nie potwierdza autoryzacji ani połączenia ChatGPT; wykonaj osobny test w kliencie.
      </p>
      {mcp?.legacyBearerConfigured && <p className="mt-2 text-xs text-slate-500">Uwierzytelnienie starego endpointu Express skonfigurowane (wartość sekretu nie jest wyświetlana).</p>}
    </article>
    <div className="grid gap-3 md:grid-cols-2">
      {services.map(service => <article key={service.name} className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{service.name}</h2>
          <span className="rounded bg-slate-800 px-2 py-1 text-xs text-cyan-200">{service.status}</span>
        </div>
        <p className="mt-2 text-sm text-slate-400">{service.details}</p>
        {service.url && <a href={service.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-cyan-300 underline">Otwórz usługę</a>}
      </article>)}
    </div>
    <p className="mt-5 text-xs text-slate-500">Żadne konto nie jest autoryzowane przez samo otwarcie tej zakładki. Uprawnienia OAuth należy nadawać w oficjalnym oknie dostawcy.</p>
  </section>;
}
