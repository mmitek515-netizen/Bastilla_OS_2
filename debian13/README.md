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

No paid service is started, and no credentials are required by the demo.

## Contract v1

All paths are rooted at `/api/v1`. JSON errors use `{"error": "..."}`.

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/status` | Actual app, OS, local model, profile, and task-storage status. |
| `GET /api/v1/agents` | Four configured profile identities/roles; explicitly not worker processes. |
| `GET /api/v1/tasks` | Recent in-memory tasks with `queued`, `running`, `completed`, or `failed` state. |
| `GET /api/v1/events` | Bounded in-memory task lifecycle audit entries; prompts and secrets are excluded. |
| `GET /api/v1/sessions/{session_id}/messages` | Read the bounded chat history for a live in-memory session. |
| `POST /api/v1/chat` | `{"message":"...", "agent":"aria"}`; optionally accepts an existing `session_id`. Creates a session otherwise and returns its ID. Routes `/help`, `/status`, and `/terminal ...` locally, otherwise calls the configured local Ollama model with that session's context. Model output is text only and is never executed. |
| `POST /api/v1/chat/stream` | Same JSON request as `/chat`; streams `meta`, `delta`, then `done` or `error` events as Server-Sent Events. Only completed responses enter session history. |
| `POST /api/v1/terminal` | `{"command":"pwd"}`; only read-only `pwd`, `ls`, and `cat <relative-file>` in `workspace/` are accepted. No shell is invoked. |

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

The adapter only accepts the local Ollama HTTP API. Do not put keys or secrets
in the model name or chat prompt.

## Tests and isolated CI

```sh
python3 -m unittest discover -s debian13/tests -v
python3 debian13/smoke_test.py
python3 debian13/browser_e2e.py
```

`.github/workflows/debian13-demo.yml` runs the isolated Python contract/API
checks, browser-client syntax check, and Chromium browser E2E over real loopback
HTTP when `debian13/**` or that workflow changes. Chromium/Chrome must be
available on the runner. No npm dependencies or paid services are involved.

## Shared v1 contract and compatibility matrix

The canonical interface for this standalone demo is the `/api/v1` contract
above. The following comparison is based on the open PR heads inspected on
2026-11-02; none is merged into this branch. Their changes are not interchangeable
implementations of one API yet.

| Mission | Current interface in that PR | Compatibility with this v1 | Required integration |
| --- | --- | --- | --- |
| Aria UI · PR #94 (`529d724`) | UI proxy permits `GET /api/v1/status`, `/agents`, `/tasks` and `POST /api/v1/chat`, `/terminal`. Chat sends `message` + `agent`; terminal sends `command`. | **Partial match:** these paths and request fields match. Its proxy does not allow `/events`, `/sessions/{id}/messages`, or `/chat/stream`, so session history and SSE cannot work through that UI proxy yet. | Extend the fixed route allowlist and browser UI for session/history, SSE and event/task status. Preserve bounded proxy bodies and avoid putting operator credentials in browser code. |
| Astyria chat · PR #95 (`2252357`) | Legacy Express paths include `/api/triad/message`, `/api/chat/approvals`, `/api/chat/approvals/:id`, and `/api/astyria/mission`; chat operations use an operator token and origin checks. | **Not directly compatible:** the root paths and response shapes differ; this demo has no proposal/approval endpoints. | Agree typed `/api/v1` proposal and decision routes, retain operator authorization, and add queue-only handling. Never copy or enable legacy execution routes in the new system. |
| Aurelius runtime · PR #96 (`32f2345`) | Standalone service uses `/healthz`, `/v1/profiles`, `/v1/chat`, `/v1/terminal`; all except liveness require a bearer token. | **Not directly compatible:** API prefix, profile/chat field names, error shape, and authentication boundary differ. | Reconcile service routing with `/api/v1`; keep authorization on state-changing/proposal routes and deliver credentials only server-side, never in the browser. Confirm terminal semantics and session/streaming support before adoption. |
| Alex integration · PR #97 (this branch) | `/api/v1/status`, `/agents`, `/tasks`, `/events`, `/sessions/{id}/messages`, `/chat`, `/chat/stream`, `/terminal`; four profile IDs; tasks/events and session state are bounded and process-local. | **Contract owner/reference implementation.** Loopback-only; no operator token or write actions exist yet. | Keep one documented v1 schema and add contract tests for every adapter before integration. |

### Integration order and current blockers

1. **Current verified step:** run Chromium against this branch's live loopback HTTP server; test profile loading, streaming `/help`, terminal request, session persistence on reload, and explicit session reset. This does not claim model inference.
2. **Aurelius runtime:** review and adapt PR #96's service boundary to the v1 paths and server-side authorization contract. Do not mount an authenticated endpoint on a public port or pass a bearer token to browser JavaScript.
3. **Astyria chat:** integrate the typed proposal queue and approval decisions only after agreeing request/response shapes and operator auth; test that model-generated operations only queue and never execute automatically.
4. **Aria UI:** extend the UI proxy and views to consume sessions, SSE, task/events and approved proposals; run browser E2E against the combined service on desktop and narrow mobile widths.

**Blockers:** PRs #94–#96 are still separate draft changes and use three different API/security shapes. The new demo is loopback-only, stores sessions in process memory, has no approval API or write operations, and depends on a real model that is currently unconfigured. Automated E2E covers the current demo, not the three unmerged branches. CI remains subject to GitHub's `action_required` gate; local green tests are reported separately and do not clear that gate.

## Shared integration boundary

The minimal contract keeps four modules separable:

- **Aria/UI:** consumes status, agents, chat, terminal, and task endpoints.
- **Astyria/chat:** selects a role and recognizes only the documented local
  commands; maintains isolated in-memory sessions; model replies are never
  interpreted as executable instructions.
- **Aurelius/runtime:** owns loopback-only exposure, bounded inputs, read-only
  terminal operations, and independent tests.
- **Alex/integration:** owns the versioned API and task/event response shapes.

Next stages, only after review and isolated green checks: authenticated write
proposals, end-to-end verification of the combined Aria/Astyria/Aurelius
modules, Debian 13 packaging/boot verification, and four real agent runtimes.
The current local demo does not claim any of those results.
