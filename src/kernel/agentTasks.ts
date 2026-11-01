import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

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
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  scheduledAt?: string;
  retryAt?: string;
  dependsOn: string[];
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  requiresApproval: boolean;
  approvedAt?: string;
  blockedReason?: string;
  logs: string[];
  result?: string;
  artifact?: AgentTaskArtifact;
  error?: string;
}

type TaskJob = {
  actionType: string;
  payload: Record<string, unknown>;
  aiExecutor?: (
    task: Pick<AgentTask, 'agent' | 'title' | 'description'>,
    signal: AbortSignal,
  ) => Promise<{ text: string; provider: string; model: string }>;
};

type TaskNotification = {
  id: string;
  taskId: string;
  event: string;
  status: AgentTask['status'];
  timestamp: string;
};

const TASKS_DATA_DIR = path.resolve(process.env.BASTILLA_AGENT_TASKS_DIR || 'data');
const TASKS_STORAGE_PATH = path.join(TASKS_DATA_DIR, 'agent_tasks.json');
const TASK_AUDIT_PATH = path.join(TASKS_DATA_DIR, 'agent_task_audit.jsonl');
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const LEGACY_SEEDED_TASK_IDS = new Set([
  'task-bastilla-os-2-scaffold',
  'task-system-snapshot-vm',
  'task-sqlite-integrity-audit',
  'task-ollama-runtime-check',
]);
const SAFE_APP_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
const SAFE_FILENAME = /^(?!app\.json$)[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/i;
const EDITABLE_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.py']);

function ensureDataDir(): void {
  fs.mkdirSync(TASKS_DATA_DIR, { recursive: true });
}

function verifyTaskArtifact(task: AgentTask): AgentTask {
  if (task.status !== 'completed') return task;
  if (!task.artifact?.path) {
    task.status = 'failed';
    task.error = 'Stan ukończony wymaga powiązanego pliku artefaktu.';
    task.completedAt = new Date().toISOString();
    return task;
  }
  try {
    const fullPath = path.resolve(task.artifact.path);
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) throw new Error('Artifact is not a file');
    task.artifact.sizeBytes = stats.size;
  } catch {
    task.status = 'failed';
    task.error = `Brak pliku artefaktu na dysku: ${task.artifact.path}`;
    task.completedAt = new Date().toISOString();
  }
  return task;
}

class AgentTaskRegistry {
  private tasks = new Map<string, AgentTask>();
  private jobs = new Map<string, TaskJob>();
  private runningExecutors = new Map<string, AbortController>();
  private notifications: TaskNotification[] = [];
  private processing = false;

  constructor() {
    this.loadFromDisk();
    const scheduler = setInterval(() => void this.processQueue(), 250);
    scheduler.unref();
  }

  private loadFromDisk(): void {
    ensureDataDir();
    const recoveredTasks: AgentTask[] = [];
    if (fs.existsSync(TASKS_STORAGE_PATH)) {
      try {
        const list: unknown = JSON.parse(fs.readFileSync(TASKS_STORAGE_PATH, 'utf-8'));
        if (Array.isArray(list)) {
          for (const raw of list) {
            if (!raw || typeof raw.id !== 'string') continue;
            const task = raw as AgentTask;
            task.logs = Array.isArray(task.logs) ? task.logs : [];
            task.dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
            task.attempts = Number.isInteger(task.attempts) ? task.attempts : 0;
            task.maxAttempts = Number.isInteger(task.maxAttempts) ? task.maxAttempts : MAX_ATTEMPTS;
            task.timeoutMs = Number.isInteger(task.timeoutMs) ? task.timeoutMs : DEFAULT_TIMEOUT_MS;
            task.requiresApproval = Boolean(task.requiresApproval);
            let recovered = false;
            if (LEGACY_SEEDED_TASK_IDS.has(task.id)) {
              task.status = 'blocked';
              task.blockedReason = 'Wpis startowy nie potwierdza rzeczywistego wykonania.';
              task.error = undefined;
              delete task.artifact;
              delete task.result;
              task.logs.push(`[${new Date().toISOString()}] Wpis startowy przeniesiono do blocked; brak dowodu wykonania.`);
              recovered = true;
            }
            if (task.status === 'running' || task.status === 'queued') {
              task.status = 'blocked';
              task.blockedReason = 'Serwer uruchomił się ponownie; wykonawca zadania nie został odtworzony.';
              task.error = undefined;
              task.logs.push(`[${new Date().toISOString()}] Wstrzymano zadanie po restarcie; wymagane jawne ponowienie.`);
              recovered = true;
            }
            this.tasks.set(task.id, verifyTaskArtifact(task));
            if (recovered) recoveredTasks.push(task);
          }
        }
      } catch (error) {
        console.warn('[AGENT_TASKS] Nie można wczytać rejestru zadań:', error);
      }
    }

    if (fs.existsSync(TASK_AUDIT_PATH)) {
      try {
        this.notifications = fs.readFileSync(TASK_AUDIT_PATH, 'utf-8')
          .split('\n')
          .filter(Boolean)
          .slice(-500)
          .flatMap((line) => {
            try {
              const event = JSON.parse(line) as TaskNotification;
              return ['task.blocked', 'task.completed', 'task.failed', 'task.retry_scheduled'].includes(event.event)
                ? [event]
                : [];
            } catch {
              return [];
            }
          });
      } catch (error) {
        console.warn('[AGENT_TASKS] Nie można wczytać dziennika audytu:', error);
      }
    }
    for (const task of recoveredTasks) this.audit(task, 'task.blocked');
    this.saveToDisk();
  }

