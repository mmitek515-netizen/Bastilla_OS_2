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
```

`.github/workflows/debian13-demo.yml` runs the isolated Python contract/API
checks and browser-client syntax check when `debian13/**` or that workflow
changes. No npm dependencies or paid services are involved.

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
proposals, automated browser E2E, Debian 13 packaging/boot verification, and
four real agent runtimes. The current local demo does not claim any of those
results.
