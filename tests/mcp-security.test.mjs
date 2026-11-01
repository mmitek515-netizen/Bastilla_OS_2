import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf("app.all(['/api/mcp', '/mcp']");
const handler = start < 0 ? '' : server.slice(start, start + 5500);

test('MCP JSON-RPC handler exists and supports handshake and discovery', () => {
  assert.ok(start >= 0, 'MCP endpoint missing');
  for (const method of ['initialize', 'tools/list', 'tools/call', 'ping']) {
    assert.ok(handler.includes("case '" + method + "'"), 'Missing MCP method: ' + method);
  }
});

test('MCP tool execution must have authentication gate', () => {
  assert.ok(start >= 0, 'MCP endpoint missing');
  const toolCall = handler.indexOf("case 'tools/call'");
  assert.ok(toolCall >= 0, 'tools/call missing');
  const beforeToolCall = handler.slice(0, toolCall);
  assert.match(beforeToolCall, /(?:authorization|authenticate|requireAuth|verifyToken|authMiddleware)/i,
    'SECURITY BLOCKER: MCP tool execution has no visible authorization check before tools/call. Do not expose publicly.');
});
