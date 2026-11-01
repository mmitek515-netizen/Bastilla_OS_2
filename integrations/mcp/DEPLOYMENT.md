# BastillaOS MCP — deployment and verification

## Architecture

ChatGPT (remote MCP client) → authenticated HTTPS ingress → loopback FastMCP Streamable HTTP server (127.0.0.1:8000/mcp) → BastillaOS HTTP API (127.0.0.1:3000) → optional Ollama API (127.0.0.1:11434).

GitHub repository access does **not** mean the MCP service is connected or running. The OpenAPI document served by the web app is **not** the MCP protocol endpoint. The old `/api/mcp/openapi.json` path redirects to the separately bearer-protected GPT Actions schema; GPT Actions is REST, not MCP.
The legacy Express `/api/mcp` and `/mcp` paths are not the canonical Streamable HTTP server. They require a separate `BASTILLA_MCP_TOKEN` (32+ characters) and expose only a read-only kernel status tool. The token is not OAuth and does not authorize the Python bridge.

## Local startup

From the repository root:

```bash
npm ci
bash scripts/start-bastilla-mcp.sh
```

The script starts the local web API if necessary, installs Python MCP dependencies in `.venv-mcp`, starts a loopback-only MCP bridge, and runs a real MCP handshake plus tool calls. It reports Ollama reachability separately. It does **not** install a model or publish a public endpoint.
The Integrations screen calls `/api/mcp/setup`; it reports HTTPS URL configuration, local bridge reachability, and local handshake separately. Its ChatGPT connection status remains unverified because the app cannot observe the remote client.

To test an already running MCP endpoint:

```bash
BASTILLA_MCP_URL=http://127.0.0.1:8000/mcp .venv-mcp/bin/python integrations/mcp/smoke_test.py
```

The Codespaces health check also verifies MCP `initialize`, `notifications/initialized` (through the SDK client), `ping`, and `tools/list`. For a public endpoint, test the deployed URL with an authorized client. A minimal `curl` initialize request is:

```sh
read -r -s -p "Authorization header value (do not display): " MCP_AUTHORIZATION
printf '\n'
curl --fail-with-body --silent --show-error --max-time 10 \
  -H "Authorization: $MCP_AUTHORIZATION" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' \
  "$BASTILLA_MCP_PUBLIC_URL"
unset MCP_AUTHORIZATION
```

Supply the authorization header value issued by the configured ingress through the hidden prompt; do not paste it into a command, URL, log, or chat. Use the HTTP response's `MCP-Session-Id` for subsequent requests when the server returns one. To verify the complete SDK flow including ping and tools/list, set `BASTILLA_REMOTE_MCP_URL` and (if required by the ingress) `BASTILLA_REMOTE_MCP_TOKEN`, then run:

```sh
python integrations/mcp/client.py --call ollama_status
```

The client rejects non-HTTPS remote URLs, credentials in the URL, and query strings. The token is read from the environment and is never printed.

## Connecting ChatGPT

1. Deploy BastillaOS and the MCP bridge on a host that remains online. GitHub Actions and a stopped Codespace are not persistent hosting.
2. Put a trusted HTTPS reverse proxy in front of the MCP bridge. Require authentication supported by the ChatGPT MCP connector and protect against unauthenticated requests. The Python bridge itself does not implement OAuth or authenticate inbound requests. Do **not** expose port 8000 or the Ollama API directly to the internet.
3. Configure a public HTTPS MCP URL ending in `/mcp` in ChatGPT's connector settings, using the authentication configuration offered there. Do not put tokens in GitHub files, URL query parameters, or chat messages.
4. Verify the connection by listing tools `ollama_status`, `agents_status`, and `vm_status`. `agent_command` is omitted unless explicitly enabled for fixed diagnostics. Then call `ollama_status`. A successful handshake proves the MCP transport works; it does not prove that Ollama has a running model or that remote agents are connected.
5. For server-side diagnostics, review `.runtime/mcp.log` and `.runtime/bastilla.log`. Avoid posting secrets from logs.

For mobile setup, configure the persistent HTTPS host and authentication at the hosting/reverse-proxy layer first. Then add the `/mcp` URL from ChatGPT's connector settings on the phone and complete any provider-owned OAuth consent there. The app does not open OAuth consent windows or change account settings.

## Automated verification

The local startup script runs a protocol-level MCP smoke test against the configured BastillaOS API; automated tests in this repository do not prove availability of a deployed service. A test against `mock_api.py` is deterministic test data, not a live service or model.

The bridge is intentionally read-only and restricts agent commands to a small allowlist. Adding privileged or shell-execution tools requires a separate security review, access controls, and explicit authorization.

## Status and blockers

- `BASTILLA_MCP_PUBLIC_URL` is only a configured endpoint value; it does not prove DNS, public reachability, TLS, or authentication.
- `BASTILLA_MCP_TOKEN` protects the legacy Express endpoint only. It is a static bearer credential, not OAuth, and the Express route exposes read-only status only.
- The Streamable HTTP bridge has no built-in authorization layer. Do not deploy it publicly without an authenticated ingress and a successful external authorization test.
- A local initialize/ping/tools/list test does not verify a real ChatGPT client. That final step requires a persistent public host, an auth mechanism supported by the user's ChatGPT account, owner consent where prompted, and an authorized external test. No deployment or account authorization is performed by repository changes.
