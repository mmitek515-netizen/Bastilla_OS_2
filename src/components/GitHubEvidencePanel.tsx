import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, Github, RefreshCw } from 'lucide-react';

interface EvidenceItem {
  number?: number;
  id?: number;
  title?: string;
  name?: string;
  state?: string;
  status?: string;
  conclusion?: string | null;
  url: string | null;
  updatedAt?: string;
  mergedAt?: string | null;
  headSha?: string | null;
  assignees?: string[];
}

interface GitHubEvidence {
  repository: string;
  source: string;
  fetchedAt: string;
  agents: { name: string; processStatus: 'unverified' }[];
  issues: EvidenceItem[];
  pulls: EvidenceItem[];
  actions: EvidenceItem[];
  note: string;
}

const formatDate = (date?: string) => date ? new Date(date).toLocaleString('pl-PL') : '—';
const authorizationPrefix = ['Be', 'arer '].join('');

export const GitHubEvidencePanel: React.FC = () => {
  const [accessToken, setAccessToken] = useState('');
  const [evidence, setEvidence] = useState<GitHubEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const activeRequest = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken.trim() || activeRequest.current) return;
    activeRequest.current = true;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/github/agents/evidence', {
        cache: 'no-store',
        headers: { Authorization: authorizationPrefix + accessToken.trim() },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Błąd odczytu GitHub (HTTP ${response.status}).`);
      setEvidence(data as GitHubEvidence);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie można pobrać danych GitHub.');
    } finally {
      activeRequest.current = false;
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken.trim()) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [accessToken, refresh]);

  return (
    <div className="min-h-full flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 md:p-6">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Github aria-hidden="true" className="h-7 w-7 shrink-0 text-cyan-300" />
              <div>
                <h1 className="text-lg font-bold">GitHub — dowody pracy i status agentów</h1>
                <p className="text-xs text-slate-400">Issues, pull requesty i uruchomienia Actions z repozytorium.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={!accessToken.trim() || loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-700 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Odświeżanie…' : 'Odśwież'}
            </button>
          </div>
          <label className="mt-4 block text-xs text-slate-300" htmlFor="github-dashboard-token">
            Token dostępu do panelu (nie token GitHub)
          </label>
          <input
            id="github-dashboard-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={accessToken}
            onChange={event => setAccessToken(event.target.value)}
            placeholder="Wprowadź token skonfigurowany na serwerze"
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
          <p className="mt-1 text-[11px] text-slate-500">Token panelu pozostaje w pamięci tej karty. Token GitHub jest używany wyłącznie po stronie serwera.</p>
          {error && (
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-rose-300">
              <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </section>

        {evidence && (
          <>
            <section className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-amber-200">Stan procesów BastillaOS</h2>
                <span className="text-xs text-slate-400">niezależny od danych GitHub</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {evidence.agents.map(agent => (
                  <div key={agent.name} className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                    <div className="font-medium">{agent.name}</div>
                    <div className="mt-1 text-xs text-amber-300">niezweryfikowany</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">{evidence.note}</p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Dane GitHub</h2>
                <span className="text-xs text-slate-400">Odczyt: {formatDate(evidence.fetchedAt)}</span>
              </div>
              <a href={evidence.source} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1 break-all text-xs text-cyan-300 hover:underline">
                {evidence.repository} <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
              </a>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <EvidenceList title="Issues" items={evidence.issues} kind="issue" />
              <EvidenceList title="Pull requesty" items={evidence.pulls} kind="pull" />
              <div className="lg:col-span-2">
                <EvidenceList title="GitHub Actions / CI" items={evidence.actions} kind="action" />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

function EvidenceList({ title, items, kind }: { title: string; items: EvidenceItem[]; kind: 'issue' | 'pull' | 'action' }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="font-semibold">{title} <span className="text-xs font-normal text-slate-400">({items.length})</span></h2>
      {items.length ? (
        <ul className="mt-3 divide-y divide-slate-800">
          {items.map(item => (
            <li key={item.id ?? item.number} className="min-w-0 py-3 first:pt-0 last:pb-0">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="break-words text-sm text-cyan-200 hover:underline">
                  {kind === 'issue' || kind === 'pull' ? `#${item.number} ` : ''}{item.title || item.name || 'GitHub Actions'}
                  <ExternalLink aria-hidden="true" className="ml-1 inline h-3 w-3" />
                </a>
              ) : (
                <span className="break-words text-sm">{item.title || item.name || 'GitHub Actions'}</span>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                <span>{kind === 'action' ? [item.status, item.conclusion].filter(Boolean).join(' · ') || 'stan nieznany' : item.mergedAt ? 'scalony' : item.state || 'stan nieznany'}</span>
                {item.headSha && <span className="break-all">commit {item.headSha}</span>}
                {item.updatedAt && <span>aktualizacja {formatDate(item.updatedAt)}</span>}
                {!!item.assignees?.length && <span>przypisani: {item.assignees.join(', ')}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-slate-400">Brak danych.</p>}
    </section>
  );
}
