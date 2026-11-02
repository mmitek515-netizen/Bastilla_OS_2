import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


DEBIAN13_DIR = Path(__file__).resolve().parents[1]
MCP_SERVER = DEBIAN13_DIR / "mcp_server.py"


class McpStdioTests(unittest.TestCase):
    def test_stdio_handshake_lists_read_only_tools_and_calls_real_local_status(self):
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 7, "method": "ping"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "system_status"}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "system_diagnostics"}},
            {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "execute_shell"}},
            {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "system_status", "arguments": {"command": "id"}}},
        ]
        environment = dict(os.environ)
        environment.pop("DEBIAN13_OLLAMA_MODEL", None)
        completed = subprocess.run(
            [sys.executable, str(MCP_SERVER)],
            input="".join(json.dumps(item) + "\n" for item in requests),
            capture_output=True,
            text=True,
            timeout=10,
            env=environment,
            check=True,
        )

        responses = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual([response["id"] for response in responses], [1, 7, 2, 3, 4, 5, 6])
        self.assertEqual(responses[1]["result"], {})
        self.assertEqual(responses[2]["result"]["tools"][0]["name"], "system_status")
        self.assertEqual(responses[2]["result"]["tools"][1]["name"], "system_diagnostics")
        self.assertEqual(responses[3]["result"]["content"][0]["type"], "text")
        status = json.loads(responses[3]["result"]["content"][0]["text"])
        self.assertEqual(status["application"]["status"], "running")
        self.assertEqual(status["model"]["status"], "not_configured")
        diagnostics = json.loads(responses[4]["result"]["content"][0]["text"])
        self.assertEqual(diagnostics["integrations"]["mcp"]["connection"], "not_tested")
        self.assertTrue(responses[5]["result"]["isError"])
        self.assertEqual(responses[6]["error"]["code"], -32602)
        self.assertEqual(completed.stderr, "")

    def test_selects_its_supported_protocol_version_when_client_requests_another(self):
        request = {
            "jsonrpc": "2.0",
            "id": 9,
            "method": "initialize",
            "params": {"protocolVersion": "unsupported"},
        }
        completed = subprocess.run(
            [sys.executable, str(MCP_SERVER)],
            input=json.dumps(request) + "\n",
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        response = json.loads(completed.stdout)
        self.assertEqual(response["result"]["protocolVersion"], "2025-03-26")


if __name__ == "__main__":
    unittest.main()
