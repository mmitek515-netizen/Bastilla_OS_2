import { createServer } from 'node:http';
import { mkdirSync, readdirSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApprovalQueue, ApprovalQueueError } from './approval-queue.mjs';
import { isOperatorAuthorized, isOperatorTokenConfigured } from './authorization.mjs';
import { ChatService, ChatServiceError } from './chat-service.mjs';
import { OllamaClient } from './ollama-client.mjs';
import { JsonStateStore } from './state-store.mjs';

export const API_VERSION = 'v1';
export const MAX_API_BODY_BYTES = 16_384;
const MAX_API_MESSAGE_LENGTH = 12_000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 100;
const MAX_TASKS = 100;
const MAX_EVENTS = 200;
const MAX_TASK_RESULT_BYTES = 16_000;
const AGENTS = {
  aria: { name: 'Aria', role: 'Interfejs, dostępność i wygoda obsługi.' },
  astyria: { name: 'Astyria', role: 'Intencje czatu i bezpieczne, kontrolowane operacje.' },
  aurelius: { name: 'Aurelius', role: 'Testy, bezpieczeństwo i prywatność.' },
  alex: { name: 'Alex', role: 'Architektura, backend i integracja.' },
};

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function now() {
  return new Date().toISOString();
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    ...(status === 401 ? { 'WWW-Authenticate': ['Bear', 'er realm="debian13-chat"'].join('') } : {}),
  });
  response.end(body);
}

async function readJson(request, response) {
  if ((request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(400, 'content_type_required');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
    throw new ApiError(411, 'content_length_required');
  }
  if (declaredLength > MAX_API_BODY_BYTES) {
    request.resume();
    throw new ApiError(413, 'request_too_large');
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_API_BODY_BYTES) {
      request.resume();
      throw new ApiError(413, 'request_too_large');
    }
    chunks.push(chunk);
  }
  if (length !== declaredLength) throw new ApiError(400, 'invalid_content_length');

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApiError(400, 'json_object_required');
  }
  return payload;
}

function apiAgents() {
  return Object.entries(AGENTS).map(([id, profile]) => ({
    id,
    ...profile,
    status: 'profile_configured',
    worker: 'not_running',
    model_backend: 'shared_ollama_adapter',
  }));
}

function operatingSystemRuntime() {
  const releaseInfo = {};
  try {
    for (const line of readFileSync('/etc/os-release', 'utf8').split('\n')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length) releaseInfo[key] = valueParts.join('=').replace(/^"|"$/g, '');
    }
  } catch {
    // Report unknown runtime details when the host does not expose os-release.
  }
  return {
    platform: platform(),
    distribution: releaseInfo.PRETTY_NAME || 'nieznana',
    debian_13_boot_verified: releaseInfo.ID === 'debian' && releaseInfo.VERSION_ID === '13',
  };
}

function mapMessage(message) {
  return {
    role: message.role,
    content: message.content,
    agent: message.agent || 'astyria',
    source: message.source === 'local-model' ? 'ollama' : message.source,
    created_at: message.createdAt,
  };
}

function apiSource(source) {
  return source === 'local-model' ? 'ollama' : source;
}

function boundedTaskResult(result) {
  if (typeof result !== 'string' || Buffer.byteLength(result, 'utf8') <= MAX_TASK_RESULT_BYTES) {
    return result;
  }
  const marker = '\n[treść skrócona]';
  const limit = MAX_TASK_RESULT_BYTES - Buffer.byteLength(marker, 'utf8');
  let bytes = 0;
  let prefix = '';
  for (const character of result) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > limit) break;
    prefix += character;
    bytes += characterBytes;
  }
  return prefix + marker;
}

function mapTask(task) {
  return {
    id: task.id,
    agent: task.agent,
    kind: task.kind,
    status: task.status,
    created_at: task.created_at,
    updated_at: task.updated_at,
    result: boundedTaskResult(task.result),
    error: task.error,
  };
}

function taskEvent(store, task, status) {
  const timestamp = now();
  store.update((state) => {
    const saved = state.tasks.find((item) => item.id === task.id);
    if (saved) {
      saved.status = status;
      saved.updated_at = timestamp;
      saved.result = boundedTaskResult(task.result);
      saved.error = task.error;
    } else {
      state.tasks.push({ ...task, result: boundedTaskResult(task.result), status, updated_at: timestamp });
    }
    state.tasks = state.tasks.slice(-MAX_TASKS);
    state.events.push({
      at: timestamp,
      type: `task.${status}`,
      agent: task.agent,
      task_id: task.id,
    });
    state.events = state.events.slice(-MAX_EVENTS);
  });
}

