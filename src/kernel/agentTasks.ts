import fs from 'fs';
import path from 'path';

export interface AgentTaskArtifact {
  path: string;
  name: string;
  sizeBytes: number;
}

export interface AgentTask {
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

const TASKS_STORAGE_PATH = path.resolve('data', 'agent_tasks.json');
const SYNTHETIC_TASK_IDS = new Set([
  'task-bastilla-os-2-scaffold',
  'task-system-snapshot-vm',
  'task-sqlite-integrity-audit',
  'task-ollama-runtime-check',
]);
const TASK_ACTION_TYPES = new Set(['audit_system_integrity', 'scaffold_app', 'write_app_file']);

function validateAppId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
    throw new Error('Nieprawidłowy identyfikator aplikacji.');
  }
  return value;
}

function validateAppFilename(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value === '.'
    || value === '..'
    || /[\\/]/.test(value)
  ) {
    throw new Error('Nazwa pliku musi być pojedynczą nazwą bez separatorów ścieżki.');
  }
  return value;
}

function assertSafeAppDirectory(appDir: string): void {
  const appsRoot = path.resolve('apps');
  if (fs.lstatSync(appsRoot).isSymbolicLink() || fs.lstatSync(appDir).isSymbolicLink()) {
    throw new Error('Katalog aplikacji nie może być dowiązaniem symbolicznym.');
  }
  const realAppsRoot = fs.realpathSync(appsRoot);
  const realAppDir = fs.realpathSync(appDir);
  if (!realAppDir.startsWith(`${realAppsRoot}${path.sep}`)) {
    throw new Error('Katalog aplikacji musi znajdować się wewnątrz apps/.');
  }
}

function assertNotSymlink(filePath: string): void {
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error('Plik aplikacji nie może być dowiązaniem symbolicznym.');
  }
}

