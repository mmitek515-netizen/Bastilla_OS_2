import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalQueue } from './approval-queue.mjs';
import { ChatService } from './chat-service.mjs';
import { OllamaClient, OllamaClientError } from './ollama-client.mjs';

const operatorToken = 'operator-test-token-0123456789abcdef';
const authorization = ['Bear', 'er ', operatorToken].join('');

function createQueue() {
  let nextId = 0;
  return new ApprovalQueue({
    operatorToken,
    idGenerator: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
  });
}

test('model chat requires a real provider and authenticated operator', async () => {
  let calls = 0;
  const chat = new ChatService({
    queue: createQueue(),
    operatorToken,
    model: { chat: async () => { calls += 1; return '{"reply":"hello","operation":null}'; } },
  });
  await assert.rejects(chat.sendMessage('Cześć'), { code: 'unauthorized' });
  await assert.rejects(
    new ChatService({ queue: createQueue(), operatorToken }).sendMessage('Hello', authorization),
    { code: 'model_unavailable' },
  );
  assert.equal(calls, 0);
});

test('model conversation is used for open-ended Polish and English chat and history is retained', async () => {
  const contexts = [];
  const chat = new ChatService({
    queue: createQueue(),
    operatorToken,
    sessionId: 'session-one',
    model: {
      async chat(messages) {
        contexts.push(messages);
        return JSON.stringify({ reply: 'Oczywiście, mogę wyjaśnić ten temat.', operation: null });
      },
    },
  });

  const result = await chat.sendMessage('Wyjaśnij różnicę między RAM a dyskiem.', authorization);
  assert.equal(result.sessionId, 'session-one');
  assert.equal(result.reply, 'Oczywiście, mogę wyjaśnić ten temat.');
  assert.equal(result.source, 'local-model');
  assert.equal(result.verified, false);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0][0].role, 'system');
  assert.match(contexts[0][0].content, /never return shell commands/i);
  assert.deepEqual(contexts[0].slice(1).map(({ role }) => role), ['user']);
  assert.deepEqual(chat.history(authorization).messages.map(({ role }) => role), ['user', 'assistant']);
  assert.equal(chat.history(authorization).messages[1].verified, false);
  assert.throws(() => chat.history('invalid'), { code: 'unauthorized' });
});

test('deterministic safe intents take precedence and read actual host status', async () => {
  let modelCalls = 0;
  const queue = createQueue();
  const chat = new ChatService({
    queue,
    operatorToken,
    model: { chat: async () => { modelCalls += 1; return ''; } },
    systemStatusProvider: () => ({ platform: 'linux-test', uptimeSeconds: 42 }),
  });

  const status = await chat.sendMessage('Pokaż status systemu', authorization);
  assert.deepEqual(JSON.parse(status.reply), { platform: 'linux-test', uptimeSeconds: 42 });
  assert.equal(status.operation, null);
  assert.equal(status.source, 'application');
  assert.equal(status.verified, true);

  const proposal = await chat.sendMessage('Restart service nginx', authorization);
  assert.equal(proposal.operation.status, 'pending_approval');
  assert.equal(proposal.operation.risk, 'high');
  assert.deepEqual(proposal.operation.operation, { type: 'service.restart', service: 'nginx' });
  assert.match(proposal.notice, /"service":"nginx"/);
  assert.match(proposal.notice, /Approval does not execute it/i);
  assert.equal(modelCalls, 0);
});