function makeTask(store, agent, kind = 'chat') {
  const task = {
    id: randomUUID(),
    agent,
    kind,
    status: 'queued',
    created_at: now(),
    updated_at: now(),
    result: null,
    error: null,
  };
  taskEvent(store, task, 'queued');
  return task;
}

function readOnlyTerminal(workspace, command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 500) {
    throw new ApiError(400, 'invalid_terminal_command');
  }
  const [operation, ...arguments_] = command.trim().split(/\s+/);
  if (operation === 'pwd' && arguments_.length === 0) return '.';
  if (operation === 'ls' && arguments_.length === 0) {
    try {
      return readdirSync(workspace).sort().join('\n') || '(pusty katalog)';
    } catch {
      throw new ApiError(400, 'workspace_unavailable');
    }
  }
  if (operation !== 'cat' || arguments_.length !== 1) {
    throw new ApiError(400, 'unsupported_terminal_command');
  }

  const relativePath = arguments_[0];
  if (
    isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(relativePath) ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new ApiError(400, 'invalid_workspace_path');
  }
  const target = resolve(workspace, relativePath);
  const targetRelative = relative(workspace, target);
  if (targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
    throw new ApiError(400, 'invalid_workspace_path');
  }

  try {
    if (lstatSync(target).isSymbolicLink()) throw new ApiError(400, 'invalid_workspace_path');
    const realTarget = realpathSync(target);
    const realRelative = relative(workspace, realTarget);
    if (
      !realRelative ||
      realRelative.startsWith('..') ||
      isAbsolute(realRelative) ||
      !lstatSync(realTarget).isFile()
    ) {
      throw new ApiError(400, 'invalid_workspace_path');
    }
    const bytes = readFileSync(realTarget);
    if (bytes.length > 64_000) throw new ApiError(400, 'workspace_file_too_large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'workspace_file_unavailable');
  }
}

