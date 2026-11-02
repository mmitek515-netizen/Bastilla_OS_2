#!/usr/bin/env python3
"""Read-only MCP stdio adapter for the standalone Debian 13 demo."""

from __future__ import annotations

import json
import sys
from typing import Any

from server import DemoApplication

PROTOCOL_VERSION = "2025-03-26"
MAX_MESSAGE_BYTES = 16_384
ERROR_PARSE = -32700
ERROR_INVALID_REQUEST = -32600
ERROR_METHOD_NOT_FOUND = -32601
ERROR_INVALID_PARAMS = -32602
ERROR_NOT_INITIALIZED = -32002


class McpStdioServer:
    def __init__(self, application: DemoApplication | None = None) -> None:
        self.application = application or DemoApplication()
        self.negotiated = False
        self.initialized = False

    def handle(self, message: Any) -> dict | None:
        if not isinstance(message, dict):
            return self._error(None, ERROR_INVALID_REQUEST, "Invalid Request")
        if message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
            return self._error(message.get("id"), ERROR_INVALID_REQUEST, "Invalid Request")

        method = message["method"]
        request_id = message.get("id")
        if request_id is not None and (
            isinstance(request_id, bool) or not isinstance(request_id, (str, int))
        ):
            return self._error(None, ERROR_INVALID_REQUEST, "Invalid Request")
        if method.startswith("notifications/"):
            if request_id is not None:
                return self._error(request_id, ERROR_INVALID_REQUEST, "Notifications must not have an id")
            if method == "notifications/initialized" and self.negotiated:
                self.initialized = True
            return None
        if request_id is None:
            return None

        params = message.get("params", {})
        if not isinstance(params, dict):
            return self._error(request_id, ERROR_INVALID_PARAMS, "params must be an object")

        if method == "initialize":
            self.negotiated = True
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "debian13-readonly", "version": "1.0.0"},
                },
            }
        if method == "ping":
            return {"jsonrpc": "2.0", "id": request_id, "result": {}}
        if method == "tools/list":
            if not self.initialized:
                return self._error(request_id, ERROR_NOT_INITIALIZED, "Server not initialized")
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [
                        {
                            "name": "system_status",
                            "description": "Read the current Debian 13 demo application and model status.",
                            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
                        },
                        {
                            "name": "system_diagnostics",
                            "description": "Read local runtime, resource, and tool availability diagnostics.",
                            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
                        },
                    ]
                },
            }
        if method == "tools/call":
            if not self.initialized:
                return self._error(request_id, ERROR_NOT_INITIALIZED, "Server not initialized")
            name = params.get("name")
            arguments = params.get("arguments", {})
            if not isinstance(arguments, dict) or arguments:
                return self._error(request_id, ERROR_INVALID_PARAMS, "Tool accepts no arguments")
            if name == "system_status":
                result = self.application.status()
            elif name == "system_diagnostics":
                result = self.application.diagnostics()
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "content": [{"type": "text", "text": "Unknown read-only tool"}],
                        "isError": True,
                    },
                }
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                        }
                    ],
                    "isError": False,
                },
            }
        return self._error(request_id, ERROR_METHOD_NOT_FOUND, "Method not found")

    @staticmethod
    def _error(request_id: str | int | None, code: int, message: str) -> dict:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        }

    def serve(self, source, destination) -> None:
        while line := source.readline(MAX_MESSAGE_BYTES + 1):
            if len(line) > MAX_MESSAGE_BYTES:
                if not line.endswith(b"\n"):
                    while chunk := source.readline(MAX_MESSAGE_BYTES + 1):
                        if chunk.endswith(b"\n"):
                            break
                response = self._error(None, ERROR_PARSE, "Message too large")
            else:
                try:
                    message = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    response = self._error(None, ERROR_PARSE, "Parse error")
                else:
                    response = self.handle(message)
            if response is not None:
                destination.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
                destination.flush()


def main() -> None:
    McpStdioServer().serve(sys.stdin.buffer, sys.stdout)


if __name__ == "__main__":
    main()
