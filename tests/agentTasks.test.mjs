import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentTaskRegistry } from '../src/kernel/agentTasks.ts';

test('AgentTaskRegistry: lists initial verified tasks with real artifacts', () => {
  const tasks = agentTaskRegistry.getAll();
  assert.ok(Array.isArray(tasks));

  const syntheticTaskIds = new Set([
    'task-bastilla-os-2-scaffold',
    'task-system-snapshot-vm',
    'task-sqlite-integrity-audit',
    'task-ollama-runtime-check',
  ]);
  for (const t of tasks) {
    if (syntheticTaskIds.has(t.id)) assert.notEqual(t.status, 'completed');
    if (t.status === 'completed') {
      assert.ok(t.artifact, `Task ${t.id} completed must have artifact`);
      assert.ok(fs.existsSync(path.resolve(t.artifact.path)), `Artifact ${t.artifact.path} must exist on disk`);
      assert.ok(fs.statSync(path.resolve(t.artifact.path)).isFile(), `Artifact ${t.artifact.path} must be a regular file`);
      assert.ok(t.artifact.sizeBytes >= 0, 'Artifact size must be non-negative');
    }
  }
});

test('AgentTaskRegistry: rejects unsupported actions and paths outside an app', async () => {
  const request = {
    agent: 'Alex',
    title: 'Invalid task',
    description: 'This request must be rejected before work is queued.',
  };
  await assert.rejects(
    agentTaskRegistry.runTask({ ...request, actionType: 'invented_action' }),
    /Nieobsługiwany typ zadania/,
  );
  await assert.rejects(
    agentTaskRegistry.runTask({
      ...request,
      actionType: 'scaffold_app',
      payload: { targetAppId: '../outside' },
    }),
    /Nieprawidłowy identyfikator aplikacji/,
  );
  await assert.rejects(
    agentTaskRegistry.runTask({
      ...request,
      actionType: 'write_app_file',
      payload: { appId: 'safe-app', filename: '../outside.txt' },
    }),
    /pojedynczą nazwą/,
  );
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

test('AgentTaskRegistry: write_app_file creates app directory and manifest automatically', async () => {
  const testAppId = `test-auto-app-${Date.now()}`;
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

test('AgentTaskRegistry: rejects a dangling symlink before writing app content', async () => {
  const testAppId = `test-dangling-symlink-${Date.now()}`;
  const appDir = path.resolve('apps', testAppId);
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bastilla-task-'));
  const outsideFile = path.join(outsideDir, 'outside.txt');
  fs.mkdirSync(appDir, { recursive: true });
  fs.symlinkSync(outsideFile, path.join(appDir, 'config.json'));

  try {
    const task = await agentTaskRegistry.runTask({
      agent: 'Alex',
      title: 'Odrzucenie wiszącego dowiązania',
      description: 'Dowiązanie symboliczne nie może przekierować zapisu.',
      actionType: 'write_app_file',
      payload: { appId: testAppId, filename: 'config.json', content: 'unsafe' },
    });

    let completed = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = agentTaskRegistry.getById(task.id);
      if (current && (current.status === 'completed' || current.status === 'failed')) {
        completed = current;
        break;
      }
    }

    assert.ok(completed);
    assert.equal(completed.status, 'failed');
    assert.match(completed.error, /Plik aplikacji nie może być dowiązaniem symbolicznym/);
    assert.equal(fs.existsSync(outsideFile), false);
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