function isSessionId(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function createSession(store, requestedId) {
  const state = store.read();
  const timestamp = Date.now();
  for (const [id, session] of Object.entries(state.sessions)) {
    if (timestamp - Date.parse(session.last_access || session.updated_at) > SESSION_TTL_MS) {
      delete state.sessions[id];
    }
  }

  if (requestedId !== undefined) {
    if (!isSessionId(requestedId) || !state.sessions[requestedId]) {
      throw new ApiError(404, 'session_not_found');
    }
    const session = state.sessions[requestedId];
    session.last_access = new Date(timestamp).toISOString();
    store.update((next) => {
      next.sessions[requestedId].last_access = session.last_access;
      for (const [id, current] of Object.entries(next.sessions)) {
        if (timestamp - Date.parse(current.last_access || current.updated_at) > SESSION_TTL_MS) {
          delete next.sessions[id];
        }
      }
    });
    return requestedId;
  }

  while (Object.keys(state.sessions).length >= MAX_SESSIONS) {
    const oldest = Object.keys(state.sessions).sort((left, right) =>
      Date.parse(state.sessions[left].last_access || state.sessions[left].updated_at) -
      Date.parse(state.sessions[right].last_access || state.sessions[right].updated_at))[0];
    delete state.sessions[oldest];
  }
  const id = randomUUID();
  const timestampText = new Date(timestamp).toISOString();
  state.sessions[id] = {
    id,
    created_at: timestampText,
    updated_at: timestampText,
    last_access: timestampText,
    messages: [],
  };
  store.update((next) => {
    next.sessions = state.sessions;
  });
  return id;
}

function chatError(error) {
  if (error instanceof ChatServiceError) {
    if (error.code === 'model_unavailable') return new ApiError(503, error.code);
    if (error.code === 'session_not_found') return new ApiError(404, error.code);
    return new ApiError(400, error.code);
  }
  if (error instanceof ApprovalQueueError) {
    const status = error.code === 'unauthorized' ? 401
      : error.code === 'not_found' ? 404
        : ['queue_full', 'already_decided', 'stale_version'].includes(error.code) ? 409 : 400;
    return new ApiError(status, error.code);
  }
  return new ApiError(500, 'chat_error');
}

function makeChatHandler({ store, chat, sessionLocks, workspaceRoot }) {
  return async (request, response, payload, streaming) => {
    if (
      !Object.hasOwn(payload, 'message') ||
      !Object.hasOwn(payload, 'agent') ||
      Object.keys(payload).some((key) => !['message', 'agent', 'session_id'].includes(key))
    ) {
      throw new ApiError(400, 'invalid_chat_request');
    }
    if (
      typeof payload.message !== 'string' ||
      !payload.message.trim() ||
      [...payload.message].length > MAX_API_MESSAGE_LENGTH ||
      typeof payload.agent !== 'string' ||
      !Object.hasOwn(AGENTS, payload.agent) ||
      (payload.session_id !== undefined && typeof payload.session_id !== 'string')
    ) {
      throw new ApiError(400, 'invalid_chat_request');
    }

    const sessionId = createSession(store, payload.session_id);
    const previous = sessionLocks.get(sessionId) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const task = makeTask(store, payload.agent);
      taskEvent(store, task, 'running');
      let sendSse;
      if (streaming) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-store',
          'X-Accel-Buffering': 'no',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
          'X-Content-Type-Options': 'nosniff',
        });
        sendSse = (event, data) => {
          if (!response.destroyed) {
            response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          }
        };
        sendSse('meta', { session_id: sessionId, task_id: task.id });
      }
      try {
        const message = payload.message.trim();
        if (
          message.startsWith('/') &&
          !['/help', '/status'].includes(message) &&
          !message.startsWith('/terminal ')
        ) {
          throw new ApiError(400, 'unsupported_chat_command');
        }
        const result = message.startsWith('/terminal ')
          ? chat.recordLocalResponse(
              message,
              readOnlyTerminal(workspaceRoot, message.slice('/terminal '.length).trim()),
              request.headers.authorization,
              sessionId,
              payload.agent,
              'restricted_terminal',
            )
          : await chat.sendMessage(
              message,
              request.headers.authorization,
              sessionId,
              payload.agent,
            );
        task.result = result.reply;
        taskEvent(store, task, 'completed');
        const body = {
          reply: result.reply,
          source: apiSource(result.source),
          agent: payload.agent,
          session_id: sessionId,
          task: mapTask({ ...task, status: 'completed', updated_at: now() }),
        };
        if (result.operation) {
          body.operation = result.operation;
          body.notice = result.notice;
        }
        if (streaming) {
          const characters = Array.from(result.reply);
          for (let index = 0; index < characters.length; index += 64) {
            sendSse('delta', { text: characters.slice(index, index + 64).join('') });
          }
          sendSse('done', {
            session_id: sessionId,
            source: apiSource(result.source),
            agent: payload.agent,
            task: { id: task.id, status: 'completed' },
          });
          if (!response.destroyed) response.end();
        } else {
          sendJson(response, 200, body);
        }
      } catch (error) {
        const mappedError = error instanceof ApiError ? error : chatError(error);
        task.error = mappedError.code;
        taskEvent(store, task, 'failed');
        if (streaming && response.headersSent) {
          sendSse('error', {
            error: mappedError.code,
            task: mapTask({ ...task, status: 'failed', updated_at: now() }),
          });
          if (!response.destroyed) response.end();
          return;
        }
        if (!response.headersSent) {
          sendJson(response, mappedError.status, {
            error: mappedError.code,
            task: mapTask({ ...task, status: 'failed', updated_at: now() }),
            session_id: sessionId,
          });
          return;
        }
        if (!response.destroyed) response.destroy();
      }
    });
    sessionLocks.set(sessionId, current);
    try {
      await current;
    } finally {
      if (sessionLocks.get(sessionId) === current) sessionLocks.delete(sessionId);
    }
  };
}

