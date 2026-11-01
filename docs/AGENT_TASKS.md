# Agent task queue

The task registry is a bounded scheduler for the actions implemented by the
server. It is not a general-purpose autonomous shell or repository agent. An
AI task generates a report through the configured model chain; it does not
execute the model's suggestions or modify project files.

## Configuration and API

Set `BASTILLA_AGENT_TASKS_TOKEN` in the deployment environment to enable
mutations. Never commit the token or put it in a public URL. The run, cancel,
approve and retry endpoints require the configured token in the HTTP
Authorization header. Keep the server port private; the task list endpoint remains readable without a token
for compatibility and includes task descriptions, logs and results.

Supported actions are `ai_task`, `audit_system_integrity`, `scaffold_app` and
`write_app_file`. The last two require an explicit operator approval before
writing under `apps/`. App identifiers and filenames are validated and
write-file paths are constrained to the selected app directory. The old
`generic_diag` action is rejected because its former output claimed an
`ONLINE` system state without checking a real service.

`POST /api/agent-tasks/run` accepts optional `dependsOn` (up to 20 existing
task IDs), `scheduledAt` (an ISO date, at most one year ahead) and `timeoutMs`
(100–600000; default 60000). A dependent task remains `blocked` until all
dependencies complete. A task awaiting operator approval or lacking an
executor is also `blocked`; that status does not mean work is running.
Completed tasks require a file artifact that exists on disk.

The authenticated endpoints also include:

- `POST /api/agent-tasks/:id/approve` to approve a blocked write task.
- `POST /api/agent-tasks/:id/retry` to retry an eligible failed task.
- `POST /api/agent-tasks/cancel` with `{ "id": "..." }`.

AI tasks get at most three attempts with bounded exponential delay. Other
actions are not automatically retried. Cancellation and timeout use an abort
signal; tasks interrupted by a process restart are changed to `blocked` and
are not resumed automatically because the executor cannot be safely restored.

## Audit and notifications

Task state is stored in `data/agent_tasks.json`; append-only transition events
are written to `data/agent_task_audit.jsonl`. The task list response includes
recent completion, failure, retry and blocked notifications. Both paths are
runtime state and are ignored by Git.

## Providers and cost

No model or runner is bundled. `ai_task` uses the project's configured model
provider chain and can remain blocked or fail when no usable provider is
available. Provider keys, quotas, usage charges and hosting costs are
separate deployment concerns. ChatGPT Plus does not include free OpenAI API
usage or Bastilla OS 2 hosting. Ollama is optional and is not required by the
task queue.

## Verification

Run `npm test`, `npm run lint`, `npm run build`, `npm run build:server` and
`npm run verify`. For live API verification, start the server locally with a
temporary `BASTILLA_AGENT_TASKS_TOKEN` and use `npm run check:api -- http://127.0.0.1:3000`.
An API reachability check does not prove that an external model, runner, VM or
client connection is live.
