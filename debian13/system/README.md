# Debian 13 System — first runnable stage

This is a new, standalone Debian 13 system prototype. It does not depend on the
legacy Bastilla OS 2 application or modify its API. The first stage provides an
authenticated local API, a constrained command terminal, four selectable
agent profiles, and an optional real OpenAI-compatible chat provider.

## What is and is not running

- The four names in `GET /v1/profiles` are role profiles, not four background
  AI processes. A profile handles a chat only when the configured provider
  returns a real response.
- Without a configured model URL, key, and model name, `/v1/chat` returns
  `503 provider_not_configured`; it never fabricates a reply.
- A successful provider request confirms that one chat request reached the
  configured endpoint. It does not mean four autonomous agents are running.
- The container and host-service tests do not boot a Debian installer or ISO.
  No bootable image is part of this first stage.

## Stage 1: run in an isolated Debian 13 container

Requirements: Docker Engine with Compose v2. The image is based on a pinned
Debian 13 image digest and installs only Debian packages. The Trixie package
archive is not snapshot-pinned, so package updates can change subsequent builds;
this is a repeatable setup recipe, not a bit-for-bit reproducible image build.
Review and update the base digest and package versions as part of release
maintenance.

From this directory:

```sh
export DEBIAN13_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
docker compose -f compose.yaml build
docker compose -f compose.yaml up -d
```

The service is published only on `127.0.0.1:8080`. Its container runs as UID
10001 with a read-only root filesystem, no Linux capabilities, no-new-privileges,
resource limits, and a dedicated named workspace volume. The terminal does not
invoke a shell and only accepts a small allowlist of commands with workspace-
confined file paths. It has a per-IP request limit and bounds execution time and
output. Keep the port private; the bearer token is required for all API routes
except liveness.

## API compatibility boundary

This service exposes `/v1/profiles`, `/v1/terminal`, and `/v1/chat`, and requires
a bearer token except for `/healthz`. Alex's separate Debian 13 demo contract in
PR #97 uses `/api/v1/status`, `/api/v1/agents`, session/task routes, and an
unauthenticated loopback-only listener. The two runtimes are not API-compatible:
do not point that demo's UI at this service or expose either listener publicly
without agreeing on a shared contract and authentication model. This service's
terminal and model chat remain separate; model output is not executed.

Optional real model access uses an OpenAI-compatible chat-completions endpoint.
Set these variables before starting Compose; the URL must be HTTPS, except that
HTTP loopback endpoints are allowed for local development:

```sh
export MODEL_CHAT_URL="https://provider.example/v1/chat/completions"
export MODEL_API_KEY="use-a-deployment-secret"
export MODEL_NAME="provider-model-id"
docker compose -f compose.yaml up -d --force-recreate
```

Do not put real keys in shell history, tracked files, or a public image. Chat
requests have a timeout; provider redirects, arbitrary client-supplied URLs,
and fallback/mock replies are not used.

Check the service and authenticated API:

```sh
curl --fail http://127.0.0.1:8080/healthz
curl --fail -H "Authorization: ******" \
  http://127.0.0.1:8080/v1/profiles
curl --fail -H "Authorization: ******" \
  -H 'Content-Type: application/json' \
  -d '{"command":"ls"}' http://127.0.0.1:8080/v1/terminal
```

Stop the service with `docker compose -f compose.yaml down`. The named workspace
volume persists; remove it only when intentionally discarding user files:
`docker compose -f compose.yaml down -v`.

## Stage 1 alternative: install as a host systemd service

On Debian 13 with Python 3 and systemd:

```sh
sudo ./install.sh
sudo systemctl status debian13-system.service
sudo journalctl -u debian13-system.service
```

The installer creates a system account, a root-managed environment file, and a
workspace writable only by that account. The service binds to loopback and has
systemd filesystem/kernel hardening. Retrieve the generated local bearer token
only when needed using the command printed by the installer. To configure an
AI provider, edit `/etc/debian13/system.env` as root and restart the service.

## Tests and evidence

The focused tests use Python's standard library and a local fake provider; no
external account, payment, model, or network service is required:

```sh
python3 -m unittest discover -s tests -v
python3 -m py_compile server.py
python3 smoke_test.py
systemd-analyze verify systemd/debian13-system.service
docker compose -f compose.yaml config
docker compose -f compose.yaml build
```

For the isolated HTTP smoke test, build `debian13-system:local` first; the test
starts a temporary container with a random API token, loopback-only ephemeral
port, read-only root filesystem, dropped capabilities, and resource limits. It
checks unauthenticated/invalid-token rejection, profiles, non-root terminal
execution, an unconfigured chat provider, and the 429 rate-limit response, then
removes the container. It does not boot an OS image.

The repository CI runs Python compilation and unit tests, shell syntax,
systemd, Compose, and image-build checks alongside the existing application
checks. Run `smoke_test.py` locally after the image build for the isolated
container HTTP checks.

The provider test confirms the selected profile and real HTTP request/response
flow against a test server; it is not evidence that a production AI account is
configured. A passing container/package test is not a Debian OS boot. A
bootable ISO, installer run, VM boot log, package release, and actual production
provider integration remain separate acceptance work.

## API contract

Every endpoint except `GET /healthz` requires
`Authorization: ****** Chat and terminal work remain
separate; model output is never executed as a command.

| Route | Request / response |
| --- | --- |
| `GET /healthz` | Liveness only: `{"status":"ok"}` |
| `GET /v1/profiles` | Profile IDs/roles, all with `active:false`, and provider configuration status |
| `POST /v1/terminal` | `{"command":"ls"}`; direct allowlisted argv execution and bounded output |
| `POST /v1/chat` | `{"profile":"aria","message":"..."}`; real provider response or explicit error |

Error responses use `{"error":{"code":"...","message":"...","requestId":"..."}}`.