test('only strict, allowlisted model operations can enter the approval queue', async () => {
  for (const [invalid, errorCode] of [
    [{ reply: 'try shell', operation: { type: 'shell.exec', command: 'id' } }, 'invalid_model_operation'],
    [{ reply: 'extra', operation: { type: 'system.reboot', command: 'reboot' } }, 'invalid_model_operation'],
    [{ reply: 'unknown field', operation: null, extra: true }, 'invalid_model_response'],
    [{ reply: 'empty', operation: '' }, 'invalid_model_operation'],
    [{ reply: 'x'.repeat(4001), operation: null }, 'invalid_model_response'],
    ['```json\n{"reply":"bad","operation":null}\n```', 'invalid_model_response'],
  ]) {
    const chat = new ChatService({
      queue: createQueue(),
      operatorToken,
      model: { chat: async () => JSON.stringify(invalid) },
    });
    await assert.rejects(chat.sendMessage('Please help me.', authorization), { code: errorCode });
  }

  const queue = createQueue();
  const chat = new ChatService({
    queue,
    operatorToken,
    model: {
      chat: async () => JSON.stringify({
        reply: 'Mogę zaproponować restart SSH.',
        operation: { type: 'service.restart', service: 'ssh' },
      }),
    },
  });
  const proposal = await chat.sendMessage('Could you restart the remote access service?', authorization);
  assert.equal(proposal.operation.status, 'pending_approval');
  assert.deepEqual(queue.list(authorization)[0].operation, { type: 'service.restart', service: 'ssh' });
  assert.equal(proposal.verified, false);
  assert.match(proposal.notice, /may terminate this remote session/i);
});

test('model claims about completed operations remain explicitly unverified', async () => {
  const queue = createQueue();
  const chat = new ChatService({
    queue,
    operatorToken,
    model: {
      chat: async () => JSON.stringify({
        reply: 'The server was restarted successfully.',
        operation: null,
      }),
    },
  });

  const response = await chat.sendMessage('Tell me what happened.', authorization);
  assert.equal(response.reply, 'The server was restarted successfully.');
  assert.equal(response.source, 'local-model');
  assert.equal(response.verified, false);
  assert.deepEqual(queue.list(authorization), []);
});

test('Ollama client refuses external destinations and invalid model names', () => {
  for (const baseUrl of [
    'https://example.com',
    'http://example.com',
    'http://127.0.0.1:11434/path',
  ]) {
    assert.throws(() => new OllamaClient({ baseUrl, model: 'local-model' }), {
      message: 'ollama_must_use_loopback_http',
    });
  }
  assert.throws(() => new OllamaClient({ model: 'model name' }), {
    message: 'invalid_ollama_model',
  });
});

test('Ollama client checks installed models and requests bounded structured chat', async () => {
  const requests = [];
  const client = new OllamaClient({
    model: 'local-model',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'local-model' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        message: { content: '{"reply":"Witaj","operation":null}' },
      }), { status: 200 });
    },
  });

  assert.deepEqual(await client.listModels(), ['local-model']);
  assert.equal(await client.chat([{ role: 'user', content: 'Cześć' }]), '{"reply":"Witaj","operation":null}');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[1].options.method, 'POST');
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.model, 'local-model');
  assert.equal(body.stream, false);
  assert.equal(body.format, 'json');
  assert.equal(requests[1].options.redirect, 'error');
});

test('Ollama failures and oversized provider responses fail without returning provider data', async () => {
  const failed = new OllamaClient({
    model: 'local-model',
    fetchImpl: async () => new Response('private provider details', { status: 500 }),
  });
  await assert.rejects(failed.listModels(), (error) =>
    error instanceof OllamaClientError && error.code === 'provider_request_failed' &&
    !error.message.includes('private provider details'));

  const oversized = new OllamaClient({
    model: 'local-model',
    fetchImpl: async () => new Response('x'.repeat(1_000_001), { status: 200 }),
  });
  await assert.rejects(oversized.listModels(), { code: 'provider_response_too_large' });
});

test('chat messages are bounded and history is operator-authorized', async () => {
  const chat = new ChatService({
    queue: createQueue(),
    operatorToken,
    model: { chat: async () => '{"reply":"OK","operation":null}' },
  });
  await assert.rejects(chat.sendMessage('   ', authorization), { code: 'invalid_message' });
  await assert.rejects(chat.sendMessage('x'.repeat(4097), authorization), { code: 'invalid_message' });
  assert.throws(() => chat.history(), { code: 'unauthorized' });
});