export function createApiServer({
  token,
  store = new JsonStateStore(join(homedir(), '.local', 'state', 'debian13-chat', 'state.json')),
  queue = null,
  model = null,
  modelStatus = null,
  workspace = join(homedir(), '.local', 'share', 'debian13-chat', 'workspace'),
  host = '127.0.0.1',
  port = 8765,
} = {}) {
  if (!isOperatorTokenConfigured(token)) throw new TypeError('operator_token_required');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new TypeError('loopback_bind_required');
  }
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) {
    throw new TypeError('absolute_workspace_path_required');
  }
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const workspaceRoot = realpathSync(workspace);
  const approvalQueue = queue || new ApprovalQueue({ operatorToken: token, store });
  const chat = new ChatService({
    model,
    queue: approvalQueue,
    operatorToken: token,
    store,
    maxHistory: 40,
  });
  const resolvedModelStatus = modelStatus || {
    provider: 'ollama',
    status: model
      ? (typeof model.modelName === 'string' ? 'model_available' : 'unavailable')
      : 'not_configured',
    model: typeof model?.modelName === 'string' ? model.modelName : null,
    inference: 'not_verified',
  };
  const sessionLocks = new Map();
  const chatHandler = makeChatHandler({ store, chat, sessionLocks, workspaceRoot });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const path = url.pathname;
      const apiPrefix = `/api/${API_VERSION}`;
      if (!path.startsWith(`${apiPrefix}/`)) throw new ApiError(404, 'not_found');
      if (!isOperatorAuthorized(token, request.headers.authorization)) {
        throw new ApiError(401, 'unauthorized');
      }

      if (request.method === 'GET') {
        if (path === `${apiPrefix}/status`) {
          const currentModelStatus = structuredClone(resolvedModelStatus);
          if (model?.inferenceVerified === true) currentModelStatus.inference = 'verified';
          sendJson(response, 200, {
            api_version: API_VERSION,
            application: { status: 'running', product: 'Debian 13 chat' },
            operating_system: { target: 'Debian 13', runtime: operatingSystemRuntime() },
            model: currentModelStatus,
            task_state: 'persistent; local JSON state',
            agents: apiAgents(),
          });
          return;
        }
        if (path === `${apiPrefix}/agents`) {
          sendJson(response, 200, { agents: apiAgents() });
          return;
        }
        if (path === `${apiPrefix}/tasks`) {
          sendJson(response, 200, { tasks: store.read().tasks.slice().reverse() });
          return;
        }
        if (path === `${apiPrefix}/events`) {
          sendJson(response, 200, { events: store.read().events.slice().reverse() });
          return;
        }
        if (path === `${apiPrefix}/operations`) {
          sendJson(response, 200, { operations: approvalQueue.list(request.headers.authorization) });
          return;
        }
        if (path === `${apiPrefix}/operations/audit`) {
          const events = approvalQueue.auditEntries(request.headers.authorization).map((entry) => ({
            type: entry.event,
            operation_id: entry.operationId,
            at: entry.at,
          }));
          sendJson(response, 200, { events });
          return;
        }
        const historyMatch = path.match(/^\/api\/v1\/sessions\/([^/]+)\/messages$/);
        if (historyMatch) {
          let sessionId;
          try {
            sessionId = decodeURIComponent(historyMatch[1]);
          } catch {
            throw new ApiError(404, 'session_not_found');
          }
          createSession(store, sessionId);
          const messages = chat.history(request.headers.authorization, sessionId).messages.map(mapMessage);
          sendJson(response, 200, { session_id: sessionId, messages });
          return;
        }
        throw new ApiError(404, 'not_found');
      }

      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      const decisionMatch = path.match(/^\/api\/v1\/operations\/([^/]+)\/decision$/);
      if (decisionMatch) {
        const payload = await readJson(request, response);
        if (
          Object.keys(payload).length !== 2 ||
          !Object.hasOwn(payload, 'decision') ||
          !Object.hasOwn(payload, 'expected_version')
        ) {
          throw new ApiError(400, 'invalid_decision_request');
        }
        try {
          let operationId;
          try {
            operationId = decodeURIComponent(decisionMatch[1]);
          } catch {
            throw new ApiError(404, 'operation_not_found');
          }
          const operation = approvalQueue.decide(
            operationId,
            payload.decision,
            payload.expected_version,
            request.headers.authorization,
          );
          sendJson(response, 200, { operation });
        } catch (error) {
          throw chatError(error);
        }
        return;
      }
      if (path === `${apiPrefix}/terminal`) {
        const payload = await readJson(request, response);
        if (
          Object.keys(payload).length !== 1 ||
          !Object.hasOwn(payload, 'command') ||
          typeof payload.command !== 'string'
        ) {
          throw new ApiError(400, 'invalid_terminal_request');
        }
        const task = makeTask(store, 'alex', 'terminal');
        taskEvent(store, task, 'running');
        try {
          const output = readOnlyTerminal(workspaceRoot, payload.command);
          task.result = output;
          taskEvent(store, task, 'completed');
          sendJson(response, 200, {
            output,
            source: 'restricted_terminal',
            task: mapTask({ ...task, status: 'completed', updated_at: now() }),
          });
        } catch (error) {
          const mappedError = error instanceof ApiError ? error : new ApiError(400, 'terminal_error');
          task.error = mappedError.code;
          taskEvent(store, task, 'failed');
          sendJson(response, mappedError.status, {
            error: mappedError.code,
            task: mapTask({ ...task, status: 'failed', updated_at: now() }),
          });
        }
        return;
      }
      if (path === `${apiPrefix}/chat` || path === `${apiPrefix}/chat/stream`) {
        const payload = await readJson(request, response);
        await chatHandler(request, response, payload, path.endsWith('/stream'));
        return;
      }
      throw new ApiError(404, 'not_found');
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      if (error instanceof ApiError) {
        sendJson(response, error.status, { error: error.code });
        return;
      }
      if (error instanceof ApprovalQueueError || error instanceof ChatServiceError) {
        const mapped = chatError(error);
        sendJson(response, mapped.status, { error: mapped.code });
        return;
      }
      sendJson(response, 500, { error: 'internal_error' });
    }
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  const nativeListen = server.listen.bind(server);
  server.listen = (...arguments_) => {
    const first = arguments_[0];
    if (typeof first !== 'number' && (!first || typeof first !== 'object')) {
      throw new TypeError('loopback_tcp_only');
    }
    if (first && typeof first === 'object') {
      if (Object.keys(first).some((key) => !['port', 'host', 'backlog', 'exclusive', 'ipv6Only', 'reusePort'].includes(key))) {
        throw new TypeError('loopback_tcp_only');
      }
      const options = { ...first, host: first.host || host };
      if (!['127.0.0.1', '::1', 'localhost'].includes(options.host)) {
        throw new TypeError('loopback_bind_required');
      }
      arguments_[0] = options;
    } else {
      if (typeof arguments_[1] === 'string') {
        if (!['127.0.0.1', '::1', 'localhost'].includes(arguments_[1])) {
          throw new TypeError('loopback_bind_required');
        }
      } else {
        arguments_.splice(1, 0, host);
      }
    }
    return nativeListen(...arguments_);
  };
  return server;
}

