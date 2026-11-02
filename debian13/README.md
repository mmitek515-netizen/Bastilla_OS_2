# Debian 13 system demo

This directory is a new, standalone user-space demo. It does not modify or
replace the older Bastilla OS 2 application, and it is not a Debian installer,
VM image, or verified Debian boot.

## Status and active work

- **Application:** a local Python HTTP application with chat, agent profiles,
  read-only terminal commands, in-memory sessions/tasks, streamed chat, and a
  small web UI.
- **Profiles:** Aria, Astyria, Aurelius, and Alex are configured role profiles.
  They are not four running agents or processes.
- **Model execution:** disabled until `DEBIAN13_OLLAMA_MODEL` is set and that
  model is found through the local Ollama `/api/tags` endpoint. Only an actual
  successful `/api/chat` response is reported as verified inference.
- **OS:** the target is Debian 13. The status endpoint checks the actual
  `/etc/os-release`; running this app does not demonstrate a Debian 13 boot.
- **Persistence:** sessions, chat history, tasks, and audit events are
  process-local and cleared on restart. Sessions expire after one hour of
  inactivity and retain at most 40 messages and 64 kB of text. Task result
  previews are capped at 16 kB. Session IDs are unguessable identifiers, not
  authentication.

No paid service is started. The default local Ollama demo requires no API token.
The optional system-service adapter requires a server-side bearer token and
never exposes it to the browser.

## Contract v1

All paths are rooted at `/api/v1`. JSON errors use `{"error": "..."}`.

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/status` | Actual app, OS, local model, profile, and task-storage status. |
| `GET /api/v1/diagnostics` | Read-only runtime/resources, KVM device access, QEMU/Docker binary presence, model and agent status. Does not verify VM boot or service readiness; MCP/GPT Actions remain unimplemented and untested. |
| `GET /api/v1/agents` | Four configured profile identities/roles; explicitly not worker processes. |
| `GET /api/v1/tasks` | Recent in-memory tasks with `queued`, `running`, `completed`, or `failed` state. |
| `GET /api/v1/events` | Bounded in-memory task lifecycle audit entries; prompts and secrets are excluded. |
| `GET /api/v1/sessions/{session_id}/messages` | Read the bounded chat history for a live in-memory session. |
| `POST /api/v1/chat` | `{"message":"...", "agent":"aria"}`; optionally accepts an existing `session_id`. Creates a session otherwise and returns its ID. Routes `/help`, `/status`, and `/terminal ...` locally, otherwise calls the configured Ollama model or optional authenticated system-service adapter with that session's context. Model output is text only and is never executed. |
| `POST /api/v1/chat/stream` | Same JSON request as `/chat`; streams `meta`, `delta`, then `done` or `error` events as Server-Sent Events. Only completed responses enter session history. The system-service protocol is non-streaming; in that mode the gateway emits deltas only after the upstream response completes. |
| `POST /api/v1/terminal` | `{"command":"pwd"}`; only read-only `pwd`, `ls`, and `cat <relative-file>` in `workspace/` are accepted. No shell is invoked. |
| `GET /api/v1/operations` | Proposed shared approval extension: `{"operations":[...]}`; requires operator bearer authorization. Not yet implemented by this gateway. |
| `GET /api/v1/operations/audit` | Proposed queue audit: `{"events":[{"type":"operation.proposed","operation_id":"...","at":"..."}]}`; requires operator bearer authorization. |
| `POST /api/v1/operations/{id}/decision` | Proposed decision body `{"decision":"approve"|"reject","expected_version":1}`; responds `{"operation":{...}}`. Recording a decision does not execute the operation. |

Tasks are created with a UUID and returned in the response. A model outage marks
the task `failed` and returns HTTP 503 without substituting a fake response.
There are no write actions in this first stage; adding them requires explicit
authorization and an approval contract before implementation.
For streaming requests, a pre-stream error uses a normal JSON error response;
errors after streaming starts use an SSE `error` event and mark the task failed.
Disconnecting a client stops forwarding model output; a partially streamed
response is not saved as a completed conversation turn.
Only completed model exchanges are forwarded as context to later model requests;
local terminal and status output stays out of that context.

The diagnostics endpoint reads local runtime details and tool availability only;
it does not attempt MCP, GPT Actions, Codex, external network, VM boot, or Docker
daemon connections. KVM permission failures and missing devices are distinct;
QEMU/Docker results report binary presence only. Unavailable memory metrics are
reported as unavailable. Profiles remain configured roles, not active workers.

## Run locally

Python 3.11+ standard library only:

```sh
python3 debian13/server.py
```

Open `http://127.0.0.1:8765`. The server refuses non-loopback bind addresses.
The terminal API is intentionally read-only and the workspace is isolated from
the repository files. To use Ollama, start it yourself and set:

