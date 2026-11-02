import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startUpstreamDouble(t) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      contentType: request.headers['content-type'] ?? null,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Upstream-Header': 'must-not-be-relayed',
    });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())));
  return { port: server.address().port, requests };
}

async function startUiProxy(t, apiPort) {
  const port = await reserveLoopbackPort();
  const child = spawn('python3', ['debian13/ui/dev_server.py'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DEBIAN13_API_PORT: String(apiPort),
      DEBIAN13_UI_PORT: String(port),
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    let timeout;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 2000);
      }),
    ]);
    clearTimeout(timeout);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`UI proxy exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return baseUrl;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`UI proxy did not start: ${lastError?.message ?? 'unknown error'}`);
}

test('real loopback proxy allows only contract routes and normalizes upstream headers', async (t) => {
  const upstream = await startUpstreamDouble(t);
  const baseUrl = await startUiProxy(t, upstream.port);

  const status = await fetch(`${baseUrl}/api/v1/status`);
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(status.headers.get('x-upstream-header'), null);
  assert.equal(status.headers.get('content-security-policy')?.includes("default-src 'self'"), true);
  assert.deepEqual(await status.json(), { ok: true, path: '/api/v1/status' });

  const chat = await fetch(`${baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '/help', agent: 'aria' }),
  });
  assert.equal(chat.status, 200);
  assert.equal((await chat.json()).path, '/api/v1/chat');
  assert.equal(upstream.requests[1].contentType, 'application/json');
  assert.deepEqual(JSON.parse(upstream.requests[1].body), { message: '/help', agent: 'aria' });

  const denied = await fetch(`${baseUrl}/api/v1/events`);
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: 'Nie znaleziono endpointu API.' });
  assert.equal(upstream.requests.length, 2, 'disallowed path must not reach the upstream API');
});

test('real loopback proxy rejects oversized writes before forwarding', async (t) => {
  const upstream = await startUpstreamDouble(t);
  const baseUrl = await startUiProxy(t, upstream.port);
  const response = await fetch(`${baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(16_385),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Żądanie przekracza limit rozmiaru.' });
  assert.equal(upstream.requests.length, 0);
});
