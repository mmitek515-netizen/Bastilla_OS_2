import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const taskDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bastilla-agent-tasks-'));
process.env.BASTILLA_AGENT_TASKS_DIR = taskDataDir;
const { agentTaskRegistry } = await import('../src/kernel/agentTasks.ts');

after(() => {
  fs.rmSync(taskDataDir, { recursive: true, force: true });
  fs.rmSync(path.resolve('exports', 'system_integrity_report.json'), { force: true });
  fs.rmSync(path.resolve('exports', 'agent_tasks'), { recursive: true, force: true });
});

test('AgentTaskRegistry: only reports completed tasks with real artifacts', () => {
  const tasks = agentTaskRegistry.getAll();
  assert.ok(Array.isArray(tasks));
  assert.equal(tasks.length, 0);

  for (const t of tasks) {
    if (t.status === 'completed') {
      assert.ok(t.artifact, `Task ${t.id} completed must have artifact`);
      assert.ok(fs.existsSync(path.resolve(t.artifact.path)), `Artifact ${t.artifact.path} must exist on disk`);
      assert.ok(t.artifact.sizeBytes >= 0, 'Artifact size must be non-negative');
    }
  }
});

test('AgentTaskRegistry: runs real action and produces verified artifact', async () => {
  const task = await agentTaskRegistry.runTask({
    agent: 'Astyria',
    title: 'Test audytu integralności',
    description: 'Testowanie silnika zadań agentów',
    actionType: 'audit_system_integrity',
  });

  assert.equal(task.agent, 'Astyria');
  assert.ok(task.status === 'queued' || task.status === 'running');

  // Wait for completion
  let completedTask = null;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const current = agentTaskRegistry.getById(task.id);
    if (current && (current.status === 'completed' || current.status === 'failed')) {
      completedTask = current;
      break;
    }
  }

  assert.ok(completedTask, 'Task must complete within time limit');
  assert.equal(completedTask.status, 'completed');
  assert.ok(completedTask.artifact, 'Must have artifact');
  assert.ok(fs.existsSync(path.resolve(completedTask.artifact.path)), 'Artifact file must exist');
});

test('AgentTaskRegistry: write_app_file creates app directory and manifest automatically', async (t) => {
  const testAppId = `test-auto-app-${Date.now()}`;
  t.after(() => fs.rmSync(path.resolve('apps', testAppId), { recursive: true, force: true }));
  const task = await agentTaskRegistry.runTask({
    agent: 'Alex',
    title: 'Zapis pliku w nowej aplikacji',
    description: 'Weryfikacja automatycznego tworzenia aplikacji przy zapisie pliku',
    actionType: 'write_app_file',
    payload: {
      appId: testAppId,
      filename: 'test.json',
      content: JSON.stringify({ ok: true }),
    },
  });

  assert.equal(task.status, 'blocked');
  assert.match(task.blockedReason, /zatwierdzenie/);
  assert.equal(agentTaskRegistry.approve(task.id), true);

  // Wait for completion
  let completed = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const current = agentTaskRegistry.getById(task.id);
    if (current && (current.status === 'completed' || current.status === 'failed')) {
      completed = current;
      break;
    }
  }

  assert.ok(completed);
  assert.equal(completed.status, 'completed');
  const targetFile = path.resolve('apps', testAppId, 'test.json');
  assert.ok(fs.existsSync(targetFile), 'Target file must exist');
  const manifestFile = path.resolve('apps', testAppId, 'app.json');
  assert.ok(fs.existsSync(manifestFile), 'Manifest app.json must be auto-generated');

  // Clean up test app
  fs.rmSync(path.resolve('apps', testAppId), { recursive: true, force: true });
});

test('AgentTaskRegistry: ai_task calls the supplied model executor and saves its response', async () => {
  const task = await agentTaskRegistry.runTask({
    agent: 'Aria',
    title: 'Raport testowy AI',
    description: 'Przygotuj krótki raport.',
    actionType: 'ai_task',
    aiExecutor: async (input, signal) => {
      assert.equal(input.agent, 'Aria');
      assert.equal(input.title, 'Raport testowy AI');
      assert.ok(signal instanceof AbortSignal);
      return { text: 'Wynik wygenerowany przez model.', provider: 'test-provider', model: 'test-model' };
    },
  });

  let finished;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    finished = agentTaskRegistry.getById(task.id);
    if (finished?.status === 'completed' || finished?.status === 'failed') break;
  }

  assert.equal(finished?.status, 'completed');
  assert.match(finished.result, /Wynik wygenerowany przez model/);
  assert.ok(fs.existsSync(path.resolve(finished.artifact.path)));
  assert.match(fs.readFileSync(path.resolve(finished.artifact.path), 'utf8'), /test-provider \(test-model\)/);
  fs.rmSync(path.resolve(finished.artifact.path), { force: true });
});