```sh
DEBIAN13_OLLAMA_MODEL=your-installed-model python3 debian13/server.py
```

The Ollama adapter only accepts the local Ollama HTTP API. Do not put keys or
secrets in the model name or chat prompt.

To route non-local chat through the separate authenticated service in PR #96,
set `DEBIAN13_SYSTEM_API_URL` and `DEBIAN13_SYSTEM_API_TOKEN` in the gateway
process. The token must be the same value configured as `DEBIAN13_API_TOKEN`
in that service and contain at least 32 bytes. HTTP is accepted only for a
loopback URL; other origins must use HTTPS. The adapter calls only
`GET /v1/profiles` and `POST /v1/chat`, rejects redirects, bounds response size,
and applies a timeout. If either setting is absent, it does not call the
service or fall back to another model. The `/v1/chat` service accepts one
message and a profile; the gateway packs bounded session context into that
message because the service does not yet expose session or streaming routes.

The service token is a server-to-server credential: never put it in browser
storage, HTML, JavaScript, or a request URL. For a service on another host,
place both services behind a trusted HTTPS network boundary.

## Run in the Debian 13 Codespace

The merged PR #108 profile opens `/workspaces/<repository>/debian13`, forwards
port 3000 privately, and does not start an application automatically. In a
Codespace whose checkout contains this PR's demo files, run from that directory:

```sh
pwd
python3 --version
python3 -m unittest discover -s tests -v
python3 smoke_test.py
python3 browser_e2e.py
DEBIAN13_PORT=3000 python3 server.py
```

Open the private port 3000 from the Codespaces Ports panel. The browser test
requires Chromium or Chrome to be installed; it does not install a browser.
There is no `debian13/package-lock.json`, so the profile correctly skips `npm
ci`. Stop the server with Ctrl-C. Opening the profile alone proves neither that
the Codespace finished provisioning nor that the app, model, or agents started.

## Tests and isolated CI

```sh
python3 -m unittest discover -s debian13/tests -v
python3 debian13/smoke_test.py
python3 debian13/browser_e2e.py
```

`.github/workflows/debian13-demo.yml` runs the isolated Python contract/API
checks, Node 24 browser-client syntax check, and Chromium browser E2E over real loopback
HTTP when `debian13/**` or that workflow changes. Chromium/Chrome must be
available on the runner. The #95 Node package does not declare an engine range;
the isolated workflow explicitly uses Node 24 to match the root runtime policy.
No npm dependencies or paid services are involved.

## Shared v1 contract and compatibility matrix

The canonical browser-facing interface is the `/api/v1` contract above. The
comparison below is based on the open PR heads inspected on 2026-11-02; none is
merged into this branch. Their changes are not interchangeable implementations
of one API yet.

