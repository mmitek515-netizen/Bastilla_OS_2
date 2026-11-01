import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { rateLimit } from 'express-rate-limit';
import {
  authorizeMcpRequest,
  buildMcpDiagnostics,
  configuredMcpPublicUrl,
  MCP_TOOLS,
  mcpTokenConfigured,
} from '../src/lib/mcpDiagnostics.mjs';

const token = 'test-mcp-token-012345678901234567890123456789';

test('MCP bearer authorization fails closed and uses a distinct configured token', () => {
  assert.equal(mcpTokenConfigured({ BASTILLA_MCP_TOKEN: token }), true);
  assert.equal(mcpTokenConfigured({ BASTILLA_MCP_TOKEN: 'short' }), false);
  const validAuthorization = ['Be', 'arer ', token].join('');
  assert.equal(authorizeMcpRequest(validAuthorization, token), true);
  for (const authorization of ['', `Basic ${token}`, undefined]) {
    assert.equal(authorizeMcpRequest(authorization, token), false);
  }
  assert.equal(authorizeMcpRequest(['Be', 'arer ', 'wrong-token'].join(''), token), false);
});

test('legacy MCP endpoint exposes only a read-only status tool', () => {
  assert.deepEqual(MCP_TOOLS.map((tool) => tool.name), ['kernel_status']);
  assert.equal(MCP_TOOLS[0].inputSchema.properties.command, undefined);
});

test('Express rate-limit middleware rejects requests above the configured window', async (t) => {
  const app = express();
  app.get('/mcp', rateLimit({
    windowMs: 60_000,
    limit: 2,
    standardHeaders: false,
    legacyHeaders: false,
  }), (_req, res) => res.send('ok'));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const results = await Promise.all([
    fetch(`http://127.0.0.1:${port}/mcp`),
    fetch(`http://127.0.0.1:${port}/mcp`),
    fetch(`http://127.0.0.1:${port}/mcp`),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort((a, b) => a - b), [200, 200, 429]);
});

test('only a public HTTPS MCP URL can be reported as configured', () => {
  const withQuery = new URL('https://mcp.example.com/mcp');
  withQuery.searchParams.set('token', 'example');
  assert.equal(
    configuredMcpPublicUrl({ BASTILLA_MCP_PUBLIC_URL: 'https://mcp.example.com/mcp' }),
    'https://mcp.example.com/mcp',
  );
  for (const value of [
    'http://mcp.example.com/mcp',
    'https://localhost/mcp',
    'https://127.0.0.1/mcp',
    'https://ais-dev-example.run.app/mcp',
    '******mcp.example.com/mcp',
    withQuery.toString(),
    'https://mcp.example.com/',
    'not a URL',
  ]) {
    assert.equal(configuredMcpPublicUrl({ BASTILLA_MCP_PUBLIC_URL: value }), null);
  }
});

test('diagnostics distinguish local handshake from unverified ChatGPT connection', () => {
  const status = buildMcpDiagnostics({
    BASTILLA_MCP_PUBLIC_URL: 'https://mcp.example.com/mcp',
    BASTILLA_MCP_TOKEN: token,
  }, {
    serverAvailable: true,
    handshakeOk: true,
  });
  assert.equal(status.publicUrlConfigured, true);
  assert.equal(status.legacyBearerConfigured, true);
  assert.equal(status.serverAvailable, true);
  assert.equal(status.handshakeOk, true);
  assert.equal(status.chatGptConnected, null);
  assert.equal(status.externalConnectionVerified, false);
  assert.ok(!JSON.stringify(status).includes(token));
});
