# Bastilla OS 2 MCP bridge

The canonical MCP transport is the separate Python FastMCP **Streamable HTTP** bridge. It exposes a read-only subset of the Bastilla OS 2 API and makes no OpenAI/Gemini API calls.

## Start

From the repository root in a Linux Codespace, run `npm run start:mcp` to start the local services and perform the MCP smoke test. This checks local reachability, not remote ChatGPT authorization. Keep the terminal open while using the services.

Alternatively, start the bridge manually:

On the BastillaOS host, ensure BastillaOS and Ollama are already running.

```sh
python3 -m venv .venv-mcp
. .venv-mcp/bin/activate
pip install -r integrations/mcp/requirements.txt
python integrations/mcp/server.py
```

By default the MCP endpoint is `http://127.0.0.1:8000/mcp` and the BastillaOS API is `http://127.0.0.1:3000`. Override the latter with `BASTILLA_API_URL` if necessary.

## Available tools

- `ollama_status`: GET /api/ollama/models
- `agents_status`: GET /api/agents/background/status
- `vm_status`: read VM configuration and runtime
- `agent_command`: optional, fixed diagnostic allowlist only; disabled by default

No shell access, arbitrary commands, file writes, or model cloud API keys are required.

## Remote access

**Never publish port 8000 directly.** The bridge does not implement OAuth or inbound bearer validation. Use an HTTPS reverse proxy with authentication supported by your MCP client, access controls, and rate limits before registering a remote MCP URL. A tunnel alone does not provide authentication. Do not publish the BastillaOS development server itself.

## Notes

`integrations/mcp/healthcheck.py` performs a real local SDK initialize, initialized notification, ping, and tools/list check. A successful local test does not prove public HTTPS reachability, OAuth authorization, or a connection from ChatGPT. See [DEPLOYMENT.md](DEPLOYMENT.md) for remote setup and verification boundaries. The legacy Express `/api/mcp` route is separate, bearer-protected, read-only, and not the Streamable HTTP bridge.