| Mission | Current interface in that PR | Compatibility with this v1 | Required integration |
| --- | --- | --- | --- |
| Aria UI · PR #94 (`591d38d`) | `debian13/ui` proxies fixed `/api/v1` status, agents, tasks, events, chat/SSE, sessions, and terminal routes over loopback. | **Chat compatible:** request fields, SSE names, sessions, and terminal path match. Its proxy does not allow operation queue routes or inject operator credentials. | Extend only the reviewed operation allowlist. Keep tokens out of browser code and preserve bounded proxy bodies. |
| Astyria chat · PR #95 (`6f02a2c`) | `debian13/chat` implements v1 chat/session/SSE, approval operations, task lookup/cancellation, and additive diagnostics; all routes currently require operator bearer authorization. | **Partial match:** all-route auth conflicts with the loopback UI proxy and current gateway. Cancellation/audit events and diagnostics are additive shapes not yet in the shared contract. Errors are structured `{error:{code}}`. | Agree how the server-side proxy supplies authorization, and agree task-cancellation/diagnostics schemas and error normalization. Keep decisions queue-only; do not copy this separate server. |
| Aurelius runtime · PR #96 (`b77a91d`) | `debian13/system` provides `/healthz`, `/v1/profiles`, `/v1/diagnostics`, `/v1/chat`, and `/v1/terminal`; all except liveness require a bearer token. It now includes readiness and adapter-integration smoke tools. | **Adapter compatible for chat/status:** service request and response fields differ from the browser v1 schema; system errors are nested objects. It has no chat sessions or SSE endpoint. | Use the server-side fixed-route adapter, normalize errors, and keep the service token out of the browser. Do not treat its terminal allowlist as the gateway's current terminal contract. |
| Alex integration · PR #97 (this branch) | `/api/v1/status`, `/agents`, `/tasks`, `/events`, `/sessions/{id}/messages`, `/chat`, `/chat/stream`, `/terminal`; now includes an optional server-side adapter for #96 chat. | **Contract owner/reference implementation.** Loopback-only; approval routes and operator authorization are not implemented here. | Maintain the shared v1 schema and contract tests; do not claim the open draft branches are integrated. |

### Shared request, response, error, and event shapes

- **Browser chat:** `POST /api/v1/chat` or `/api/v1/chat/stream` accepts
  `{"message":"...","agent":"aria","session_id":"optional"}`. The JSON route
  returns `reply`, `source`, `agent`, `session_id`, and `task`; the SSE route
  emits `meta`, `delta`, then `done` or `error`. A `done` event contains
  `session_id`, `source`, `agent`, and task ID/status. The non-streaming #96
  chat endpoint is buffered; gateway deltas follow the completed upstream
  response and are not live model-token streaming.
- **Task events:** `GET /api/v1/events` returns bounded entries with
  `at`, `type` (`task.queued`, `task.running`, `task.completed`, or
  `task.failed`), `agent`, and `task_id`. Prompts and credentials are excluded.
- **Task and diagnostics extensions in #95:** task snapshot lookup,
  cancellation, cancellation SSE/audit events, and host diagnostics are
  additional shapes in the current #95 head, not yet part of this shared
  contract. Agree those schemas before a client depends on them.
- **Approval extension from #95:** `GET /api/v1/operations` returns
  `{"operations":[...]}`; `GET /api/v1/operations/audit` returns
  `{"events":[{"type","operation_id","at"}]}`; and
  `POST /api/v1/operations/{id}/decision` accepts exactly
  `{"decision":"approve"|"reject","expected_version":1}` and returns
  `{"operation":{...}}`. All require operator authorization at a trusted
  server/proxy boundary. A decision only records approval.
- **Gateway errors:** preserve the existing v1 JSON body `{"error":"..."}` and
  optional `task`; after SSE headers, use `event: error` with the same fields.
  The #96 service returns `{"error":{"code","message","requestId"}}`; the
  gateway maps upstream failures to a bounded 503 error without returning
  upstream body, credentials, or request headers. PR #95's
  `{"error":{"code":"..."}}` needs normalization before becoming the shared
  gateway error shape.
- **Service adapter:** the gateway maps browser `agent` to `/v1/chat` `profile`
  and sends only `{"profile":"...","message":"..."}` with server-side
  authorization. It maps service `content` back to `reply`; session context is
  bounded into the message because #96 has no session parameter. The token is
  never returned to, stored by, or requested from the browser.

### Integration order and current blockers

