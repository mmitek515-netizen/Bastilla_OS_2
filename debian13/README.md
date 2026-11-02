# Debian 13 system demo

This directory is a new, standalone user-space demo. It does not modify or
replace the older Bastilla OS 2 application, and it is not a Debian installer,
VM image, or verified Debian boot.

## Status and active work

- **Application:** a local Python HTTP application with chat, agent profiles,
  read-only terminal commands, an in-memory task list, and a small web UI.
- **Profiles:** Aria, Astyria, Aurelius, and Alex are configured role profiles.
  They are not four running agents or processes.
- **Model execution:** disabled until `DEBIAN13_OLLAMA_MODEL` is set and that
  model is found through the local Ollama `/api/tags` endpoint. Only an actual
  successful `/api/chat` response is reported as verified inference.
- **OS:** the target is Debian 13. The status endpoint checks the actual
  `/etc/os-release`; running this app does not demonstrate a Debian 13 boot.
- **Persistence:** tasks and audit events are process-local and are cleared on
  restart. Chat requests return complete JSON responses; streaming and isolated
  persistent sessions are future work.

No paid service is started, and no credentials are required by the demo.

## Contract v1

All paths are rooted at `/api/v1`. JSON errors use `{"error": "..."}`.

| Method and path | Contract |
| --- | --- |
| `GET /api/v1/status` | Actual app, OS, local model, profile, and task-storage status. |
| `GET /api/v1/agents` | Four configured profile identities/roles; explicitly not worker processes. |
| `GET /api/v1/tasks` | Recent in-memory tasks with `queued`, `running`, `completed`, or `failed` state. |
| `GET /api/v1/events` | Bounded in-memory task lifecycle audit entries; prompts and secrets are excluded. |
| `POST /api/v1/chat` | `{"message":"...", "agent":"aria"}`; routes `/help`, `/status`, and `/terminal ...` locally, otherwise calls the configured local Ollama model. Model output is returned as text only and is never executed. |
| `POST /api/v1/terminal` | `{"command":"pwd"}`; only read-only `pwd`, `ls`, and `cat <relative-file>` in `workspace/` are accepted. No shell is invoked. |

Tasks are created with a UUID and returned in the response. A model outage marks
the task `failed` and returns HTTP 503 without substituting a fake response.
There are no write actions in this first stage; adding them requires explicit
authorization and an approval contract before implementation.

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

`.github/workflows/debian13-demo.yml` runs only these Python checks when
`debian13/**` or that workflow changes. No npm dependencies or paid services
are involved.

## Shared integration boundary

The minimal contract keeps four modules separable:

- **Aria/UI:** consumes status, agents, chat, terminal, and task endpoints.
- **Astyria/chat:** selects a role and recognizes only the documented local
  commands; model replies are never interpreted as executable instructions.
- **Aurelius/runtime:** owns loopback-only exposure, bounded inputs, read-only
  terminal operations, and independent tests.
- **Alex/integration:** owns the versioned API and task/event response shapes.

Next stages, only after review and isolated green checks: per-client sessions,
chat streaming/cancellation, authenticated write proposals, browser E2E,
Debian 13 packaging/boot verification, and four real agent runtimes. The
current local demo does not claim any of those results.
