import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeMcpRequest,
  buildMcpDiagnostics,
  configuredMcpPublicUrl,
  createMcpRateLimiter,
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

test('legacy MCP request limits enforce window resets and bounded client state', () => {
  let time = 0;
  const limiter = createMcpRateLimiter({ limit: 2, windowMs: 1000, maxClients: 2, now: () => time });
  assert.equal(limiter('client-a').allowed, true);
  assert.equal(limiter('client-a').allowed, true);
  assert.deepEqual(limiter('client-a'), { allowed: false, retryAfterSeconds: 1 });
  assert.equal(limiter('client-b').allowed, true);
  assert.deepEqual(limiter('client-c'), { allowed: false, retryAfterSeconds: 1 });
  time = 1000;
  assert.equal(limiter('client-c').allowed, true);
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