test('AgentTaskRegistry: missing AI executor is blocked and never reported as completed', async () => {
  const task = await agentTaskRegistry.runTask({
    agent: 'Aria',
    title: 'Zadanie bez wykonawcy',
    description: 'Nie ma skonfigurowanego wykonawcy AI.',
    actionType: 'ai_task',
  });

  assert.equal(task.status, 'blocked');
  assert.match(task.blockedReason, /wykonawcy/);
  assert.equal(task.artifact, undefined);
});

test('AgentTaskRegistry: blocks interrupted and legacy seeded records after restart', (t) => {
  const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bastilla-agent-restart-'));
  t.after(() => fs.rmSync(restartDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(restartDir, 'agent_tasks.json'), JSON.stringify([
    {
      id: 'interrupted-task',
      agent: 'Alex',
      title: 'Przerwane zadanie',
      description: 'Nie wolno wznowić bez wykonawcy.',
      status: 'running',
      createdAt: new Date().toISOString(),
      logs: [],
    },
    {
      id: 'task-ollama-runtime-check',
      agent: 'Aria',
      title: 'Stary wpis startowy',
      description: 'Nie jest dowodem działania usługi.',
      status: 'completed',
      createdAt: new Date().toISOString(),
      logs: [],
      artifact: { path: 'scripts/setup-ollama.sh', name: 'setup-ollama.sh', sizeBytes: 1 },
    },
  ]));

  const moduleUrl = pathToFileURL(path.resolve('src/kernel/agentTasks.ts')).href;
  const program = `const { agentTaskRegistry } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(agentTaskRegistry.getAll()));`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], {
    cwd: process.cwd(),
    env: { ...process.env, BASTILLA_AGENT_TASKS_DIR: restartDir },
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  const tasks = JSON.parse(child.stdout.trim());
  assert.equal(tasks.find((task) => task.id === 'interrupted-task').status, 'blocked');
  assert.equal(tasks.find((task) => task.id === 'task-ollama-runtime-check').status, 'blocked');
});

test('AgentTaskRegistry: waits for dependencies and a scheduled start', async () => {
  const parent = await agentTaskRegistry.runTask({
    agent: 'Aurelius',
    title: 'Zadanie nadrzędne',
    description: 'Tworzy rzeczywisty raport.',
    actionType: 'audit_system_integrity',
  });
  const child = await agentTaskRegistry.runTask({
    agent: 'Alex',
    title: 'Zadanie zależne',
    description: 'Uruchomione po zadaniu nadrzędnym.',
    actionType: 'audit_system_integrity',
    dependsOn: [parent.id],
    scheduledAt: new Date(Date.now() + 300).toISOString(),
  });

  assert.equal(child.status, 'blocked');
  assert.match(child.blockedReason, /zależności/);

  let finished;
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    finished = agentTaskRegistry.getById(child.id);
    if (finished?.status === 'completed' || finished?.status === 'failed') break;
  }
  assert.equal(agentTaskRegistry.getById(parent.id)?.status, 'completed');
  assert.equal(finished?.status, 'completed');
});

test('AgentTaskRegistry: retries transient AI failures and records audit notifications', async () => {
  let attempts = 0;
  const task = await agentTaskRegistry.runTask({
    agent: 'Aria',
    title: 'Ponowienie AI',
    description: 'Błąd przejściowy.',
    actionType: 'ai_task',
    aiExecutor: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Błąd przejściowy');
      return { text: 'Wynik po ponowieniu.', provider: 'test-provider', model: 'test-model' };
    },
  });

  let finished;
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    finished = agentTaskRegistry.getById(task.id);
    if (finished?.status === 'completed' || finished?.status === 'failed') break;
  }

  assert.equal(finished?.status, 'completed');
  assert.equal(finished?.attempts, 2);
  assert.ok(agentTaskRegistry.getNotifications().some((notification) =>
    notification.taskId === task.id && notification.event === 'task.retry_scheduled'));
  fs.rmSync(path.resolve(finished.artifact.path), { force: true });
});

