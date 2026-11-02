# Debian 13 integration status

This note describes only the standalone `debian13/` demo on this branch. Other
open PRs are independent proposals and are not merged or running workers.

## MCP

`python3 debian13/mcp_server.py` starts a local stdio JSON-RPC server. It supports
the MCP `2025-03-26` initialization handshake, `notifications/initialized`,
`ping`, `tools/list`, and two read-only tools: `system_status` and
`system_diagnostics`. Tool data comes from the same `DemoApplication` methods as
the `/api/v1/status` and `/api/v1/diagnostics` HTTP routes. No shell, write, or
approval tools are exposed. Stdio is a local process transport; this does not
prove that an external MCP client has connected.

The test starts the actual server process, exchanges MCP JSON-RPC messages over
stdin/stdout, and verifies tool results and rejected execution-shaped input:

```sh
python3 -m unittest discover -s debian13/tests -p 'test_mcp_server.py' -v
```

## GPT Actions

Not implemented or connected for the standalone demo. The loopback HTTP API is
not an HTTPS GPT Actions deployment; there is no public OpenAPI endpoint,
operator authentication boundary, or external action handshake here. Keep the
listener private. A future Actions adapter must agree on v1 schemas, authenticate
requests server-side, and require explicit approval for every state-changing
operation before it can be exposed.

## Codex

No Codex worker, account connection, or background execution is configured or
claimed. This repository provides source and test instructions only; availability
of a `codex` executable does not establish an authenticated Codex integration.

## Cross-PR contract coordination

- **PR #97 reference:** `/api/v1/status`, `/api/v1/diagnostics`, profiles, tasks,
  events, sessions, chat/SSE, and read-only terminal. The MCP tools reuse the
  status and diagnostics application methods and add no competing HTTP route.
- **PR #94 UI:** its proxy and UI are a separate branch; add the diagnostics path
  to its allowlist only when integrating against an agreed API/auth contract.
- **PR #95 chat:** its authenticated API adapter and proposal/decision endpoints
  are extensions, not currently merged into this reference service. MCP here
  exposes no proposal mutations.
- **PR #96 runtime:** its bearer-authenticated `/v1/*` service is a separate
  runtime shape. Do not point this local MCP adapter or UI at it without an
  approved versioned contract and corresponding auth design.

The repository's Debian 13 workflow already discovers `debian13/tests`; the
stdio protocol test therefore joins its existing test step without widening
workflow permissions. GitHub Actions for PR #97 can remain blocked by
`action_required`; local passing tests do not clear that gate.
