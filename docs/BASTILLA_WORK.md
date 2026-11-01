# Bastilla Work: MVP architecture and delivery plan

## Inventory

The MVP should extend the existing Bastilla OS 2 modules rather than introduce a
second agent runtime:

- `src/kernel/agentTasks.ts` stores task records in `data/agent_tasks.json`,
  tracks execution logs and verifies that completed tasks have a disk artifact.
- `server.ts` exposes `GET /api/agent-tasks` and token-protected run/cancel
  actions. AI tasks use the existing `generateWithChain` provider routing.
- `src/components/BastillaOS2View.tsx` provides task creation, status, logs,
  artifacts and cancellation.
- `src/kernel/agentProtocol.ts`, `src/kernel/ollamaDiagnostics.ts` and the MCP
  integration provide adjacent protocol and provider functionality; they do not
  by themselves prove that an agent or provider is running.

The task record is durable, but execution is an explicit operator action, not an
autonomous worker service. A task left queued at restart is marked blocked, and
a task left running is marked failed; neither is silently replayed. Execution is
limited to one task at a time in this MVP. Logs are task-scoped records, not a
tamper-evident audit service. Retry, scheduling, checkpoints, notifications,
and GitHub changes are not claimed as implemented.

## Minimal architecture

1. **Operator UI** creates a task and presents its persisted state and history.
2. **Existing task API** validates the request and requires
   `BASTILLA_AGENT_TASKS_TOKEN` for run/cancel operations.
3. **Task registry** persists task state, runs at most one executor at a time,
   records interruption on restart, and only marks a task completed after
   verifying its artifact.
4. **Allowlisted executor** performs a typed local task or calls the configured
   model provider. It does not expose a general shell or grant agents root.
5. **Provider and protocol diagnostics** report configuration, reachability and
   verified inference/handshake separately. Profiles are not running processes.

The existing API vocabulary remains compatible: `queued` corresponds to
pending work and `completed` means done with a verified artifact. The registry
also reports `running`, `blocked`, and `failed`. A missing AI executor is
blocked rather than presented as a successful model run.

## Dependency plan for issues #10–#13

| Issue | Required evidence | Dependency |
| --- | --- | --- |
| #10 Alex | Build/source identity and comparison with available Codespace work | Establishes source provenance before integration |
| #13 Aurelius | Authenticated write boundaries, negative authorization tests, and VM availability evidence | Security gate before exposing task actions or a runner |
| #11 Aria | Real provider inference and MCP handshake results, including offline behavior | Enables claims about model-backed task execution |
| #12 Astyria | Mobile/keyboard checks for the task workspace | Validates the existing UI as the MVP surface |

These are separate reviewable workstreams, not proof that their PRs have merged
or that the named profiles are running. Integrate their verified changes only
after contract and security review.

## Delivery stages

1. **Inventory and contracts:** preserve current endpoints and application
   identifiers; review issues #10–#13 and agree status/authentication contracts.
2. **MVP hardening:** retain the JSON task registry, serialize execution, reject
   paths outside an application directory, and test authorization and recovery.
3. **Provider evidence:** test a configured provider against a real endpoint;
   keep unavailable providers blocked/offline and do not treat test doubles as
   inference evidence.
4. **UI verification:** test the task view at 320–430px and desktop widths,
   including keyboard use, loading/errors, cancellation and status history.
5. **Automation and GitHub (later):** add retry/idempotency/checkpoints and
   bounded scheduling only with explicit API contracts, audit events and
   permission tests. GitHub changes must use reviewed agent branches and PRs;
   never auto-merge to `main`.

## Rollback and current limitations

The implementation builds on the existing task API and JSON format, so it can
be rolled back by reverting the task-registry/UI changes without migrating user
data or deleting task records. The path checks intentionally reject nested
application filenames; callers that need nested files require a separately
reviewed API contract.

No live model inference, MCP client handshake, QEMU boot, notification channel,
or autonomous agent process is established by this architecture or by the
unit tests. Validate those integrations in their own configured environments
and report their actual logs before marking those stages complete.
