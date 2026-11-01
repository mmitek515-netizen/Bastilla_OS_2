# Development

## First run

Use Node.js 24. Run `npm ci`, then `npm run dev` on port 3000. The API binds to
`127.0.0.1` by default. Non-loopback binding is disabled outside production and
requires `BASTILLA_API_TOKEN` with 32–256 non-whitespace characters.
Every `/api` endpoint, `/mcp`, and `/download` then requires that bearer token,
except GPT Actions status/message routes, which enforce their own token, and
setup/schema metadata routes. Agent-task and inbox tokens remain independently
required.

| API surface | Local loopback | Non-loopback production bind |
| --- | --- | --- |
| Read-only and mutating `/api` routes, `/mcp`, `/download` | Existing route behavior | `BASTILLA_API_TOKEN` bearer required |
| Agent task run/cancel | `BASTILLA_AGENT_TASKS_TOKEN` required | Both API and agent-task tokens required |
| GPT Actions status/message | `GPT_ACTIONS_TOKEN` required | Existing GPT Actions token remains required |
| Agent inbox send/read | Inbox token required for send | API token for read; API and inbox tokens for send |
| MCP browser CORS | Same-origin/local behavior | No cross-origin access unless its exact origin is listed in `BASTILLA_CORS_ORIGINS` |

This is not a user-session system: keep forwarded/public ports private unless
the deployment has an authenticated UI and a fresh random API token can be
supplied by a trusted client. Do not embed the API token in browser code.
Wildcard CORS is not supported. The unprotected GPT Actions setup/schema routes
expose configuration status and API schema only; other public API reads require
the API token.

Loopback mode remains an explicitly trusted local-operator boundary for
compatibility, not per-user authentication. The packaged systemd service
currently runs as root and its command endpoints can execute shell commands;
do not use it as a multi-user service or expose its loopback port through an
unauthenticated proxy. Removing root privilege safely requires a separate
review of privileged features and package permissions.

Configure model credentials through deployment secrets or a local `.env` based on
`.env.example`. No model is included; unavailable providers must be reported honestly.
Keep the Codespaces port private: the browser UI has no user-session mechanism for
presenting `BASTILLA_API_TOKEN`.

## Debian/QEMU verification

Run `bash scripts/check-virtualization.sh` for a read-only check of QEMU, KVM
device permissions and Docker; it does not install packages or need root. If
QEMU is absent, do not claim a VM boot. Obtain separate approval before
installing system packages in Codespaces. For a repeatable Debian 13 boot:

1. Install `qemu-system-x86` and `qemu-utils` only in an approved environment.
2. Download the official Debian 13 amd64 netinst ISO and verify its SHA-256
   against the matching official `SHA256SUMS` file.
3. Keep the port private and run
   `VM_DIR="$HOME/bastilla-vm" DEBIAN_ISO="$HOME/bastilla-vm/debian-13-amd64-netinst.iso" bash scripts/bastilla-debian13-qemu.sh`.
   The script creates a qcow2 disk if needed, uses KVM only when `/dev/kvm` is
   readable and writable, otherwise uses TCG, and binds VNC to `127.0.0.1:5901`.
4. Connect to VNC through a private local tunnel, complete the Debian installer,
   then preserve the QEMU output and installer/guest console evidence before
   reporting a successful boot. Do not commit the ISO, disk, or runtime logs.

`npm run verify` runs four independent checks concurrently. GitHub Actions caches npm
downloads and cancels obsolete runs on the same branch. Automatic Git synchronization
uses the same command before committing. It cannot resolve competing agent edits;
use one writer per file and separate worktrees.

## Priority queue

| Priority | Owner | Deliverable | Evidence |
| --- | --- | --- | --- |
| P0 | Alex | Compare unpushed Codespace work with recovered source | diff and source SHA |
| P0 | Aurelius | Audit write endpoints and deployment authentication | negative API tests |
| P1 | Aria | Validate Ollama and MCP against an actual provider | initialize/tools/list logs |
| P1 | Astyria | Verify terminal, chat and navigation on mobile | viewport checks |
| P1 | Alex | Integrate reviewed changes preserving API compatibility | green verify and API checks |
| P2 | Aurelius | Boot Debian/QEMU and validate packaging | actual boot/build logs |

Names in this table are responsibilities, not confirmation of agent execution.
Do not use placeholder percentages or countdowns as evidence of completion.

## Naming

- Repository: `Bastilla_OS_2`; displayed product: `Bastilla OS 2`.
- npm identifier: `bastilla-os-2`; branches: `agent/alex/<task>` etc.
- New documentation/scripts: descriptive kebab-case unless an existing contract requires otherwise.
- Existing `bastillaos` paths, app IDs, APIs and package names remain compatible.

Sources were recovered from `u6930438163-code/AI_Studio_BastillaOS` commit
`2203ac94b1dbbad0f9e2a470c00a4b24bc9900ed`. Runtime databases, exports,
virtual environments, archived ZIPs and automatic deployment workflows were excluded.
Local Codespace edits have not been compared: this import does not claim to contain them.
