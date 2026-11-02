#!/usr/bin/env python3
"""Loopback HTTP smoke test; all AI responses are explicitly disabled."""

import json
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import DemoApplication, create_server
from model_adapter import OllamaAdapter


def main() -> None:
    server = create_server(
        port=0,
        application=DemoApplication(model=OllamaAdapter("", "")),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urlopen(base + "/api/v1/status", timeout=3) as response:
            status = json.loads(response.read())
        assert status["application"]["status"] == "running"
        assert status["model"]["status"] == "not_configured"
        assert status["operating_system"]["runtime"]["debian_13_boot_verified"] is False

        with urlopen(base + "/api/v1/agents", timeout=3) as response:
            agents = json.loads(response.read())["agents"]
        assert {agent["id"] for agent in agents} == {"aria", "astyria", "aurelius", "alex"}
        assert all(agent["worker"] == "not_running" for agent in agents)

        request = Request(
            base + "/api/v1/chat",
            data=json.dumps({"message": "/help", "agent": "alex"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=3) as response:
            result = json.loads(response.read())
        assert result["source"] == "local_command"
        assert result["task"]["status"] == "completed"

        request = Request(
            base + "/api/v1/terminal",
            data=json.dumps({"command": "sh -c id"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            urlopen(request, timeout=3)
        except HTTPError as error:
            assert error.code == 400
        else:
            raise AssertionError("arbitrary shell command was unexpectedly accepted")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    print("PASS Debian 13 demo loopback API smoke test (Ollama not configured; no inference claimed)")


if __name__ == "__main__":
    main()
