import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import {
  AGENT_STATUS_LABELS,
  AGENT_STATUS_NAMES,
  AGENT_STATUS_STALE_AFTER_MS,
  isAgentStatusResponse,
} from '../lib/agentStatusContract.mjs';

type AgentName = typeof AGENT_STATUS_NAMES[number];
type AgentState = keyof typeof AGENT_STATUS_LABELS;
type AgentEvidence = {
  source: string;
  taskId: string;
  taskStatus: string;
  runtime?: string;
};
type AgentStatus = {
  status: AgentState;
  lastEventAt: string | null;
  observedAt: string;
  evidence: AgentEvidence | null;
};
type StatusResponse = {
  success: true;
  schemaVersion: number;
  observedAt: string;
  staleAfterMs: number;
  agents: Record<AgentName, AgentStatus>;
  note: string;
};

const stateStyles: Record<AgentState, string> = {
  active: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200',
  waiting: 'border-sky-500/40 bg-sky-950/30 text-sky-200',
  blocked: 'border-amber-500/40 bg-amber-950/30 text-amber-200',
  error: 'border-rose-500/40 bg-rose-950/30 text-rose-200',
  unverified: 'border-slate-600 bg-slate-900 text-slate-300',
};

function formatTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Brak potwierdzonego zdarzenia';
  return new Date(value).toLocaleString('pl-PL');
}

export function BackgroundAgentsStatus() {
  const [tokenInput, setTokenInput] = useState('');
  const [credential, setCredential] = useState('');
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!credential || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch('/api/agents/status', {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + credential },
      });
      if (!response.ok) throw new Error(`Błąd API (HTTP ${response.status})`);
      const result = await response.json() as StatusResponse;
      if (!isAgentStatusResponse(result)) {
        throw new Error('Nieprawidłowa odpowiedź API');
      }
      setData(result);
      setError(null);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Błąd API');
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [credential]);

  useEffect(() => {
    if (!credential) return;
    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
      request.current?.abort();
      request.current = null;
    };
  }, [credential, refresh]);

  const expired = !data
    || !Number.isFinite(Date.parse(data.observedAt))
    || Date.now() - Date.parse(data.observedAt) > (data.staleAfterMs || AGENT_STATUS_STALE_AFTER_MS);

  const connect = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = tokenInput.trim();
    if (!value) return;
    request.current?.abort();
    request.current = null;
    setData(null);
    setError(null);
    setCredential(value);
  };

  const clearCredential = () => {
    request.current?.abort();
    request.current = null;
    setCredential('');
    setTokenInput('');
    setData(null);
    setError(null);
    setLoading(false);
  };

  return (
    <section aria-label="Rzeczywisty status agentów" className="space-y-3 rounded-xl border border-cyan-800/40 bg-slate-950/80 p-4 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-cyan-100">Status agentów</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400" role="status">
            {!credential ? 'Wymagane uwierzytelnienie' : error || (expired ? 'Dane wygasły lub brak pomiaru' : `Pomiar: ${formatTime(data?.observedAt)}`)}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!credential || loading}
            aria-label="Odśwież status agentów"
            className="rounded-md border border-cyan-700/50 p-2 text-cyan-200 hover:bg-cyan-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <form onSubmit={connect} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="agent-status-token" className="sr-only">Token odczytu statusu agentów</label>
        <input
          id="agent-status-token"
          type="password"
          value={tokenInput}
          onChange={(event) => setTokenInput(event.target.value)}
          autoComplete="off"
          placeholder="Token skonfigurowany na serwerze"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <button type="submit" disabled={!tokenInput.trim()} className="rounded-md border border-cyan-700/50 px-3 py-2 text-sm text-cyan-100 disabled:opacity-40">
          Wczytaj status
        </button>
        {credential && (
          <button type="button" onClick={clearCredential} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300">
            Wyczyść
          </button>
        )}
      </form>

      {error && <p role="alert" className="text-sm text-rose-300">{error}; status bez aktualnego potwierdzenia jest niezweryfikowany.</p>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {AGENT_STATUS_NAMES.map((name) => {
          const agent = data?.agents?.[name];
          const expiredStatus = expired || !agent;
          const status: AgentState = expiredStatus ? 'unverified' : agent.status;
          const evidence = expiredStatus ? null : agent.evidence;
          return (
            <article key={name} className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{name}</h3>
                <span className={`rounded-full border px-2 py-1 text-xs ${stateStyles[status]}`}>
                  {AGENT_STATUS_LABELS[status]}
                </span>
              </div>
              <p className="mt-2 break-words text-xs text-slate-400">
                Ostatnie zdarzenie: {formatTime(agent?.lastEventAt)}
              </p>
              {evidence && (
                <p className="mt-1 break-words text-xs text-slate-500">
                  Dowód: {evidence.source} · {evidence.taskId}
                </p>
              )}
              {status === 'active' && evidence?.runtime && (
                <p className="mt-1 flex items-center gap-1 text-xs text-emerald-300">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  Potwierdzony executor zadania
                </p>
              )}
            </article>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Status wymaga tokenu serwerowego. Aktywność jest potwierdzana wyłącznie przez działający executor; brak danych, stare wpisy i profile nie oznaczają pracy agenta.
      </p>
    </section>
  );
}