test('AgentTaskRegistry: enforces timeouts and rejects unsafe application paths', async () => {
  const timedOut = await agentTaskRegistry.runTask({
    agent: 'Aria',
    title: 'Limit czasu',
    description: 'Wykonawca nie kończy przed upływem limitu.',
    actionType: 'ai_task',
    timeoutMs: 100,
    aiExecutor: async (_task, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ text: 'za późno', provider: 'test', model: 'test' }), 500);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      }, { once: true });
    }),
  });
  const traversal = await agentTaskRegistry.runTask({
    agent: 'Alex',
    title: 'Niedozwolona ścieżka',
    description: 'Nie zapisuj poza katalogiem aplikacji.',
    actionType: 'write_app_file',
    payload: { appId: '../outside', filename: 'bad.txt', content: 'nope' },
  });

  assert.equal(traversal.status, 'blocked');
  assert.equal(agentTaskRegistry.approve(traversal.id), true);

  let timedOutFinished;
  let traversalFinished;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    timedOutFinished = agentTaskRegistry.getById(timedOut.id);
    traversalFinished = agentTaskRegistry.getById(traversal.id);
    if (timedOutFinished?.status === 'failed' && traversalFinished?.status === 'failed') break;
  }
  assert.equal(timedOutFinished?.status, 'failed');
  assert.match(timedOutFinished.error, /limit czasu/i);
  assert.equal(traversalFinished?.status, 'failed');
  assert.match(traversalFinished.error, /identyfikator aplikacji/i);
});

test('AgentTaskRegistry: refuses to overwrite a symlink outside apps', async (t) => {
  const appId = `test-symlink-${Date.now()}`;
  const appDir = path.resolve('apps', appId);
  const externalFile = path.resolve('/tmp', `${appId}.txt`);
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(externalFile, 'preserve this file', 'utf8');
  fs.symlinkSync(externalFile, path.join(appDir, 'config.txt'));
  t.after(() => {
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.rmSync(externalFile, { force: true });
  });

  const task = await agentTaskRegistry.runTask({
    agent: 'Alex',
    title: 'Odmowa dowiązania',
    description: 'Nie może zapisać poza katalogiem apps.',
    actionType: 'write_app_file',
    payload: { appId, filename: 'config.txt', content: 'must not escape' },
  });
  assert.equal(agentTaskRegistry.approve(task.id), true);

  let finished;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    finished = agentTaskRegistry.getById(task.id);
    if (finished?.status === 'failed') break;
  }
  assert.equal(finished?.status, 'failed');
  assert.match(finished.error, /dowiązaniem symbolicznym/i);
  assert.equal(fs.readFileSync(externalFile, 'utf8'), 'preserve this file');
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.rmSync(externalFile, { force: true });
});

test('AgentTaskRegistry: unsupported action fails instead of producing a fake diagnostic', async () => {
  const task = await agentTaskRegistry.runTask({
    agent: 'Alex',
    title: 'Nieznana akcja',
    description: 'Nie może udawać sukcesu.',
    actionType: 'unsupported_action',
  });

  let finished;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    finished = agentTaskRegistry.getById(task.id);
    if (finished?.status === 'completed' || finished?.status === 'failed') break;
  }

  assert.equal(finished?.status, 'failed');
  assert.match(finished.error, /Nieobsługiwany typ akcji/);
  assert.equal(finished.artifact, undefined);
});

test('AgentTaskRegistry: generic diagnostics contain measured process data without claiming services are online', async () => {
  const task = await agentTaskRegistry.runTask({
    agent: 'Aurelius',
    title: 'Rzeczywista diagnostyka procesu',
    description: 'Zapisz mierzalne dane procesu serwera.',
    actionType: 'generic_diag',
  });

  let finished;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    finished = agentTaskRegistry.getById(task.id);
    if (finished?.status === 'completed' || finished?.status === 'failed') break;
  }
  assert.equal(finished?.status, 'completed');
  const report = JSON.parse(fs.readFileSync(path.resolve(finished.artifact.path), 'utf8'));
  assert.equal(report.status, 'PROCESS_DIAGNOSTICS_CAPTURED');
  assert.equal(report.process.nodeVersion, process.version);
  assert.equal(report.process.uptimeSeconds > 0, true);
  assert.equal(report.systemStatus, undefined);
  fs.rmSync(path.resolve(finished.artifact.path), { force: true });
});
