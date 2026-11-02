---
applyTo: "debian13/**"
---
# Independent Debian 13 system

Treat `debian13/` as a new, standalone system; do not extend or copy the legacy Bastilla OS 2 application unless the owner explicitly requests a compatibility change.

Where root instructions describe the legacy application, apply this narrower Debian 13 scope only to `debian13/**`; do not rewrite root instructions as part of a Debian-only change.

Keep the shared browser API under `/api/v1`. Use fixed, documented upstream routes, bounded request/response sizes, and explicit timeouts. Never turn a client-supplied URL/path into a proxy target.

Keep service and operator bearer tokens server-side. The browser may call only its same-origin loopback UI proxy; do not place secrets in HTML, JavaScript, URLs, logs, test output, or API responses. Permit HTTP only for loopback service URLs; require HTTPS for other configured origins and reject redirects.

Chat/model text is untrusted content, never an executable command. Keep terminal operations allowlisted and read-only unless a separately reviewed, authenticated approval contract is implemented.

Report configured profiles separately from running workers, a reachable provider separately from verified inference, and the host runtime separately from a verified Debian 13 boot. Use local contract fixtures for integration tests and identify them as test doubles.

Before integrating another mission, inspect its current branch and agree on route ownership, request/response/error/event schemas, and authentication boundaries. Keep one writer per shared file and do not claim that open draft branches are integrated.

Run `python3 -m unittest discover -s debian13/tests -v`, `python3 debian13/smoke_test.py`, `python3 debian13/browser_e2e.py`, and `npm run verify` when applicable. The isolated Debian 13 workflow uses Python 3.12 and Node 24. Report local checks separately from GitHub Actions approval/status.
