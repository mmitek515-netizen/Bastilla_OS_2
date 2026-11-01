import React, { useEffect, useState } from 'react';

type OllamaModel = { name?: string; model?: string; size?: number; modified_at?: string; details?: { parameter_size?: string; quantization_level?: string } };
type Inventory = { models: OllamaModel[]; configuredModel: string; configured?: boolean; connected: boolean; error?: string };
type Verification = { configured: boolean; connected: boolean; verified: boolean; error: string | null };
const formatSize = (bytes?: number) => typeof bytes === 'number' ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : '—';

export function OllamaModelManager() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const refresh = async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/ollama/models', { cache: 'no-store', signal });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Serwer proxy zwrócił odpowiedź niebędącą formatem JSON. Ollama jest offline lub nieuruchomiona.');
      }
      const data = await response.json() as Inventory;
      setInventory(data);
      if (data.connected === false && data.error) {
        setError(data.error);
      } else {
        setError('');
      }
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Błąd połączenia z Ollama');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, []);
  const verifyInference = async () => {
    setVerifying(true);
    try {
      const response = await fetch('/api/ollama/diagnostics', { cache: 'no-store' });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Diagnostyka zwróciła odpowiedź niebędącą formatem JSON.');
      }
      if (!response.ok) throw new Error(`Diagnostyka zwróciła HTTP ${response.status}.`);
      const result = await response.json() as Verification;
      setVerification(result);
    } catch (cause) {
      setVerification({
        configured: inventory?.configured ?? false,
        connected: false,
        verified: false,
        error: cause instanceof Error ? cause.message : 'Nie udało się zweryfikować inferencji.',
      });
    } finally {
      setVerifying(false);
    }
  };
  return (
    <section aria-label="Menedżer modeli Ollama" className="space-y-3 rounded-xl border border-cyan-800/40 bg-slate-950/80 p-4 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-cyan-100">Menedżer modeli Ollama</h2>
        <button type="button" onClick={() => { setLoading(true); void refresh(); }} className="rounded-md border border-cyan-700 px-3 py-1.5 text-xs hover:bg-cyan-900/30">Odśwież listę</button>
        <button type="button" onClick={() => { void verifyInference(); }} disabled={verifying} className="rounded-md border border-cyan-700 px-3 py-1.5 text-xs hover:bg-cyan-900/30 disabled:opacity-50">
          {verifying ? 'Testowanie modelu…' : 'Zweryfikuj inferencję'}
        </button>
      </div>
      <p className="text-xs text-slate-400">Model skonfigurowany: <strong className="text-cyan-200">{inventory?.configuredModel ?? 'Sprawdzanie…'}</strong></p>
      <p className="text-xs text-slate-400">
        Provider: {inventory ? (inventory.configured ? 'skonfigurowany' : 'nieskonfigurowany') : 'sprawdzanie…'} ·
        Ollama: {inventory?.connected ? 'połączona' : inventory ? 'offline' : 'sprawdzanie…'} ·
        Inferencja: {verification?.verified ? 'zweryfikowana' : verification ? 'niezweryfikowana' : 'nie sprawdzono'}
      </p>
      {verification?.error && <p role="status" className="text-xs text-amber-300">{verification.error}</p>}
      {loading && <p role="status" className="text-sm text-slate-400">Łączenie z Ollama…</p>}
      {error && (
        <div role="alert" className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-300">
          {error}
        </div>
      )}
      {!loading && !error && inventory?.connected && inventory?.models.length === 0 && <p className="text-sm text-slate-400">Brak zainstalowanych modeli.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {inventory?.models.map(model => (
          <div key={model.name ?? model.model} className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="break-all font-mono text-sm text-cyan-200">{model.name ?? model.model}</div>
            <div className="mt-1 text-xs text-slate-400">{formatSize(model.size)} · {model.details?.parameter_size ?? 'Parametry nieznane'} · {model.details?.quantization_level ?? 'Kwantyzacja nieznana'}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">Widok odczytuje faktycznie zainstalowane modele. Pobieranie, przełączanie i usuwanie modeli wymaga dodatkowych zabezpieczonych operacji serwera.</p>
    </section>
  );
}
