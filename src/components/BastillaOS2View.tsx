import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  RotateCcw,
  ExternalLink,
  Layers,
  Terminal,
  FileCheck,
  Ban,
  HardDrive,
  Cpu,
} from 'lucide-react';

interface AgentTaskArtifact {
  path: string;
  name: string;
  sizeBytes: number;
}

interface AgentTask {
  id: string;
  agent: 'Alex' | 'Astyria' | 'Aurelius' | 'Aria' | 'Operator';
  title: string;
  description: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logs: string[];
  result?: string;
  artifact?: AgentTaskArtifact;
  error?: string;
}

interface TaskStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export const BastillaOS2View: React.FC = () => {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [stats, setStats] = useState<TaskStats>({ total: 0, queued: 0, running: 0, completed: 0, failed: 0 });
  const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'failed'>('all');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // Form state
  const [agent, setAgent] = useState<'Alex' | 'Astyria' | 'Aurelius' | 'Aria'>('Astyria');
  const [actionType, setActionType] = useState('ai_task');
  const [taskTitle, setTaskTitle] = useState('Analiza zadania przez agenta AI');
  const [taskDescription, setTaskDescription] = useState('Opisz konkretnie, co agent ma przeanalizować lub przygotować.');
  const [targetAppId, setTargetAppId] = useState('bastilla_os_2');
  const [taskToken, setTaskToken] = useState('');
  const [runError, setRunError] = useState('');

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-tasks', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (e) {
      console.warn('Błąd pobierania zadań agentów:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleRunTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunningAction(true);
    setRunError('');
    try {
      const res = await fetch('/api/agent-tasks/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(taskToken.trim() ? { Authorization: `Bearer ${taskToken.trim()}` } : {}),
        },
        body: JSON.stringify({
          agent,
          title: taskTitle,
          description: taskDescription,
          actionType,
          targetAppId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setRunError(data.error || `Nie udało się uruchomić zadania (HTTP ${res.status}).`);
        return;
      }
      setIsModalOpen(false);
      await fetchTasks();
    } catch (err) {
      console.error('Błąd uruchamiania zadania:', err);
      setRunError('Nie można połączyć się z serwerem zadań.');
    } finally {
      setRunningAction(false);
    }
  };

  const handleCancelTask = async (id: string) => {
    setCancelingId(id);
    try {
      const res = await fetch('/api/agent-tasks/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(taskToken.trim() ? { Authorization: `Bearer ${taskToken.trim()}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await fetchTasks();
      }
    } catch (err) {
      console.error('Błąd anulowania zadania:', err);
    } finally {
      setCancelingId(null);
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return true;
    return t.status === filter;
  });

  return (
    <div className="bastilla-v2 flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#030712] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-cyan-900/50 bg-[#050b18]/95 px-3 py-3 shadow-lg shadow-cyan-950/20 backdrop-blur-xl sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-200/30">
              <Shield className="w-6 h-6 stroke-[2]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-bold tracking-[0.12em] text-slate-50 sm:text-lg">BASTILLA OS 2</h1>
                <span className="rounded border border-cyan-700/50 bg-cyan-950/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-200">
                  NEXUS · 02
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400 sm:text-xs">
                Interfejs operatorski · Pulpit, komunikacja i rejestr zadań
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setRunError(''); setIsModalOpen(true); }}
              className="flex min-h-10 items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Nowe zadanie</span>
            </button>
            <a
              href="/api/apps/preview/bastilla_os_2/"
              target="_blank"
              rel="noreferrer"
              className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-700 hover:bg-slate-800 hover:text-white"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Podgląd aplikacji</span>
            </a>
            <button
              onClick={() => void fetchTasks()}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/80 text-slate-300 transition hover:border-cyan-700 hover:bg-slate-800 hover:text-white"
              aria-label="Odśwież rejestr zadań"
              title="Odśwież rejestr zadań"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6 flex-1">
        {/* Metric Cards Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#0b1425] border border-cyan-900/50 shadow-lg shadow-cyan-950/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#736758]">
              <span className="font-semibold uppercase tracking-wider">Zadania w Rejestrze</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/60 text-amber-200 border border-amber-800/50">
                Fizyczne
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-[#1A1612] font-mono tabular-nums">{stats.total}</span>
              <span className="text-xs text-emerald-700 font-semibold font-mono tabular-nums">{stats.completed} z artefaktem</span>
            </div>
            <div className="text-[11px] text-[#8C7E6D] mt-2 border-t border-[#F0EAE1] pt-2">
              Stan completed wymaga pliku na dysku.
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#0b1425] border border-cyan-900/50 shadow-lg shadow-cyan-950/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#736758]">
              <span className="font-semibold uppercase tracking-wider">Aktywni Wykonawcy</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-200 border border-emerald-800/50">
                Wątki w tle
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-[#C5A059] font-mono tabular-nums">{stats.running}</span>
              <span className="text-xs text-[#736758] font-mono tabular-nums">{stats.queued} w kolejce</span>
            </div>
            <div className="text-[11px] text-[#8C7E6D] mt-2 border-t border-[#F0EAE1] pt-2">
              Stan running wymaga aktywnego wykonawcy.
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#0b1425] border border-cyan-900/50 shadow-lg shadow-cyan-950/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#736758]">
              <span className="font-semibold uppercase tracking-wider">Zadania z błędem</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/60 text-blue-200 border border-blue-800/50">
                Rejestr
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-[#1A1612] font-mono tabular-nums">{stats.failed}</span>
              <span className="text-xs text-amber-700 font-medium">w rejestrze</span>
            </div>
            <div className="text-[11px] text-[#8C7E6D] mt-2 border-t border-[#F0EAE1] pt-2">
              Błędy zgłoszone przez rejestr zadań.
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#0b1425] border border-cyan-900/50 shadow-lg shadow-cyan-950/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#736758]">
              <span className="font-semibold uppercase tracking-wider">Aplikacja Bastilla OS 2</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-violet-950/60 text-violet-200 border border-violet-800/50">
                apps/bastilla_os_2
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-base font-bold text-[#1A1612]">HTML5/Tailwind</span>
              <span className="text-xs text-emerald-700 font-semibold font-mono tabular-nums">v2.0.0</span>
            </div>
            <div className="text-[11px] text-[#8C7E6D] mt-2 border-t border-[#F0EAE1] pt-2">
              Własna ścieżka i responsywny pulpit.
            </div>
          </div>
        </section>

        {/* Task Registry Workspace */}
        <section className="bg-white rounded-xl border border-[#E6DCB8] shadow-xs overflow-hidden">
          <div className="p-5 border-b border-[#E6DCB8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#1A1612] flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-[#C5A059]" />
                <span>Rzeczywisty Rejestr Zadań Agentów (Agent Task Registry)</span>
              </h2>
              <p className="text-xs text-[#736758] mt-0.5">
                Stany: queued / running / completed / failed. Znaczniki czasu, logi i fizyczne artefakty.
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-[#FAF7F0] p-1 rounded-lg border border-[#E6DCB8] text-xs">
              {(['all', 'running', 'completed', 'failed'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setFilter(mode)}
                  className={`px-3 py-1 rounded font-medium transition ${
                    filter === mode
                      ? 'bg-white text-[#1A1612] shadow-xs border border-[#D9C38B]'
                      : 'text-[#736758] hover:text-[#1A1612]'
                  }`}
                >
                  {mode === 'all' && `Wszystkie (${tasks.length})`}
                  {mode === 'running' && `W toku (${stats.running})`}
                  {mode === 'completed' && `Ukończone (${stats.completed})`}
                  {mode === 'failed' && `Błędy (${stats.failed})`}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs text-[#736758]">Ładowanie rejestru zadań…</div>
          ) : filteredTasks.length === 0 ? (
            <div className="p-12 text-center text-xs text-[#736758]">
              Brak zadań w filtrze „{filter}”. Uruchom nowe zadanie klikając przycisk powyżej.
            </div>
          ) : (
            <div className="divide-y divide-[#F0EAE1]">
              {filteredTasks.map((task) => {
                const statusStyles = {
                  completed: 'bg-emerald-950/60 text-emerald-200 border-emerald-700/50',
                  running: 'bg-amber-950/60 text-amber-200 border-amber-700/50 animate-pulse',
                  queued: 'bg-blue-950/60 text-blue-200 border-blue-700/50',
                  failed: 'bg-rose-950/60 text-rose-200 border-rose-700/50',
                }[task.status];

                const isRunning = task.status === 'running' || task.status === 'queued';

                return (
                  <div key={task.id} className="p-5 hover:bg-[#FAF7F0]/60 transition space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-bold text-[#1A1612]">{task.title}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusStyles}`}>
                            {task.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-[#594E3F]">{task.description}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded bg-[#FAF7F0] border border-[#D9C38B] text-xs font-semibold text-[#736758]">
                          {task.agent}
                        </span>
                        {isRunning && (
                          <button
                            onClick={() => void handleCancelTask(task.id)}
                            disabled={cancelingId === task.id}
                            className="px-2 py-1 rounded text-xs text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 transition flex items-center gap-1"
                          >
                            <Ban className="w-3 h-3" />
                            <span>{cancelingId === task.id ? '…' : 'Przerwij'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Artifact info */}
                    {task.artifact && (
                      <div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-[#FAF7F0] border border-[#E6DCB8]">
                        <div className="flex items-center gap-2 text-[#594E3F]">
                          <FileCheck className="w-4 h-4 text-[#C5A059]" />
                          <span className="font-semibold text-[#7A5B18]">Artefakt zweryfikowany:</span>
                          <code className="font-mono text-[11px] text-[#241E18] font-bold">{task.artifact.path}</code>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-[#736758]">
                          {task.artifact.sizeBytes.toLocaleString()} B
                        </span>
                      </div>
                    )}

                    {/* Result or error */}
                    {task.result && (
                      <div className="text-xs text-[#594E3F] bg-white p-2.5 rounded-lg border border-[#E6DCB8]">
                        <span className="font-semibold text-[#1A1612]">Wynik:</span> {task.result}
                      </div>
                    )}
                    {task.error && (
                      <div className="text-xs text-red-800 bg-red-50 p-2.5 rounded-lg border border-red-200 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                        <span>{task.error}</span>
                      </div>
                    )}

                    {/* Expandable Logs */}
                    <details className="text-xs text-[#736758]">
                      <summary className="cursor-pointer hover:text-[#1A1612] select-none text-[11px] font-medium flex items-center gap-1">
                        <Terminal className="w-3 h-3" />
                        <span>
                          Dziennik zdarzeń ({task.logs.length} wpisów) · Utworzono:{' '}
                          {new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </summary>
                      <div className="mt-2 p-3 rounded-lg bg-[#FAF7F0] border border-[#E6DCB8] font-mono text-[11px] max-h-36 overflow-y-auto space-y-1 text-[#40382E]">
                        {task.logs.map((log, i) => (
                          <div key={i}>{log}</div>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-cyan-900/50 bg-[#0b1425] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">
                Podgląd aplikacji Bastilla OS 2
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Otwórz prototyp w osobnej karcie, aby zachować miejsce na pulpit i zadania.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <a
              href="/api/apps/preview/bastilla_os_2/"
              target="_blank"
              rel="noreferrer"
              className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-cyan-200 transition hover:border-cyan-700 hover:bg-slate-800"
            >
              <span>Otwórz podgląd</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </section>
      </main>

      {/* Modal: Run New Task */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E6DCB8] max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#F0EAE1] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#DFB96C] to-[#C5A059] flex items-center justify-center text-white">
                  <Play className="w-4 h-4 fill-current" />
                </div>
                <h3 className="text-sm font-bold text-[#1A1612]">Nowe zadanie agenta AI</h3>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-[#8C7E6D] hover:text-[#1A1612]">
                ✕
              </button>
            </div>

            <form onSubmit={handleRunTask} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#594E3F] mb-1" htmlFor="agent-task-token">Token operacji agentów</label>
                <input
                  id="agent-task-token"
                  type="password"
                  autoComplete="off"
                  value={taskToken}
                  onChange={(e) => setTaskToken(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-[#D9C38B] bg-[#FAF7F0] text-[#1A1612]"
                />
              </div>

              <div>
                <label className="block font-medium text-[#594E3F] mb-1">Wykonawca w Triadzie</label>
                <select
                  value={agent}
                  onChange={(e) => setAgent(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-[#D9C38B] bg-[#FAF7F0] text-[#1A1612] focus:outline-none focus:border-[#C5A059]"
                >
                  <option value="Astyria">Astyria (Hipernadzorca aplikacji i samoleczenie)</option>
                  <option value="Alex">Alex (Infrastruktura i operacje na plikach)</option>
                  <option value="Aurelius">Aurelius (Integralność baz SQLite i audyty)</option>
                  <option value="Aria">Aria (Weryfikacja modeli i protokoły)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-[#594E3F] mb-1">Tryb wykonania</label>
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#D9C38B] bg-[#FAF7F0] text-[#1A1612] focus:outline-none focus:border-[#C5A059]"
                >
                  <option value="ai_task">Zadanie AI (wymaga dostępnego modelu; zapisuje odpowiedź jako raport)</option>
                  <option value="audit_system_integrity">Audyt integralności jądra (tworzy exports/system_integrity_report.json)</option>
                  <option value="scaffold_app">Inicjalizacja/audyt aplikacji w apps/ (tworzy app.json)</option>
                  <option value="write_app_file">Zapis bezpiecznego pliku w apps/ (tworzy katalog i manifest)</option>
                  <option value="generic_diag">Diagnostyka systemowa (tworzy raport diagnostyczny w exports/)</option>
                </select>
                {actionType === 'ai_task' && (
                  <p className="mt-1 text-[11px] text-[#736758]">Model przygotuje odpowiedź; nie uruchamia poleceń ani nie zmienia plików projektu.</p>
                )}
              </div>

              {(actionType === 'scaffold_app' || actionType === 'write_app_file') && (
                <div>
                  <label className="block font-medium text-[#594E3F] mb-1">Identyfikator Aplikacji</label>
                  <input
                    type="text"
                    value={targetAppId}
                    onChange={(e) => setTargetAppId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#D9C38B] bg-[#FAF7F0] text-[#1A1612]"
                  />
                </div>
              )}

              <div>
                <label className="block font-medium text-[#594E3F] mb-1">Tytuł Zadania</label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-[#D9C38B] bg-[#FAF7F0] text-[#1A1612]"
                />
              </div>

              <div>
                <label className="block font-medium text-[#594E3F] mb-1">Opis Zadania</label>
                <textarea
                  rows={2}
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-[#D9C38B] bg-[#FAF7F0] text-[#1A1612]"
                />
              </div>

              {runError && (
                <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {runError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F0EAE1]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[#D9C38B] text-[#736758] hover:bg-[#F4EFE6]"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={runningAction}
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#DFB96C] via-[#C5A059] to-[#997A3D] text-white font-semibold hover:brightness-105 active:scale-95 transition"
                >
                  {runningAction ? 'Uruchamianie…' : 'Zleć i uruchom'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
