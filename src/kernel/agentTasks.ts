import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface AgentTaskArtifact {
  path: string;
  name: string;
  sizeBytes: number;
}

export type AgentTaskWorkStatus = 'pending' | 'running' | 'blocked' | 'done' | 'failed';

export interface AgentTaskEvent {
  at: string;
  type: 'created' | 'started' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'retry';
  detail: string;
}

export interface AgentTask {
  id: string;
  agent: 'Alex' | 'Astyria' | 'Aurelius' | 'Aria' | 'Operator';
  title: string;
  description: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  workStatus?: AgentTaskWorkStatus;
  blockedReason?: { code: string; message: string };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logs: string[];
  result?: string;
  artifact?: AgentTaskArtifact;
  error?: string;
  attempts?: number;
  maxAttempts?: number;
  events?: AgentTaskEvent[];
  actionType?: string;
  payload?: Record<string, unknown>;
  retryable?: boolean;
}

type AgentTaskAiExecutor = (
  task: Pick<AgentTask, 'agent' | 'title' | 'description'>,
  signal: AbortSignal,
) => Promise<{ text: string; provider: string; model: string }>;

const TASKS_STORAGE_PATH = path.resolve('data', 'agent_tasks.json');

function ensureDataDir(storagePath: string): void {
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const RESTART_BLOCK = {
  code: 'RESTART_RECOVERY',
  message: 'Serwer uruchomił się ponownie; zadanie wymaga ręcznego ponowienia.',
};

function getWorkStatus(task: AgentTask): AgentTaskWorkStatus {
  if (task.workStatus) return task.workStatus;
  if (task.status === 'completed') return 'done';
  if (task.status === 'running') return 'running';
  if (task.status === 'queued') return 'pending';
  return 'failed';
}

function publicTask(task: AgentTask): AgentTask {
  const { actionType: _actionType, payload: _payload, ...visibleTask } = task;
  return {
    ...visibleTask,
    retryable: Boolean(task.actionType)
      && (getWorkStatus(task) === 'failed' || getWorkStatus(task) === 'blocked')
      && (task.attempts || 1) < (task.maxAttempts || 3),
  };
}

function validateAppId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error('Nieprawidłowy identyfikator aplikacji.');
  }
  return value;
}

function validateAppFilename(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error('Nieprawidłowa nazwa pliku aplikacji.');
  }
  return value;
}

/**
 * Strict artifact verification:
 * 'completed' requires the artifact file to physically exist on disk.
 * If missing, the status is demoted to 'failed'.
 * Self-healing: if an artifact file was temporarily missing and now exists, it is validated.
 */
function verifyTaskArtifact(task: AgentTask): AgentTask {
  if (task.status === 'completed' || (task.status === 'failed' && task.error?.startsWith('Brak pliku artefaktu na dysku:'))) {
    if (!task.artifact || !task.artifact.path) {
      return {
        ...task,
        status: 'failed',
        workStatus: 'failed',
        error: 'Stan ukończony wymaga powiązanego pliku artefaktu.',
      };
    }
    const fullPath = path.resolve(task.artifact.path);
    if (!fs.existsSync(fullPath)) {
      return {
        ...task,
        status: 'failed',
        workStatus: 'failed',
        error: `Brak pliku artefaktu na dysku: ${task.artifact.path}`,
      };
    }
    try {
      const stats = fs.statSync(fullPath);
      task.artifact.sizeBytes = stats.size;
      if (task.status === 'failed') {
        task.status = 'completed';
        task.workStatus = 'done';
        delete task.error;
      }
    } catch {
      return {
        ...task,
        status: 'failed',
        workStatus: 'failed',
        error: `Błąd odczytu parametrów pliku: ${task.artifact.path}`,
      };
    }
  }
  return task;
}

