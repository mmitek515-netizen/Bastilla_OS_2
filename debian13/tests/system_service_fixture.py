"""Local contract fixture for the authenticated Debian 13 system API."""

from __future__ import annotations

import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

TEST_SERVICE_TOKEN = "x" * 32


class SystemServiceFixtureHandler(BaseHTTPRequestHandler):
    server: ThreadingHTTPServer

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        expected = ("Bearer " + self.server.expected_token).encode()
        supplied = self.headers.get("Authorization", "").encode()
        authorized = hmac.compare_digest(supplied, expected)
        self.server.requests.append(
            {
                "path": self.path,
                "authorized": authorized,
            }
        )
        if not authorized:
            self._send_json(
                401,
                {
                    "error": {
                        "code": "unauthorized",
                        "message": "A valid bearer token is required.",
                        "requestId": "fixture-request",
                    }
                },
            )
        return authorized

    def do_GET(self) -> None:
        if not self._authorized():
            return
        if self.path != "/v1/profiles":
            self._send_json(404, {"error": {"code": "not_found"}})
            return
        self._send_json(
            200,
            {
                "profiles": [],
                "providerConfigured": True,
            },
        )

    def do_POST(self) -> None:
        if not self._authorized():
            return
        if self.path != "/v1/chat":
            self._send_json(404, {"error": {"code": "not_found"}})
            return
        try:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        except (KeyError, ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": {"code": "invalid_json"}})
            return
        self.server.requests[-1]["payload"] = payload
        profile = payload.get("profile")
        message = payload.get("message")
        if not isinstance(profile, str) or not isinstance(message, str):
            self._send_json(400, {"error": {"code": "invalid_chat_request"}})
            return
        self._send_json(
            200,
            {
                "requestId": "fixture-request",
                "profile": profile,
                "content": f"System service fixture: {message}",
                "model": "contract-test-double",
            },
        )

    def log_message(self, _format: str, *_args: object) -> None:
        return


def start_system_service(
    token: str = TEST_SERVICE_TOKEN,
) -> tuple[ThreadingHTTPServer, Thread, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), SystemServiceFixtureHandler)
    server.expected_token = token
    server.requests = []
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}"


def stop_system_service(server: ThreadingHTTPServer, thread: Thread) -> None:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
