# Debian 13 chat core

This is the isolated chat core for the new Debian 13 system. It uses a locally
running Ollama model for general Polish/English conversation and constrained
structured intent suggestions. Deterministic intents take precedence; validated
state-changing operations are placed in an authenticated, in-memory approval
queue. No model response is treated as an executable command.

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
Approvals currently do not execute operations; the queue is not persisted and
there is no HTTP transport. This is a chat-core demo, not a booted Debian 13
system.