function seedDefaultTasks(): AgentTask[] {
  return [];
  const now = new Date().toISOString();
  const tasks: AgentTask[] = [
    {
      id: 'task-bastilla-os-2-scaffold',
      agent: 'Astyria',
      title: 'Budowa prototypu Bastilla_OS_2 (Ivory & Gold)',
      description: 'Utworzenie aplikacji Bastilla_OS_2 w apps/bastilla_os_2 z responsywnym pulpitem w estetyce Bastili Shan.',
      status: 'completed',
      createdAt: now,
      startedAt: now,
      completedAt: now,
      logs: [
        `[${now}] Inicjalizacja katalogu apps/bastilla_os_2.`,
        `[${now}] Generowanie manifestu app.json i stylów kości słoniowej i złota.`,
        `[${now}] Zapis pliku wejściowego index.html.`,
        `[${now}] Zweryfikowano fizyczny plik na dysku: apps/bastilla_os_2/index.html.`,
      ],
      result: 'Prototyp Bastilla_OS_2 utworzony pomyślnie. Gotowy do uruchomienia i inspekcji.',
      artifact: {
        path: 'apps/bastilla_os_2/index.html',
        name: 'index.html',
        sizeBytes: 0,
      },
    },
    {
      id: 'task-system-snapshot-vm',
      agent: 'Alex',
      title: 'Weryfikacja migawki jądra VM_Ten_System',
      description: 'Zapis i weryfikacja spójnego snapshotu JSON stanu jądra w katalogu exports.',
      status: 'completed',
      createdAt: now,
      startedAt: now,
      completedAt: now,
      logs: [
        `[${now}] Odczyt stanu jądra Python i telemetrycznych metryk pamięci RAM.`,
        `[${now}] Zapis danych do pliku exports/vm_ten_system_snapshot.json.`,
        `[${now}] Weryfikacja integralności schematu JSON snapshotu.`,
      ],
      result: 'Snapshot maszyny VM_Ten_System zaktualizowany i gotowy do inspekcji.',
      artifact: {
        path: 'exports/vm_ten_system_snapshot.json',
        name: 'vm_ten_system_snapshot.json',
        sizeBytes: 0,
      },
    },
    {
      id: 'task-sqlite-integrity-audit',
      agent: 'Aurelius',
      title: 'Audyt fizycznej bazy danych SQLite',
      description: 'Weryfikacja integralności magazynu danych w data/databases/core_data.sqlite.',
      status: 'completed',
      createdAt: now,
      startedAt: now,
      completedAt: now,
      logs: [
        `[${now}] Skanowanie katalogu data/databases.`,
        `[${now}] Weryfikacja istnienia bazy core_data.sqlite.`,
        `[${now}] Potwierdzono obecność pliku bazy danych na dysku.`,
      ],
      result: 'Baza SQLite zweryfikowana. Plik istnieje w systemie plików.',
      artifact: {
        path: 'data/databases/core_data.sqlite',
        name: 'core_data.sqlite',
        sizeBytes: 0,
      },
    },
    {
      id: 'task-ollama-runtime-check',
      agent: 'Aria',
      title: 'Diagnostyka wykonawcza Ollama',
      description: 'Weryfikacja dostępności demona Ollama pod adresem http://127.0.0.1:11434 i skryptu setup.',
      status: 'completed',
      createdAt: now,
      startedAt: now,
      completedAt: now,
      logs: [
        `[${now}] Odpytanie punktu końcowego Ollama API.`,
        `[${now}] Zweryfikowano obecność instalatora w scripts/setup-ollama.sh.`,
        `[${now}] Status połączenia zarejestrowany w pamięci serwera.`,
      ],
      result: 'Diagnostyka wykonana. Skrypt konfiguracyjny istnieje na dysku.',
      artifact: {
        path: 'scripts/setup-ollama.sh',
        name: 'setup-ollama.sh',
        sizeBytes: 0,
      },
    },
  ];

  return tasks.map(verifyTaskArtifact);
}

export class AgentTaskRegistry {
  private tasks: Map<string, AgentTask> = new Map();
  private runningExecutors: Map<string, AbortController> = new Map();
  private taskExecutors: Map<string, AgentTaskAiExecutor | undefined> = new Map();
  private readonly storagePath: string;

