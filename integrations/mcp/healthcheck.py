"""Read-only MCP handshake used by Codespaces readiness checks."""
import asyncio
import json
import os
import socket
from urllib.parse import urlparse


async def check():
    url = os.environ.get("BASTILLA_MCP_URL", "http://127.0.0.1:8000/mcp/")
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"})
    ) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return {"serverAvailable": False, "handshakeOk": False, "error": "Invalid MCP endpoint configuration."}

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        with socket.create_connection((parsed.hostname, port), timeout=1):
            pass
    except (OSError, ValueError):
        return {"serverAvailable": False, "handshakeOk": False, "error": "Local MCP server is unavailable."}

    try:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        async with streamablehttp_client(url, timeout=5) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                await session.send_ping()
                names = {item.name for item in (await session.list_tools()).tools}
                required = {"ollama_status", "agents_status", "vm_status"}
                if not required.issubset(names):
                    raise RuntimeError("Missing required diagnostic tools.")
        return {
            "serverAvailable": True,
            "handshakeOk": True,
            "tools": sorted(names),
            "error": None,
        }
    except ModuleNotFoundError:
        return {
            "serverAvailable": True,
            "handshakeOk": False,
            "error": "The MCP Python SDK is unavailable; run npm run start:mcp.",
        }
    except Exception:
        return {
            "serverAvailable": True,
            "handshakeOk": False,
            "error": "Local MCP server responded but its protocol handshake failed.",
        }


async def main(json_output=False):
    result = await check()
    if json_output:
        print(json.dumps(result))
        return 0
    if not result["handshakeOk"]:
        raise RuntimeError(result["error"])
    print("MCP handshake and ping OK; tools:", ", ".join(result["tools"]))
    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        raise SystemExit(asyncio.run(main(args.json)))
    except RuntimeError as error:
        raise SystemExit(str(error))