  private saveToDisk(): void {
    ensureDataDir();
    try {
      fs.writeFileSync(TASKS_STORAGE_PATH, JSON.stringify([...this.tasks.values()], null, 2), 'utf-8');
    } catch (error) {
      console.error('[AGENT_TASKS] Nie można zapisać rejestru zadań:', error);
    }
  }

  private audit(task: AgentTask, event: string): void {
    const notification = {
      id: randomUUID(),
      taskId: task.id,
      event,
      status: task.status,
      timestamp: new Date().toISOString(),
    };
    try {
      fs.appendFileSync(TASK_AUDIT_PATH, `${JSON.stringify(notification)}\n`, 'utf-8');
    } catch (error) {
      console.error('[AGENT_TASKS] Nie można zapisać dziennika audytu:', error);
    }
    if (['task.blocked', 'task.completed', 'task.failed', 'task.retry_scheduled'].includes(event)) {
      this.notifications.push(notification);
      this.notifications = this.notifications.slice(-100);
    }
  }

  public getAll(): AgentTask[] {
    const tasks = [...this.tasks.values()].map(verifyTaskArtifact);
    this.saveToDisk();
    return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getNotifications(): TaskNotification[] {
    return [...this.notifications].slice(-50).reverse();
  }

  public getStats(): { total: number; queued: number; running: number; completed: number; failed: number; blocked: number } {
    const all = this.getAll();
    return {
      total: all.length,
      queued: all.filter((task) => task.status === 'queued').length,
      running: all.filter((task) => task.status === 'running').length,
      completed: all.filter((task) => task.status === 'completed').length,
      failed: all.filter((task) => task.status === 'failed').length,
      blocked: all.filter((task) => task.status === 'blocked').length,
    };
  }

  public getById(id: string): AgentTask | undefined {
    const task = this.tasks.get(id);
    return task ? verifyTaskArtifact(task) : undefined;
  }

  public async runTask(params: {
    agent: AgentTask['agent'];
    title: string;
    description: string;
    actionType: string;
    payload?: Record<string, unknown>;
    dependsOn?: string[];
    scheduledAt?: string;
    requiresApproval?: boolean;
    timeoutMs?: number;
    aiExecutor?: TaskJob['aiExecutor'];
  }): Promise<AgentTask> {
    const dependencies = params.dependsOn || [];
    if (dependencies.length > 20 || new Set(dependencies).size !== dependencies.length
      || dependencies.some((id) => !this.tasks.has(id))) {
      throw new Error('Zależności muszą wskazywać maksymalnie 20 istniejących, unikalnych zadań.');
    }
    if (params.scheduledAt && !Number.isFinite(Date.parse(params.scheduledAt))) {
      throw new Error('Nieprawidłowy termin harmonogramu.');
    }
    if (params.timeoutMs !== undefined
      && (!Number.isInteger(params.timeoutMs) || params.timeoutMs < 100 || params.timeoutMs > MAX_TIMEOUT_MS)) {
      throw new Error(`Limit czasu musi wynosić od 100 do ${MAX_TIMEOUT_MS} ms.`);
    }

    const now = new Date().toISOString();
    const id = `task-${randomUUID()}`;
    const task: AgentTask = {
      id,
      agent: params.agent,
      title: params.title,
      description: params.description,
      status: 'queued',
      createdAt: now,
      scheduledAt: params.scheduledAt,
      dependsOn: dependencies,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      timeoutMs: params.timeoutMs || DEFAULT_TIMEOUT_MS,
      requiresApproval: params.requiresApproval ?? ['scaffold_app', 'write_app_file'].includes(params.actionType),
      logs: [`[${now}] Zadanie zarejestrowano; autonomiczne wykonanie wymaga dostępnego wykonawcy.`],
    };
    this.tasks.set(id, task);

    if (params.actionType !== 'ai_task' || params.aiExecutor) {
      this.jobs.set(id, {
        actionType: params.actionType,
        payload: params.payload || {},
        aiExecutor: params.aiExecutor,
      });
    }

    this.audit(task, 'task.created');
    this.refreshReadiness(task);
    this.saveToDisk();
    void this.processQueue();
    return task;
  }

  private refreshReadiness(task: AgentTask): void {
    if (task.status === 'running' || task.status === 'completed' || task.status === 'failed') return;

    let reason: string | undefined;
    if (!this.jobs.has(task.id)) {
      reason = 'Brak rzeczywistego wykonawcy dla tego zadania.';
    } else if (task.requiresApproval && !task.approvedAt) {
      reason = 'Oczekiwanie na zatwierdzenie operatora.';
    } else {
      const dependencies = task.dependsOn.map((id) => this.tasks.get(id));
      if (dependencies.some((dependency) => !dependency || dependency.status !== 'completed')) {
        reason = 'Oczekiwanie na ukończenie wszystkich zależności.';
      }
    }

    if (reason) {
      if (task.status !== 'blocked' || task.blockedReason !== reason) {
        task.status = 'blocked';
        task.blockedReason = reason;
        task.logs.push(`[${new Date().toISOString()}] Zablokowano: ${reason}`);
        this.audit(task, 'task.blocked');
      }
      return;
    }
    task.blockedReason = undefined;
    if (task.status === 'blocked') {
      task.status = 'queued';
      task.error = undefined;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (true) {
        const now = Date.now();
        const task = [...this.tasks.values()]
          .filter((candidate) => candidate.status === 'queued' || candidate.status === 'blocked')
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .find((candidate) => {
            this.refreshReadiness(candidate);
            const readyAt = Math.max(
              candidate.scheduledAt ? Date.parse(candidate.scheduledAt) : 0,
              candidate.retryAt ? Date.parse(candidate.retryAt) : 0,
            );
            return candidate.status === 'queued' && readyAt <= now;
          });
        if (!task) break;
        const job = this.jobs.get(task.id);
        if (!job) continue;
        await this.executeTask(task, job);
      }
    } finally {
      this.processing = false;
      this.saveToDisk();
    }
  }

  private async executeTask(task: AgentTask, job: TaskJob): Promise<void> {
    const controller = new AbortController();
    this.runningExecutors.set(task.id, controller);
    task.status = 'running';
    task.error = undefined;
    task.startedAt = new Date().toISOString();
    task.attempts += 1;
    task.logs.push(`[${task.startedAt}] Wykonawca rozpoczął próbę ${task.attempts}/${task.maxAttempts}.`);
    this.audit(task, 'task.running');
    this.saveToDisk();

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const operation = this.performAction(task, job, controller.signal);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Przekroczono limit czasu zadania (${task.timeoutMs} ms).`));
          controller.abort();
        }, task.timeoutMs);
      });
      const cancelledPromise = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Zadanie przerwane przez operatora.')), { once: true });
      });
      const result = await Promise.race([operation, timeoutPromise, cancelledPromise]);
      if (controller.signal.aborted) throw new Error('Zadanie przerwane przez operatora.');
      task.artifact = result.artifact;
      task.result = result.result;
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.logs.push(`[${task.completedAt}] Zadanie ukończone; potwierdzono artefakt ${task.artifact.path}.`);
      this.audit(task, 'task.completed');
      this.jobs.delete(task.id);
    } catch (error) {
      if (task.status !== 'running') return;
      task.error = timedOut
        ? `Przekroczono limit czasu zadania (${task.timeoutMs} ms).`
        : error instanceof Error ? error.message : String(error);
      if (job.actionType === 'ai_task' && task.attempts < task.maxAttempts && !controller.signal.aborted) {
        task.status = 'queued';
        task.retryAt = new Date(Date.now() + 1000 * (2 ** (task.attempts - 1))).toISOString();
        task.logs.push(`[${new Date().toISOString()}] Błąd wykonawcy AI; zaplanowano ponowienie.`);
        this.audit(task, 'task.retry_scheduled');
      } else {
        task.status = 'failed';
        task.completedAt = new Date().toISOString();
        task.logs.push(`[${task.completedAt}] Zadanie zakończone błędem: ${task.error}`);
        this.audit(task, 'task.failed');
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      this.runningExecutors.delete(task.id);
      this.saveToDisk();
    }
  }

  private async performAction(
    task: AgentTask,
    job: TaskJob,
    signal: AbortSignal,
  ): Promise<{ result: string; artifact: AgentTaskArtifact }> {
    if (signal.aborted) throw new Error('Zadanie przerwane przez operatora.');
    if (job.actionType === 'ai_task') {
      if (!job.aiExecutor) throw new Error('Brak wykonawcy modelu AI dla tego zadania.');
      const response = await job.aiExecutor(task, signal);
      if (!response.text.trim()) throw new Error('Model AI zwrócił pustą odpowiedź.');
      const reportsDir = path.resolve('exports', 'agent_tasks');
      fs.mkdirSync(reportsDir, { recursive: true });
      const reportPath = path.join(reportsDir, `${task.id}.md`);
      fs.writeFileSync(reportPath, [
        `# ${task.title}`,
        '',
        `Agent: ${task.agent}`,
        `Provider: ${response.provider} (${response.model})`,
        '',
        response.text,
        '',
      ].join('\n'), 'utf-8');
      return {
        result: response.text,
        artifact: { path: path.relative(path.resolve('.'), reportPath), name: path.basename(reportPath), sizeBytes: fs.statSync(reportPath).size },
      };
    }

    if (job.actionType === 'audit_system_integrity') {
      const checks = {
        server_entrypoint: fs.existsSync(path.resolve('server.ts')),
        package_manifest: fs.existsSync(path.resolve('package.json')),
        apps_directory: fs.statSync(path.resolve('apps')).isDirectory(),
        task_executor: fs.existsSync(path.resolve('src/kernel/agentTasks.ts')),
      };
      const reportPath = path.resolve('exports', 'system_integrity_report.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        agent: task.agent,
        status: 'CHECKS_COMPLETED',
        checks,
      }, null, 2), 'utf-8');
      return {
        result: `Wykonano ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length} kontroli.`,
        artifact: { path: path.relative(path.resolve('.'), reportPath), name: path.basename(reportPath), sizeBytes: fs.statSync(reportPath).size },
      };
    }

    if (job.actionType === 'generic_diag') {
      const reportPath = path.resolve('exports', `diag_${task.agent.toLowerCase()}_${task.id}.json`);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      const report = {
        taskId: task.id,
        agent: task.agent,
        title: task.title,
        timestamp: new Date().toISOString(),
        status: 'PROCESS_DIAGNOSTICS_CAPTURED',
        process: {
          nodeVersion: process.version,
          uptimeSeconds: process.uptime(),
          memoryUsageBytes: process.memoryUsage(),
        },
        checks: {
          serverEntrypoint: fs.existsSync(path.resolve('server.ts')),
          packageManifest: fs.existsSync(path.resolve('package.json')),
        },
      };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
      return {
        result: 'Zapisano diagnostykę procesu serwera; nie określa ona dostępności usług zewnętrznych.',
        artifact: { path: path.relative(path.resolve('.'), reportPath), name: path.basename(reportPath), sizeBytes: fs.statSync(reportPath).size },
      };
    }

    if (job.actionType === 'scaffold_app' || job.actionType === 'write_app_file') {
      const rawAppId = job.payload.appId ?? job.payload.targetAppId ?? 'bastilla_os_2';
      if (typeof rawAppId !== 'string' || !SAFE_APP_ID.test(rawAppId)) {
        throw new Error('Nieprawidłowy identyfikator aplikacji.');
      }
      const appsRoot = path.resolve('apps');
      const appDir = path.resolve(appsRoot, rawAppId);
      if (!appDir.startsWith(`${appsRoot}${path.sep}`)) throw new Error('Ścieżka aplikacji jest niedozwolona.');

      if (job.actionType === 'scaffold_app') {
        fs.mkdirSync(appDir, { recursive: true });
        const realAppsRoot = fs.realpathSync(appsRoot);
        const realAppDir = fs.realpathSync(appDir);
        const realRepository = fs.realpathSync('.');
        if (!realAppsRoot.startsWith(`${realRepository}${path.sep}`)
          || !realAppDir.startsWith(`${realAppsRoot}${path.sep}`)) {
          throw new Error('Katalog aplikacji prowadzi poza apps/.');
        }
        const manifestPath = path.join(appDir, 'app.json');
        if (fs.existsSync(manifestPath) && fs.lstatSync(manifestPath).isSymbolicLink()) {
          throw new Error('Manifest aplikacji nie może być dowiązaniem symbolicznym.');
        }
        if (!fs.existsSync(manifestPath)) {
          fs.writeFileSync(manifestPath, JSON.stringify({
            id: rawAppId,
            name: rawAppId.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
            type: 'html5-web',
            version: '2.0.0',
            author: task.agent,
            entry: 'index.html',
            status: 'ready',
            created_at: new Date().toISOString(),
            files: ['app.json'],
          }, null, 2), 'utf-8');
        }
        const stats = fs.statSync(manifestPath);
        return {
          result: `Manifest aplikacji ${rawAppId} zweryfikowano na dysku.`,
          artifact: { path: path.relative(path.resolve('.'), manifestPath), name: path.basename(manifestPath), sizeBytes: stats.size },
        };
      }

      const filename = job.payload.filename ?? 'config.json';
      const content = job.payload.content ?? JSON.stringify({ updated: true, agent: task.agent, timestamp: new Date().toISOString() }, null, 2);
      if (typeof filename !== 'string' || !SAFE_FILENAME.test(filename)
        || !EDITABLE_EXTENSIONS.has(path.extname(filename).toLowerCase())
        || typeof content !== 'string' || content.length > 20_000) {
        throw new Error('Nieprawidłowa nazwa pliku lub treść (limit 20 000 znaków).');
      }
      fs.mkdirSync(appDir, { recursive: true });
      const realAppsRoot = fs.realpathSync(appsRoot);
      const realAppDir = fs.realpathSync(appDir);
      const realRepository = fs.realpathSync('.');
      if (!realAppsRoot.startsWith(`${realRepository}${path.sep}`)
        || !realAppDir.startsWith(`${realAppsRoot}${path.sep}`)) {
        throw new Error('Katalog aplikacji prowadzi poza apps/.');
      }
      const filePath = path.resolve(realAppDir, filename);
      if (!filePath.startsWith(`${realAppDir}${path.sep}`)) throw new Error('Ścieżka pliku jest niedozwolona.');
      if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
        throw new Error('Nie można nadpisać pliku będącego dowiązaniem symbolicznym.');
      }
      const manifestPath = path.join(realAppDir, 'app.json');
      if (fs.existsSync(manifestPath) && fs.lstatSync(manifestPath).isSymbolicLink()) {
        throw new Error('Manifest aplikacji nie może być dowiązaniem symbolicznym.');
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, JSON.stringify({
          id: rawAppId,
          name: rawAppId,
          type: 'html5-web',
          version: '2.0.0',
          author: task.agent,
          entry: filename,
          status: 'ready',
          created_at: new Date().toISOString(),
          files: [filename, 'app.json'],
        }, null, 2), 'utf-8');
      }
      const stats = fs.statSync(filePath);
      return {
        result: `Plik ${filename} w aplikacji ${rawAppId} zapisano (${stats.size} B).`,
        artifact: { path: path.relative(path.resolve('.'), filePath), name: filename, sizeBytes: stats.size },
      };
    }

    throw new Error(`Nieobsługiwany typ akcji: ${job.actionType}`);
  }

  public approve(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'blocked' || !task.requiresApproval || task.approvedAt || !this.jobs.has(id)) return false;
    task.approvedAt = new Date().toISOString();
    task.logs.push(`[${task.approvedAt}] Operator zatwierdził wykonanie zadania.`);
    this.audit(task, 'task.approved');
    this.refreshReadiness(task);
    this.saveToDisk();
    void this.processQueue();
    return true;
  }

  public retry(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'failed' || task.attempts >= task.maxAttempts || !this.jobs.has(id)) return false;
    task.status = 'queued';
    task.error = undefined;
    task.completedAt = undefined;
    task.retryAt = undefined;
    task.logs.push(`[${new Date().toISOString()}] Operator ręcznie ponowił zadanie.`);
    this.audit(task, 'task.retry_requested');
    this.saveToDisk();
    void this.processQueue();
    return true;
  }

  public cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || !['running', 'queued', 'blocked'].includes(task.status)) return false;
    const controller = this.runningExecutors.get(id);
    if (controller) controller.abort();
    task.status = 'failed';
    task.error = 'Zadanie przerwane przez operatora.';
    task.completedAt = new Date().toISOString();
    task.logs.push(`[${task.completedAt}] Operator przerwał zadanie.`);
    this.audit(task, 'task.failed');
    this.saveToDisk();
    return true;
  }
}

export const agentTaskRegistry = new AgentTaskRegistry();
