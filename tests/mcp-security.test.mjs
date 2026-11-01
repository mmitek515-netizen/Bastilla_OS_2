import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf("app.all(['/api/mcp', '/mcp']");
const handler = start < 0 ? '' : server.slice(start, start + 5500);
const sseStart = server.indexOf("app.get('/api/mcp/sse'");
const sse = sseStart < 0 ? '' : server.slice(sseStart, sseStart + 500);
const authStart = server.indexOf('function authorizeMcp(');
const auth = authStart < 0 ? '' : server.slice(authStart, authStart + 1150);

test('MCP JSON-RPC handler exists and supports handshake and discovery', () => {
  assert.ok(start >= 0, 'MCP endpoint missing');
  for (const method of ['initialize', 'tools/list', 'tools/call', 'ping']) {
    assert.ok(handler.includes("case '" + method + "'"), 'Missing MCP method: ' + method);
  }
});

test('MCP RPC and SSE must both enforce authorization before processing', () => {
  assert.ok(start >= 0 && sseStart >= 0, 'MCP endpoint missing');
  assert.match(handler.slice(0, 350), /if \(!authorizeMcp\(req, res\)\) return;/);
  assert.match(sse.slice(0, 220), /if \(!authorizeMcp\(req, res\)\) return;/);
});

test('MCP must fail closed without a dedicated sufficiently long token', () => {
  assert.ok(authStart >= 0, 'MCP authorization helper missing');
  assert.match(server, /BASTILLA_MCP_TOKEN/);
  assert.match(auth, /mcpAccessToken\.length < 32/);
  assert.match(auth, /status\(503\)/);
  assert.match(auth, /status\(401\)/);
  assert.match(auth, /timingSafeEqual/);
});

test('MCP RPC must not permit wildcard CORS origin', () => {
  assert.doesNotMatch(handler.slice(0, 600), /Access-Control-Allow-Origin.*\*/);
});

// These source-level tests are regression guards, not HTTP or external-client proof.

test('MCP tools/call validates tool name and argument shape', () => {
  assert.match(handler, /MCP_TOOLS\.some\(\(tool\) => tool\.name === toolName\)/);
  assert.match(handler, /Array\.isArray\(toolArguments\)/);
  assert.match(handler, /Invalid MCP tool name or arguments/);
});

test('MCP JSON-RPC does not expose exception messages', () => {
  assert.match(handler, /Internal MCP error/);
  assert.doesNotMatch(handler, /error\?\.message/);
});
