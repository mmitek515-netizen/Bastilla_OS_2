# Bastilla Global Sync — implementation stages (#84)

The initial `src/lib/globalSync.ts` defines domain-scoped, revisioned, metadata-only events and a **process-local** notification bus. It is not yet connected to any writes or UI and does **not** persist events, synchronize GitHub/AI Studio, or deliver events between server instances. No credentials, file contents or raw logs belong in events.

## Required production design

1. **Authority per domain:** decide which backend database/workspace owns each record (chat, tasks, apps, projects, files, DB migrations, dashboards, incidents, services). GitHub/AI Studio are integrations, not interchangeable sources of truth.
2. **Transactional outbox:** commit domain write and outbox event atomically; monotonic per-resource revisions, stable event IDs, retention and replay cursor, idempotent consumer keys. Use a persistent DB; never rely on the in-memory bus for durability.
3. **Secure delivery:** authenticated, RBAC-filtered SSE/WebSocket channel; replay from cursor on reconnect, snapshot when cursor expired, heartbeat, backpressure, polling fallback. Cross-process pub/sub when scaled.
4. **Connector workers:** explicit acknowledgements per destination for GitHub, Codespaces, AI Studio, preview and device clients. Distinguish `saved`, `syncing`, `confirmed`, `failed` and `conflict`. No automatic claims of success based on a local UI event.
5. **Conflict policy:** optimistic concurrency/ETag or branch merges; conflicting edits require resolution rather than silent overwrite.
6. **Operator safeguards:** isolate projects, redact sensitive fields, never expose raw logs or secrets; production deploy, destructive DB migrations and global privilege changes need approval.
7. **Integration:** start with project/file writes and app preview, then agent missions, chat, dashboards, incidents, databases and external connectors. Preserve `without_nlp`.

## Acceptance tests

- Two logged-in devices show the same authorized saved file revision without manual refresh.
- Disconnect, perform several edits, reconnect and replay all missed revisions without duplicates.
- Simultaneous edits detect a conflict; no silent data loss.
- Failed GitHub/AI Studio synchronization remains visibly failed, even if backend save succeeded.
- Unprivileged user cannot subscribe to another project's events.
- Restart backend and replay persistent outbox; tests for large backlogs and slow clients.
- Real build/preview updates only after successful build; previous working preview remains on failure.

**Current implementation status:** contract + local notification primitive only. No endpoint or actual global synchronization is active from this PR.
