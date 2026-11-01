import React, { useEffect, useState } from 'react';

type AgentStatus = { enabled: boolean; lastCheck: string | null; status: 'unverified'; error: string | null };
type Response = { monitoring: boolean; intervalMs: number; agents: Record<string, AgentStatus>; ollama: { connected: boolean; checkedAt: string | null }; note: string };
export function BackgroundAgentsStatus() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden || disposed) return;
      try {
        const response = await fetch('/api/agents/background/status', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Błąd statusu');
        const result = await response.json() as Response;
        if (!disposed) { setData(result); setError(false); }
      } catch {
        if (!disposed && !controller.signal.aborted) setError(true);
      }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 15000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return (
    <section aria-label="Agenci AI w tle" className="space-y-3 rounded-xl border border-cyan-800/40 bg-slate-950/80 p-4 text-slate-100">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-cyan-100">Agenci AI · monitoring w tle</h2>
        <span className="text-xs text-slate-400">{error ? 'Brak danych' : 'Kontrola co 15 s'}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['Aria', 'Astyria', 'Alex', 'Aurelius'] as const).map(name => {
          const agent = data?.agents[name];
          return <div key={name} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="font-medium">{name}</div>
            <div className="text-xs text-amber-300">{error ? 'Brak danych' : agent?.status === 'unverified' ? 'Status niezweryfikowany' : 'Brak danych'}</div>
          </div>;
        })}
      </div>
      <p className="text-xs text-slate-500">
        {error ? 'Stan Ollama niedostępny.' : `Ollama: ${data?.ollama.connected ? 'połączona' : 'niedostępna'}${data?.ollama.checkedAt ? ` · pomiar ${new Date(data.ollama.checkedAt).toLocaleTimeString('pl-PL')}` : ''}.`}
        {' '}Dostępność modelu nie dowodzi działania procesu agenta.
      </p>
    </section>
  );
}
