import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentTaskRegistry, agentTaskRegistry } from '../src/kernel/agentTasks.ts';

function isolatedRegistry() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bastilla-work-'));
  const storagePath = path.join(directory, 'agent_tasks.json');
  return {
    registry: new AgentTaskRegistry(storagePath),
    storagePath,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

async function waitForStatus(registry, id, statuses) {
  for (let i = 0; i < 80; i++) {
    const task = registry.getById(id);
    if (task && statuses.includes(task.workStatus)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return registry.getById(id);
}

test('AgentTaskRegistry: new registry does not seed fictitious agent completions', () => {
  const { registry, cleanup } = isolatedRegistry();
  try {
    assert.deepEqual(registry.getAll(), []);
    assert.equal(registry.getStats().total, 0);
  } finally {
    cleanup();
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

test('AgentTaskRegistry: file actions reject path traversal identifiers', async () => {
  const { registry, cleanup } = isolatedRegistry();
  try {
    for (const payload of [
      { appId: '../outside', filename: 'safe.json', content: '{}' },
      { appId: 'safe-app', filename: '../outside.json', content: '{}' },
    ]) {
      const task = await registry.runTask({
        agent: 'Alex',
        title: 'Odrzucona ścieżka',
        description: 'Nie wolno zapisywać poza katalogiem aplikacji.',
        actionType: 'write_app_file',
        payload,
      });
      const failed = await waitForStatus(registry, task.id, ['failed']);
      assert.match(failed.error, /Nieprawidłow/);
      assert.equal(failed.artifact, undefined);
    }
  } finally {
    cleanup();
  }
});

test('AgentTaskRegistry: restart recovery blocks interrupted work with a concrete reason', async () => {
  const { registry, storagePath, cleanup } = isolatedRegistry();
  let release;
  let taskId;
  try {
    const task = await registry.runTask({
      agent: 'Aria',
      title: 'Przerwane zadanie',
      description: 'Nie wolno automatycznie powtórzyć pracy po restarcie.',
      actionType: 'ai_task',
      aiExecutor: async () => new Promise((resolve) => { release = resolve; }),
    });
    taskId = task.id;
    const running = await waitForStatus(registry, task.id, ['running']);
    assert.equal(running.workStatus, 'running');

    const recovered = new AgentTaskRegistry(storagePath).getById(task.id);
    assert.equal(recovered.workStatus, 'blocked');
    assert.equal(recovered.blockedReason.code, 'RESTART_RECOVERY');
    assert.match(recovered.blockedReason.message, /ręcznego ponowienia/);
    assert.ok(recovered.events.some((event) => event.type === 'blocked'));
  } finally {
    if (taskId) registry.cancel(taskId);
    release?.({ text: 'should not be saved', provider: 'test', model: 'test' });
    if (taskId) await waitForStatus(registry, taskId, ['failed']);
    await new Promise((resolve) => setTimeout(resolve, 25));
    cleanup();
  }
});

test('AgentTaskRegistry: retry preserves task identity and records a bounded attempt', async () => {
  const { registry, cleanup } = isolatedRegistry();
  let executions = 0;
  let artifactPath;
  const executor = async () => {
    executions++;
    if (executions === 1) throw new Error('temporary provider failure');
    return { text: 'Retry completed.', provider: 'test-provider', model: 'test-model' };
  };
  try {
    const task = await registry.runTask({
      agent: 'Aria',
      title: 'Ponawialne zadanie',
      description: 'Test kontrolowanego ponowienia.',
      actionType: 'ai_task',
      aiExecutor: executor,
    });
    const failed = await waitForStatus(registry, task.id, ['failed']);
    assert.equal(failed.error, 'temporary provider failure');

    const retry = registry.retry(task.id, executor);
    assert.equal(retry.id, task.id);
    assert.equal(retry.attempts, 2);
    const done = await waitForStatus(registry, task.id, ['done']);
    assert.equal(done.workStatus, 'done');
    assert.equal(executions, 2);
    assert.ok(done.events.some((event) => event.type === 'retry'));
    artifactPath = path.resolve(done.artifact.path);
  } finally {
    if (artifactPath) fs.rmSync(artifactPath, { force: true });
    cleanup();
  }
});

test('AgentTaskRegistry: cancellation cannot be overwritten by a late executor result', async () => {
  const { registry, cleanup } = isolatedRegistry();
  let release;
  let artifactPath;
  try {
    const task = await registry.runTask({
      agent: 'Aria',
      title: 'Anulowane zadanie',
      description: 'Późna odpowiedź nie może zmienić stanu.',
      actionType: 'ai_task',
      aiExecutor: async () => new Promise((resolve) => { release = resolve; }),
    });
    await waitForStatus(registry, task.id, ['running']);
    assert.equal(registry.cancel(task.id), true);
    release({ text: 'late result', provider: 'test-provider', model: 'test-model' });

    const failed = await waitForStatus(registry, task.id, ['failed']);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const finalTask = registry.getById(task.id);
    assert.equal(finalTask.workStatus, 'failed');
    assert.match(finalTask.error, /anulowane przez operatora/);
    assert.equal(finalTask.artifact, undefined);
    assert.equal(registry.cancel(task.id), false);
    assert.ok(finalTask.events.some((event) => event.type === 'cancelled'));
    artifactPath = failed.artifact?.path && path.resolve(failed.artifact.path);
  } finally {
    release?.({ text: 'late result', provider: 'test-provider', model: 'test-model' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (artifactPath) fs.rmSync(artifactPath, { force: true });
    cleanup();
  }
});

test('AgentTaskRegistry: serial queue supports cancelling a pending task', async () => {
  const { registry, cleanup } = isolatedRegistry();
  let release;
  try {
    const active = await registry.runTask({
      agent: 'Aria',
      title: 'Aktywne zadanie',
      description: 'Zajmuje jedyny slot.',
      actionType: 'ai_task',
      aiExecutor: async () => new Promise((resolve) => { release = resolve; }),
    });
    await waitForStatus(registry, active.id, ['running']);
    const pending = await registry.runTask({
      agent: 'Alex',
      title: 'Oczekujące zadanie',
      description: 'Pozostaje w kolejce.',
      actionType: 'ai_task',
      aiExecutor: async () => ({ text: 'unused', provider: 'test', model: 'test' }),
    });
    assert.equal(registry.getById(pending.id).workStatus, 'pending');
    assert.equal(registry.cancel(pending.id), true);
    assert.equal(registry.getById(pending.id).workStatus, 'failed');
    assert.ok(registry.getById(pending.id).events.some((event) => event.type === 'cancelled'));
    registry.cancel(active.id);
    release({ text: 'cancelled', provider: 'test-provider', model: 'test-model' });
    await waitForStatus(registry, active.id, ['failed']);
  } finally {
    release?.({ text: 'cancelled', provider: 'test-provider', model: 'test-model' });
    cleanup();
  }
});
