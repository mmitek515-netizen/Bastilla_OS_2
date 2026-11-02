# Debian 13 chat core

This is the isolated chat core for the new Debian 13 system. It uses a locally
running Ollama model for general Polish/English conversation and constrained
structured intent suggestions. Deterministic intents take precedence; validated
state-changing operations are placed in an authenticated approval queue. No
model response is treated as an executable command.

## Run

Requires Node.js with built-in ES modules and `node:test`; there are no external
dependencies.

```sh
cd debian13
npm test
ollama serve
ollama pull <your-local-model>
DEBIAN13_CHAT_OPERATOR_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')" \
DEBIAN13_OLLAMA_MODEL="<your-local-model>" npm start
```

To run the loopback-only HTTP API v1 adapter instead:

```sh
DEBIAN13_CHAT_OPERATOR_TOKEN="<private-token-of-at-least-32-bytes>" \
DEBIAN13_OLLAMA_MODEL="<your-local-model>" npm run start:api
```

The adapter follows PR #97's `/api/v1` chat/session JSON and SSE shapes:
`POST /chat`, `POST /chat/stream`, `GET /sessions/{session_id}/messages`,
`GET /status`, `/agents`, `/tasks`, and `/events`, plus the bounded read-only
`POST /terminal` (`pwd`, `ls`, or `cat <file>` inside the private workspace).
`GET /tasks/{uuid}` returns one persisted task snapshot for authorized status
reconnection; this supports observing Work progress but does not implement a
multi-step Work orchestrator. `POST /tasks/{uuid}/cancel` cancels a running
request without a body; it returns `202` with a `cancel_requested` task, and the
stream sends a terminal `cancelled` event. Task status and the cancellation
exchange are persisted for reconnect.
This standalone adapter currently requires the operator bearer token on every
route. The shared v1 contract in PR #97 requires operator authorization for the
approval routes, but not browser chat/status routes; its UI proxy does not inject
operator credentials. Keep this adapter loopback-only and do not put the token
in browser code; auth-boundary agreement is required before direct UI integration.
A new chat request creates a session; reusing its `session_id` reconnects to its
persisted history. The approved-operation
extension is `GET /api/v1/operations` and
`POST /api/v1/operations/{id}/decision` with
`{"decision":"approve|reject","expected_version":1}`. Decisions only record
approval; no system operation is executed. `GET /api/v1/operations/audit`
returns durable proposal/decision events as
`{"events":[{"type":"operation.proposed","operation_id":"...","at":"..."}]}`.
The decision endpoint returns `{"operation":{...}}`. These approval routes are
proposed extensions in PR #97; the operation object fields must be agreed before
treating them as shared API.

The adapter's additive task-cancellation contract is the bodyless
`POST /api/v1/tasks/{uuid}/cancel`; it returns `202 {"task":{...}}`
for a newly requested cancellation and `200 {"task":{...}}` when cancellation is
already pending or complete. SSE cancellation emits `cancelled` with
`{"error":"request_cancelled","task":{...}}`; task audit entries use
`{"at":"...","type":"task.<status>","agent":"...","task_id":"..."}`. These
cancellation statuses/events are extensions not yet in PR #97's shared v1
event list and require contract approval.

The authenticated `/api/v1/status` response also includes a read-only
`diagnostics` snapshot: host runtime/platform, uptime, CPU count/load, memory,
and free/total bytes for the private workspace filesystem. These are measurements
of the host running the API, not proof of a Debian 13 boot, service health,
process inventory, or logs. Filesystem metrics report `unavailable` if the host
cannot provide them. This diagnostics field is an additive prototype extension;
coordinate its shared schema before integrating another client.

The API persists bounded sessions, proposals, decisions, tasks, and audit
events to a local JSON file (default:
`~/.local/state/debian13-chat/state.json`; override with
`DEBIAN13_CHAT_STATE_PATH`). The file is atomically replaced and restricted to
the current user. Run only one API process against a state file at a time.

The operator token must contain at least 32 bytes. Keep it private and do not
commit it. Ollama must be local (`127.0.0.1`, `localhost`, or `::1`) and the
selected model must already be installed. The Ollama transport is fixed to `http://127.0.0.1:11434`; redirects and
non-loopback endpoints are refused.

The demo has an authenticated in-memory conversation history (`history`) and
live read-only status for the host runtime (not proof that Debian is booted). It supports restart requests for `cron`, `nginx`, or
`ssh`, and reboot requests in Polish or English. Each becomes a typed proposal;
`approve <proposal-id>` and `reject <proposal-id>` record an explicit operator
decision.

No paid model provider is configured or called. If Ollama or the selected model
is unavailable, the demo reports that fact and does not fabricate a response.
Model-generated prose is labeled unverified; only application status and queue
records are authoritative.
The SSE endpoint sends session/task metadata immediately, then reply deltas
after the structured model response is validated. This is not upstream Ollama
token streaming. The authenticated cancellation route aborts the pending local
Ollama request, and closing an active SSE stream aborts its in-flight request.
Reconnect uses the persisted task snapshot and session history.
The terminal is read-only and never invokes a shell. This is a chat/API
prototype, not proof that a dedicated Debian 13 system has booted.