export async function startApiServer({
  token = process.env.DEBIAN13_CHAT_OPERATOR_TOKEN,
  port = Number(process.env.DEBIAN13_PORT || 8765),
  statePath = process.env.DEBIAN13_CHAT_STATE_PATH ||
    join(homedir(), '.local', 'state', 'debian13-chat', 'state.json'),
  workspace = join(homedir(), '.local', 'share', 'debian13-chat', 'workspace'),
  modelName = process.env.DEBIAN13_OLLAMA_MODEL,
} = {}) {
  const store = new JsonStateStore(statePath);
  let model = null;
  let modelStatus = {
    provider: 'ollama',
    status: modelName ? 'unavailable' : 'not_configured',
    model: modelName || null,
    inference: 'not_verified',
  };
  if (modelName) {
    try {
      const candidate = new OllamaClient({ model: modelName });
      if ((await candidate.listModels()).includes(modelName)) {
        model = candidate;
        modelStatus.status = 'model_available';
      } else {
        modelStatus.status = 'model_missing';
        console.error(`AI unavailable: configured Ollama model ${modelName} is not installed.`);
      }
    } catch (error) {
      modelStatus.status = 'unavailable';
      console.error(`AI unavailable: ${error.code || 'provider_error'}.`);
    }
  } else {
    console.error('AI unavailable: set DEBIAN13_OLLAMA_MODEL and start local Ollama.');
  }
  const server = createApiServer({ token, store, model, modelStatus, workspace, port });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`Debian 13 chat API v1 listening on http://127.0.0.1:${server.address().port}`);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await startApiServer();
  } catch (error) {
    console.error(error.code || error.message || 'api_start_failed');
    process.exitCode = 1;
  }
}