function ensureDataDir(): void {
  const dir = path.dirname(TASKS_STORAGE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Strict artifact verification:
 * 'completed' requires the artifact file to physically exist on disk.
 * If missing, the status is demoted to 'failed'.
 * Self-healing: if an artifact file was temporarily missing and now exists, it is validated.
 */
function verifyTaskArtifact(task: AgentTask): AgentTask {
  if (task.status === 'completed' && SYNTHETIC_TASK_IDS.has(task.id)) {
    return {
      ...task,
      status: 'failed',
      error: 'Wstępnie wypełnione zadanie nie potwierdza rzeczywistego wykonania.',
    };
  }
  if (task.status === 'completed' || (task.status === 'failed' && task.error?.startsWith('Brak pliku artefaktu na dysku:'))) {
    if (!task.artifact || !task.artifact.path) {
      return {
        ...task,
        status: 'failed',
        error: 'Stan ukończony wymaga powiązanego pliku artefaktu.',
      };
    }
    const fullPath = path.resolve(task.artifact.path);
    if (!fs.existsSync(fullPath)) {
      return {
        ...task,
        status: 'failed',
        error: `Brak pliku artefaktu na dysku: ${task.artifact.path}`,
      };
    }
    try {
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) {
        return {
          ...task,
          status: 'failed',
          error: `Artefakt nie jest zwykłym plikiem: ${task.artifact.path}`,
        };
      }
      task.artifact.sizeBytes = stats.size;
      if (task.status === 'failed') {
        task.status = 'completed';
        delete task.error;
      }
    } catch {
      return {
        ...task,
        status: 'failed',
        error: `Błąd odczytu parametrów pliku: ${task.artifact.path}`,
      };
    }
  }
  return task;
}

class AgentTaskRegistry {
  private tasks: Map<string, AgentTask> = new Map();
  private runningExecutors: Map<string, AbortController> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    ensureDataDir();
    if (fs.existsSync(TASKS_STORAGE_PATH)) {
      try {
        const raw = fs.readFileSync(TASKS_STORAGE_PATH, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.tasks.clear();
          for (const item of list) {
            if (item && item.id) {
              this.tasks.set(item.id, verifyTaskArtifact(item));
            }
          }
          return;
        }
      } catch (err) {
        console.warn('[AGENT_TASKS] Błąd wczytywania rejestru zadań:', err);
      }
    }

  }

  private saveToDisk(): void {
    ensureDataDir();
    try {
      const list = Array.from(this.tasks.values());
      fs.writeFileSync(TASKS_STORAGE_PATH, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AGENT_TASKS] Błąd zapisu rejestru zadań:', err);
    }
  }

  public getAll(): AgentTask[] {
    const list = Array.from(this.tasks.values()).map(verifyTaskArtifact);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getStats(): { total: number; queued: number; running: number; completed: number; failed: number } {
    const all = this.getAll();
    return {
      total: all.length,
      queued: all.filter((t) => t.status === 'queued').length,
      running: all.filter((t) => t.status === 'running').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
    };
  }

  public getById(id: string): AgentTask | undefined {
    const task = this.tasks.get(id);
    return task ? verifyTaskArtifact(task) : undefined;
  }

  public cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    if (task.status === 'running') {
      const controller = this.runningExecutors.get(id);
      if (controller) {
        controller.abort();
        this.runningExecutors.delete(id);
      }
      task.status = 'failed';
      task.error = 'Zadanie przerwane przez operatora.';
      task.completedAt = new Date().toISOString();
      task.logs.push(`[${new Date().toISOString()}] Zadanie zostało anulowane przez operatora.`);
      this.saveToDisk();
      return true;
    }

    if (task.status === 'queued') {
      task.status = 'failed';
      task.error = 'Zadanie wycofane z kolejki.';
      task.completedAt = new Date().toISOString();
      task.logs.push(`[${new Date().toISOString()}] Zadanie wycofane z kolejki.`);
      this.saveToDisk();
      return true;
    }

    return false;
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
  }): Promise<AgentTask> {
    if (!TASK_ACTION_TYPES.has(params.actionType)) {
      throw new Error(`Nieobsługiwany typ zadania: ${params.actionType}`);
    }
    const payload = params.payload ?? {};
    if (params.actionType === 'scaffold_app') {
      validateAppId(payload.targetAppId || 'bastilla_os_2');
    }
    if (params.actionType === 'write_app_file') {
      validateAppId(payload.appId || 'bastilla_os_2');
      validateAppFilename(payload.filename || 'config.json');
    }
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const task: AgentTask = {
      id: taskId,
      agent: params.agent,
      title: params.title,
      description: params.description,
      status: 'queued',
      createdAt: now,
      logs: [`[${now}] Zadanie zarejestrowane w kolejce.`],
    };

    this.tasks.set(taskId, task);
    this.saveToDisk();

    // Start execution asynchronously
    void this.executeTask(taskId, params.actionType, params.payload);

    return task;
  }

  private async executeTask(
    taskId: string,
    actionType: string,
    payload: Record<string, any> = {}
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const controller = new AbortController();
    this.runningExecutors.set(taskId, controller);

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.logs.push(`[${task.startedAt}] Rozpoczęto wykonywanie zadania przez agenta ${task.agent}.`);
    this.saveToDisk();

    const appendLog = (msg: string) => {
      task.logs.push(`[${new Date().toISOString()}] ${msg}`);
      this.saveToDisk();
    };

    try {
      if (controller.signal.aborted) {
        throw new Error('Przerwano przed rozpoczęciem.');
      }

      if (actionType === 'audit_system_integrity') {
        appendLog('Skanowanie spójności plików jądra i konfiguracji...');
        await new Promise((r) => setTimeout(r, 600));

        const exportsDir = path.resolve('exports');
        if (!fs.existsSync(exportsDir)) {
          fs.mkdirSync(exportsDir, { recursive: true });
        }

        const reportPath = path.join(exportsDir, 'system_integrity_report.json');
        const checks = {
          server_entrypoint: fs.existsSync(path.resolve('server.ts')),
          package_manifest: fs.existsSync(path.resolve('package.json')),
          apps_directory: fs.existsSync(path.resolve('apps')),
          data_directory: fs.existsSync(path.resolve('data')),
        };
        const integrityVerified = Object.values(checks).every(Boolean);
        const reportData = {
          timestamp: new Date().toISOString(),
          agent: task.agent,
          status: integrityVerified ? 'INTEGRITY_VERIFIED' : 'INTEGRITY_ISSUES_FOUND',
          checks,
        };

        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf-8');
        appendLog(`Zapisano raport integralności: ${reportPath}`);

        task.artifact = {
          path: 'exports/system_integrity_report.json',
          name: 'system_integrity_report.json',
          sizeBytes: fs.statSync(reportPath).size,
        };
        task.result = `Raport integralności wygenerowany pomyślnie (${task.artifact.sizeBytes} B).`;
        if (!integrityVerified) {
          throw new Error('Audyt integralności wykrył brakujące wymagane pliki lub katalogi.');
        }
      } else if (actionType === 'scaffold_app') {
        const appId = validateAppId(payload.targetAppId || 'bastilla_os_2');
        appendLog(`Weryfikacja/tworzenie struktury aplikacji apps/${appId}...`);
        await new Promise((r) => setTimeout(r, 400));

        const appDir = path.resolve('apps', appId);
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
        }
        assertSafeAppDirectory(appDir);

        const manifestPath = path.join(appDir, 'app.json');
        assertNotSymlink(manifestPath);
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
        const appId = validateAppId(payload.appId || 'bastilla_os_2');
        const filename = validateAppFilename(payload.filename || 'config.json');
        const content = payload.content || JSON.stringify({ updated: true, agent: task.agent, timestamp: new Date().toISOString() }, null, 2);

        appendLog(`Zapisywanie pliku ${filename} do apps/${appId}...`);
        const appDir = path.resolve('apps', appId);
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
          appendLog(`Utworzono brakujący katalog aplikacji apps/${appId}.`);
        }
        assertSafeAppDirectory(appDir);

        const filePath = path.join(appDir, filename);
        assertNotSymlink(filePath);
        fs.writeFileSync(filePath, content, 'utf-8');
        appendLog(`Zapisano plik apps/${appId}/${filename}.`);

        const mPath = path.join(appDir, 'app.json');
        assertNotSymlink(mPath);
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
      } else {
        throw new Error(`Nieobsługiwany typ zadania: ${actionType}`);
      }

      // STRICT VALIDATION: completed requires artifact on disk
      if (!task.artifact || !fs.existsSync(path.resolve(task.artifact.path))) {
        throw new Error('Wykonawca zakończył działanie, ale nie utworzył wymaganego pliku artefaktu.');
      }

      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      appendLog(`Zadanie zakończone sukcesem. Artefakt potwierdzony: ${task.artifact.path}`);
    } catch (err: any) {
      task.status = 'failed';
      task.error = err?.message || String(err);
      task.completedAt = new Date().toISOString();
      appendLog(`BŁĄD: ${task.error}`);
    } finally {
      this.runningExecutors.delete(taskId);
      this.saveToDisk();
    }
  }
}

export const agentTaskRegistry = new AgentTaskRegistry();