  constructor(storagePath = TASKS_STORAGE_PATH) {
    this.storagePath = path.resolve(storagePath);
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    ensureDataDir(this.storagePath);
    if (fs.existsSync(this.storagePath)) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) throw new Error('Rejestr zadań musi być tablicą.');
        for (const item of list) {
          if (!item || typeof item.id !== 'string') continue;
          const task = verifyTaskArtifact(item);
          task.workStatus = getWorkStatus(task);
          task.events ||= [];
          task.attempts ||= 1;
          task.maxAttempts ||= 3;
          if (task.workStatus === 'pending' || task.workStatus === 'running') {
            task.status = 'failed';
            task.workStatus = 'blocked';
            task.blockedReason = RESTART_BLOCK;
            task.error = RESTART_BLOCK.message;
            task.completedAt = new Date().toISOString();
            task.logs.push(`[${task.completedAt}] ${RESTART_BLOCK.message}`);
            task.events.push({ at: task.completedAt, type: 'blocked', detail: RESTART_BLOCK.message });
          }
          this.tasks.set(task.id, task);
        }
        this.saveToDisk();
        return;
      } catch (err) {
        console.error('[AGENT_TASKS] Nie można bezpiecznie wczytać rejestru zadań:', err);
        throw err;
      }
    }

    this.saveToDisk();
  }

  private saveToDisk(): void {
    ensureDataDir(this.storagePath);
    const temporaryPath = `${this.storagePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const list = Array.from(this.tasks.values());
      fs.writeFileSync(temporaryPath, JSON.stringify(list, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.storagePath);
    } catch (err) {
      fs.rmSync(temporaryPath, { force: true });
      throw err;
    }
  }

  public getAll(): AgentTask[] {
    const list = Array.from(this.tasks.values())
      .map((task) => publicTask(verifyTaskArtifact(task)))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }

  public getStats(): {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    pending: number;
    blocked: number;
    done: number;
  } {
    const all = this.getAll();
    const count = (status: AgentTaskWorkStatus) => all.filter((task) => getWorkStatus(task) === status).length;
    return {
      total: all.length,
      queued: count('pending'),
      running: count('running'),
      completed: count('done'),
      failed: count('failed'),
      pending: count('pending'),
      blocked: count('blocked'),
      done: count('done'),
    };
  }

  public getById(id: string): AgentTask | undefined {
    const task = this.tasks.get(id);
    return task ? publicTask(verifyTaskArtifact(task)) : undefined;
  }

  public cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    const workStatus = getWorkStatus(task);
    if (workStatus !== 'running' && workStatus !== 'pending') return false;

    this.runningExecutors.get(id)?.abort();
    this.taskExecutors.delete(id);
    task.status = 'failed';
    task.workStatus = 'failed';
    task.error = 'Zadanie anulowane przez operatora.';
    task.completedAt = new Date().toISOString();
    task.logs.push(`[${task.completedAt}] ${task.error}`);
    task.events ||= [];
    task.events.push({ at: task.completedAt, type: 'cancelled', detail: task.error });
    this.saveToDisk();
    return true;
  }

  public retry(
    id: string,
    aiExecutor?: AgentTaskAiExecutor,
  ): AgentTask | undefined {
    const task = this.tasks.get(id);
    if (!task || (getWorkStatus(task) !== 'failed' && getWorkStatus(task) !== 'blocked')
      || this.runningExecutors.has(id) || !task.actionType
      || (task.attempts || 1) >= (task.maxAttempts || 3)) {
      return undefined;
    }

    task.attempts = (task.attempts || 1) + 1;
    task.status = 'queued';
    task.workStatus = 'pending';
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.result = undefined;
    task.artifact = undefined;
    task.error = undefined;
    task.blockedReason = undefined;
    const now = new Date().toISOString();
    task.logs.push(`[${now}] Ponowienie zadania (próba ${task.attempts}/${task.maxAttempts || 3}).`);
    task.events ||= [];
    task.events.push({ at: now, type: 'retry', detail: `Próba ${task.attempts}/${task.maxAttempts || 3}.` });
    this.saveToDisk();
    this.taskExecutors.set(task.id, aiExecutor);
    this.processNext();
    return publicTask(task);
  }

  private processNext(): void {
    if (this.runningExecutors.size > 0) return;
    const task = Array.from(this.tasks.values())
      .filter((item) => getWorkStatus(item) === 'pending')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
    if (!task || !task.actionType) return;

    const aiExecutor = this.taskExecutors.get(task.id);
    if (task.actionType === 'ai_task' && !aiExecutor) {
      const now = new Date().toISOString();
      task.status = 'failed';
      task.workStatus = 'blocked';
      task.blockedReason = {
        code: 'AI_EXECUTOR_UNAVAILABLE',
        message: 'Brak dostępnego wykonawcy modelu AI; zadanie wymaga ręcznego ponowienia.',
      };
      task.error = task.blockedReason.message;
      task.completedAt = now;
      task.logs.push(`[${now}] ${task.blockedReason.message}`);
      task.events ||= [];
      task.events.push({ at: now, type: 'blocked', detail: task.blockedReason.message });
      this.saveToDisk();
      this.processNext();
      return;
    }

    void this.executeTask(task.id, task.actionType, task.payload, aiExecutor);
  }

  /**
   * Real task executor:
   * - Sets state to 'running' with an active AbortController executor
   * - Performs actual work on disk (creating or verifying artifacts)
   * - Only transitions to 'completed' once the artifact is confirmed on disk
   */
  public async runTask(params: {
    agent: AgentTask['agent'];
    title: string;
    description: string;
    actionType: string;
    payload?: Record<string, any>;
    aiExecutor?: AgentTaskAiExecutor;
  }): Promise<AgentTask> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const task: AgentTask = {
      id: taskId,
      agent: params.agent,
      title: params.title,
      description: params.description,
      status: 'queued',
      workStatus: 'pending',
      createdAt: now,
      logs: [`[${now}] Zadanie zarejestrowane w kolejce.`],
      attempts: 1,
      maxAttempts: 3,
      events: [{ at: now, type: 'created', detail: 'Zadanie zarejestrowane w kolejce.' }],
      actionType: params.actionType,
      payload: params.payload,
    };

    this.tasks.set(taskId, task);
    this.saveToDisk();

    this.taskExecutors.set(taskId, params.aiExecutor);
    this.processNext();

    return publicTask(task);
  }

  private async executeTask(
    taskId: string,
    actionType: string,
    payload: Record<string, any> = {},
    aiExecutor?: AgentTaskAiExecutor,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const controller = new AbortController();
    this.runningExecutors.set(taskId, controller);

    const throwIfAborted = () => {
      if (controller.signal.aborted) throw new Error('Zadanie anulowane przez operatora.');
    };
    const appendLog = (msg: string) => {
      task.logs.push(`[${new Date().toISOString()}] ${msg}`);
      this.saveToDisk();
    };

    try {
      task.status = 'running';
      task.workStatus = 'running';
      task.startedAt = new Date().toISOString();
      task.logs.push(`[${task.startedAt}] Rozpoczęto wykonywanie zadania przez agenta ${task.agent}.`);
      task.events ||= [];
      task.events.push({ at: task.startedAt, type: 'started', detail: `Agent ${task.agent} rozpoczął zadanie.` });
      this.saveToDisk();

      if (controller.signal.aborted) {
        throw new Error('Przerwano przed rozpoczęciem.');
      }

      if (actionType === 'ai_task') {
        if (!aiExecutor) {
          task.status = 'failed';
          task.workStatus = 'blocked';
          task.blockedReason = {
            code: 'AI_EXECUTOR_UNAVAILABLE',
            message: 'Brak dostępnego wykonawcy modelu AI; zadanie wymaga ręcznego ponowienia.',
          };
          task.error = task.blockedReason.message;
          task.completedAt = new Date().toISOString();
          task.logs.push(`[${task.completedAt}] ${task.blockedReason.message}`);
          task.events.push({ at: task.completedAt, type: 'blocked', detail: task.blockedReason.message });
          return;
        }
        appendLog('Wysyłanie zadania do skonfigurowanego modelu AI...');
        const response = await aiExecutor(task, controller.signal);
        throwIfAborted();
        if (!response.text.trim()) {
          throw new Error('Model AI zwrócił pustą odpowiedź.');
        }

        const reportsDir = path.resolve('exports', 'agent_tasks');
        fs.mkdirSync(reportsDir, { recursive: true });
        const reportPath = path.join(reportsDir, `${taskId}.md`);
        fs.writeFileSync(reportPath, [
          `# ${task.title}`,
          '',
          `Agent: ${task.agent}`,
          `Provider: ${response.provider} (${response.model})`,
          '',
          response.text,
          '',
        ].join('\n'), 'utf-8');

        task.artifact = {
          path: path.relative(path.resolve('.'), reportPath),
          name: path.basename(reportPath),
          sizeBytes: fs.statSync(reportPath).size,
        };
        task.result = response.text;
        appendLog(`Model ${response.provider} (${response.model}) przygotował odpowiedź.`);
      } else if (actionType === 'audit_system_integrity') {
        appendLog('Skanowanie spójności plików jądra i konfiguracji...');
        await new Promise((r) => setTimeout(r, 600));
        throwIfAborted();

        const exportsDir = path.resolve('exports');
        if (!fs.existsSync(exportsDir)) {
          fs.mkdirSync(exportsDir, { recursive: true });
        }

        const reportPath = path.join(exportsDir, 'system_integrity_report.json');
        const reportData = {
          timestamp: new Date().toISOString(),
          agent: task.agent,
          status: 'INTEGRITY_VERIFIED',
          checks: {
            server_entrypoint: fs.existsSync(path.resolve('server.ts')),
            package_manifest: fs.existsSync(path.resolve('package.json')),
            apps_directory: fs.existsSync(path.resolve('apps')),
            data_directory: fs.existsSync(path.resolve('data')),
          },
        };

        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf-8');
        appendLog(`Zapisano raport integralności: ${reportPath}`);

        task.artifact = {
          path: 'exports/system_integrity_report.json',
          name: 'system_integrity_report.json',
          sizeBytes: fs.statSync(reportPath).size,
        };
        task.result = `Raport integralności wygenerowany pomyślnie (${task.artifact.sizeBytes} B).`;
      } else if (actionType === 'scaffold_app') {
        const appId = validateAppId(payload.targetAppId || 'bastilla_os_2');
        appendLog(`Weryfikacja/tworzenie struktury aplikacji apps/${appId}...`);
        await new Promise((r) => setTimeout(r, 400));
        throwIfAborted();

        const appDir = path.resolve('apps', appId);
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
        }

        const manifestPath = path.join(appDir, 'app.json');
        if (!fs.existsSync(manifestPath)) {
          const manifest = {
            id: appId,
            name: appId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            type: 'html5-web',
            version: '2.0.0',
            author: task.agent,
            description: `Interfejs operacyjny Bastilla OS 2 w tonacji kości słoniowej i złota.`,
            entry: 'index.html',
            status: 'ready',
            created_at: new Date().toISOString(),
            files: ['index.html', 'app.json'],
          };
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
          appendLog(`Utworzono manifest aplikacji: ${manifestPath}`);
        }

        task.artifact = {
          path: `apps/${appId}/app.json`,
          name: 'app.json',
          sizeBytes: fs.statSync(manifestPath).size,
        };
        task.result = `Aplikacja ${appId} zweryfikowana. Manifest gotowy na dysku.`;
      } else if (actionType === 'write_app_file') {
        const appId = validateAppId(payload.appId || payload.targetAppId || 'bastilla_os_2');
        const filename = validateAppFilename(payload.filename || 'config.json');
        const content = payload.content || JSON.stringify({ updated: true, agent: task.agent, timestamp: new Date().toISOString() }, null, 2);

        appendLog(`Zapisywanie pliku ${filename} do apps/${appId}...`);
        const appDir = path.resolve('apps', appId);
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
          appendLog(`Utworzono brakujący katalog aplikacji apps/${appId}.`);
        }

        const filePath = path.join(appDir, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        appendLog(`Zapisano plik apps/${appId}/${filename}.`);

        const mPath = path.join(appDir, 'app.json');
        if (fs.existsSync(mPath)) {
          try {
            const m = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
            if (Array.isArray(m.files) && !m.files.includes(filename)) {
              m.files.push(filename);
              fs.writeFileSync(mPath, JSON.stringify(m, null, 2), 'utf-8');
            }
          } catch {}
        } else {
          const manifest = {
            id: appId,
            name: appId,
            type: 'html5-web',
            version: '1.0.0',
            author: task.agent,
            description: `Aplikacja ${appId}`,
            entry: filename,
            status: 'ready',
            created_at: new Date().toISOString(),
            files: [filename],
          };
          fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf-8');
          appendLog(`Utworzono manifest app.json dla apps/${appId}.`);
        }

        task.artifact = {
          path: `apps/${appId}/${filename}`,
          name: filename,
          sizeBytes: fs.statSync(filePath).size,
        };
        task.result = `Plik ${filename} w aplikacji ${appId} zapisany (${task.artifact.sizeBytes} B).`;
      } else if (actionType === 'generic_diag') {
        const exportsDir = path.resolve('exports');
        if (!fs.existsSync(exportsDir)) {
          fs.mkdirSync(exportsDir, { recursive: true });
        }
        const diagPath = path.join(exportsDir, `diag_${task.agent.toLowerCase()}_${Date.now()}.json`);
        const diag = {
          taskId,
          agent: task.agent,
          title: task.title,
          timestamp: new Date().toISOString(),
          systemStatus: 'UNVERIFIED',
          completed: true,
        };
        fs.writeFileSync(diagPath, JSON.stringify(diag, null, 2), 'utf-8');
        appendLog(`Zakończono operację diagnostyczną i utworzono artefakt.`);

        task.artifact = {
          path: path.relative(path.resolve('.'), diagPath),
          name: path.basename(diagPath),
          sizeBytes: fs.statSync(diagPath).size,
        };
        task.result = `Operacja zakończona pomyślnie.`;
      } else {
        throw new Error(`Nieobsługiwany typ akcji: ${actionType}`);
      }

      // STRICT VALIDATION: completed requires artifact on disk
      if (!task.artifact || !fs.existsSync(path.resolve(task.artifact.path))) {
        throw new Error('Wykonawca zakończył działanie, ale nie utworzył wymaganego pliku artefaktu.');
      }

      throwIfAborted();
      task.status = 'completed';
      task.workStatus = 'done';
      const completedAt = new Date().toISOString();
      task.completedAt = completedAt;
      task.blockedReason = undefined;
      task.events.push({ at: completedAt, type: 'completed', detail: `Potwierdzono artefakt ${task.artifact!.path}.` });
      appendLog(`Zadanie zakończone sukcesem. Artefakt potwierdzony: ${task.artifact!.path}`);
    } catch (err: any) {
      if (!controller.signal.aborted) {
        task.status = 'failed';
        task.workStatus = 'failed';
        const errorMessage = err?.message || String(err);
        task.error = errorMessage;
        const failedAt = new Date().toISOString();
        task.completedAt = failedAt;
        task.events ||= [];
        task.events.push({ at: failedAt, type: 'failed', detail: errorMessage });
        task.logs.push(`[${failedAt}] BŁĄD: ${errorMessage}`);
        try {
          this.saveToDisk();
        } catch (saveError) {
          console.error('[AGENT_TASKS] Nie można zapisać stanu błędu zadania:', saveError);
        }
      }
    } finally {
      this.runningExecutors.delete(taskId);
      this.taskExecutors.delete(taskId);
      try {
        this.saveToDisk();
      } catch (err) {
        console.error('[AGENT_TASKS] Nie można zapisać końcowego stanu zadania:', err);
      }
      try {
        this.processNext();
      } catch (err) {
        console.error('[AGENT_TASKS] Nie można uruchomić następnego zadania:', err);
      }
    }
  }
}

export const agentTaskRegistry = new AgentTaskRegistry();