1. **Browser verification:** Chromium exercises the loopback UI → `/api/v1/chat/stream` → authenticated system-service contract fixture, plus profiles, terminal, session reload/reset, and responsive layouts. The browser E2E fixture is not a real service or model.
2. **Real service smoke:** I ran the current #96 service (`b77a91d`) in a temporary process and connected this branch's gateway adapter over loopback HTTP, also running #96's adapter-integration smoke against the actual service. Missing bearer credentials were rejected on `/v1/profiles`, `/v1/diagnostics`, `/v1/chat`, and `/v1/terminal`; invalid credentials were rejected on the protected GET endpoints. Authenticated profiles/diagnostics and gateway status succeeded. With no model configured, the smoke verified that adapter chat fails closed without inference; the gateway returned 503 with no fabricated reply or token disclosure. This verifies the service protocol and server-side adapter, not model inference or the owner's Codespace.
3. **Aurelius runtime:** #96 owns `debian13/system/**`; #97 has a fixed server-side chat adapter for its `/v1` request/response shape. Full integration still needs the reviewed service source and adapter to coexist on one branch.
4. **Astyria chat:** #95 requires operator bearer authorization on every API route. The #97 gateway does not yet expose the approval queue, provide a server-side adapter to #95, or implement that operator-auth boundary. Agree how the UI bootstrap and proxy will authenticate before joining the queue; normalize errors and test that model-generated operations only queue.
5. **Aria UI:** #94's proxy needs a reviewed, server-side credential path before it can call #95's all-route-auth API. Extend only its approved route allowlist and test the browser UI against the combined gateway after coordination with its owner.

**Owners:** Alex owns the `/api/v1` contract, `debian13/server.py`,
`debian13/system_service_adapter.py`, and `debian13/tests/**`; Aria owns
`debian13/ui/**`; Astyria owns `debian13/chat/**`; Aurelius owns
`debian13/system/**` and the isolated CI workflow. Keep one writer per file.

**Blockers:** #94–#96 remain separate open draft PRs and are not integrated by
this branch; current mergeability is `dirty` for #94/#95/#97 and `unstable` for
#96. PR #108 is merged and supplies only the Codespaces workspace profile; its
actual provisioning remains unverified. #95 currently requires an
operator token on every API route, unlike #94's proxy and this loopback gateway;
the gateway does not yet expose approval routes or operator authentication.
The adapter has now been smoke-tested against the actual #96 service process,
but the browser E2E still uses a contract fixture. No real model inference,
agent worker, external MCP handshake, GPT Actions connection, or Debian 13 boot
is claimed. Check current Actions status separately; local green tests are not
proof that a workflow ran or passed.

### Cross-check of requests #99–#107

These are tracked requests, not completed acceptance criteria for this incremental
Alex integration step.

| Issue | Current evidence in this branch | Still required |
| --- | --- | --- |
| #99 | Standalone chat, four profiles, read-only terminal, and session history exist. | Collapsible sidebar, group/agent-initiated conversation, votes, Vision, and requested screenshot set. |
| #100 | No reaction API or voter records. | Authenticated, persisted votes with visible voters and withdrawal. |
| #101 | Per-process sessions and SSE responses are tested. | Sidebar/history navigation, stop/cancel, persistent reconnect, and bidirectional/group chat. |
| #102 | No image upload or Vision backend. | Validated image handling and a real configured Vision inference path. |
| #103 | Chromium E2E checks desktop and 320 px layouts. | 360/412 px, physical-device checks, and authentic requested screenshots. |
| #104 | Terminal accepts only bounded read-only `pwd`, `ls`, and `cat`. | Script editor, isolated interactive execution, stdin/stdout streaming, stop, and approval. |
| #105 | Local Ollama and an optional server-side adapter for the Debian system API exist; no MCP/GPT Actions/Codex connection is implemented. | Secure configurations and separately verified real integrations and E2E. |
| #106 | In-memory request tasks are observable; there is no Work planner or durable queue. | Multi-step durable jobs, controls, verified artifacts, approval and audit lifecycle. |
| #107 | Read-only runtime/resource/tool availability is surfaced by `/api/v1/diagnostics`. | Logs, active test execution/cancellation, integration probes, export, history, and rollback. |

## Shared integration boundary

The minimal contract keeps four modules separable:

- **Aria/UI:** consumes status, agents, chat, terminal, and task endpoints.
- **Astyria/chat:** selects a role and recognizes only the documented local
  commands; maintains isolated in-memory sessions; model replies are never
  interpreted as executable instructions.
- **Aurelius/runtime:** owns loopback-only exposure, bounded inputs, read-only
  terminal operations, and independent tests.
- **Alex/integration:** owns the versioned API, fixed system-service adapter, and task/event response shapes.

Next stages, only after review and isolated green checks: authenticated write
proposals, end-to-end verification of the combined Aria/Astyria/Aurelius
modules, Debian 13 packaging/boot verification, and four real agent runtimes.
The current local demo does not claim any of those results.
