# Bastilla OS 2 — evidence gate for agent PRs

This checklist is a review aid, not proof that a CI run has passed. Apply it to PRs from Alex, Astyria, Aria, Aurelius and automation-generated changes.

## Before merging

1. Confirm the PR's **head SHA** and base branch (`main`), and review the actual diff. A PR description or agent comment is not test evidence.
2. Open the PR **Checks** tab. Require a completed, successful GitHub Actions run for that exact head SHA, including `npm run verify` (or the equivalent test, lint and build jobs). A missing status, empty API response or a check on an older SHA is **unknown**, not green.
3. If checks are missing, inspect `.github/workflows/ci.yml`, Actions permissions, workflow triggers, billing/quotas and branch protection. Record the blocker in the existing CI issue (#22), without claiming the checks passed.
4. For backend, GPT Actions, MCP, or auto-sync changes, review authentication, CORS, secret handling, fail-closed behavior and public exposure. Do not publish a Codespaces port or deploy a mutable API until this review passes (#23, #25).
5. For Vision changes, verify a real JPEG/PNG/WebP upload against a vision-capable model; record the actual provider, model and response. An unavailable model must produce an explicit error, not an invented image description (PR #24).
6. For VM/Codespaces changes, verify the actual repository/branch/commit, process logs and private port settings. A setup script or screenshot alone does not prove a running Bastilla OS 2 VM (#17).
7. Record test commands, exit codes, environment and evidence links in the PR. Do not merge unverified changes or automatically execute model-proposed commands.

## Agent activity

Issues #5–#8 describe responsibilities; they do not start workers. Only a real assigned coding-agent session, its PR/commits and checks establish work performed. Report missing evidence explicitly.

## Minimal PR evidence template

- Head SHA:
- Tests/checks and run URL:
- Result (passed / failed / not run):
- Manual verification (if applicable):
- Security review:
- Remaining blockers:
