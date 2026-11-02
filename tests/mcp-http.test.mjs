import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { createServer } from 'node:net';

async function reserveEphemeralPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

let port;
let url;
const token = 'mcp-ci-test-token-only-' + 'a'.repeat(48);

async function probe(headers = {}, body) {
  return fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
}

async function waitForServer(child) {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}`);
    try { const response = await probe(); if (response.status === 401 || response.status === 503) return; } catch {}
    await delay(500);
  }
  throw new Error('Server did not respond within 45 seconds');
}

test('live MCP HTTP authentication and JSON-RPC handshake', { timeout: 65000 }, async () => {
  port = await reserveEphemeralPort();
  url = `http://127.0.0.1:${port}/api/mcp`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), BASTILLA_MCP_TOKEN: token,
      LLM_PROVIDERS: 'without_nlp', AUTO_GIT_SYNC: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk.toString()).slice(-4000); });
  try {
    await waitForServer(child);
    assert.equal((await probe()).status, 401, 'missing token must be rejected');
    assert.equal((await probe({ Authorization: 'Bearer incorrect' })).status, 401, 'wrong token must be rejected');
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await probe(headers)).status, 200);
    const initialize = await probe(headers, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ci', version: '1' } } });
    assert.equal(initialize.status, 200);
    assert.equal((await initialize.json()).result.serverInfo.name, 'bastillaos-astyria-mcp');
    const tools = await probe(headers, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(tools.status, 200);
    assert.ok(Array.isArray((await tools.json()).result.tools));
    const invalid = await probe(headers, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'not-a-tool', arguments: {} } });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, -32602);
    const sse = await fetch(`http://127.0.0.1:${port}/api/mcp/sse`, { signal: AbortSignal.timeout(3000) });
    assert.equal(sse.status, 401);
    await sse.body?.cancel();
  } catch (error) {
    throw new Error(`${error.message}\nServer output:\n${output}`);
  } finally {
    child.kill('SIGTERM');
  }
});
