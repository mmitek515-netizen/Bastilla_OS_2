#!/usr/bin/env python3
"""Loopback-only static UI server with a narrow proxy to the Debian 13 API."""

from __future__ import annotations

import http.client
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

UI_DIRECTORY = Path(__file__).resolve().parent
API_PATHS = {
    ("GET", "/api/v1/status"),
    ("GET", "/api/v1/agents"),
    ("GET", "/api/v1/tasks"),
    ("POST", "/api/v1/chat"),
    ("POST", "/api/v1/terminal"),
}
MAX_PROXY_BODY_BYTES = 16_384
MAX_PROXY_RESPONSE_BYTES = 1_048_576


class UiHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(UI_DIRECTORY), **kwargs)

    def end_headers(self) -> None:
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _send_error_json(self, status: int, message: str) -> None:
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _proxy_api(self) -> None:
        path = urlsplit(self.path).path
        if (self.command, path) not in API_PATHS:
            self._send_error_json(404, "Nie znaleziono endpointu API.")
            return

        body = b""
        if self.command == "POST":
            raw_length = self.headers.get("Content-Length", "")
            try:
                length = int(raw_length)
            except ValueError:
                self._send_error_json(400, "Nieprawidłowy Content-Length.")
                return
            if length < 1 or length > MAX_PROXY_BODY_BYTES:
                self._send_error_json(413, "Żądanie przekracza limit rozmiaru.")
                return
            body = self.rfile.read(length)

        try:
            api_port = int(os.environ.get("DEBIAN13_API_PORT", "8765"))
            if not 1 <= api_port <= 65535:
                raise ValueError("Invalid API port")
            connection = http.client.HTTPConnection("127.0.0.1", api_port, timeout=5)
            headers = {}
            if self.command == "POST":
                headers["Content-Type"] = self.headers.get("Content-Type", "")
            connection.request(self.command, path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read(MAX_PROXY_RESPONSE_BYTES + 1)
            status = response.status
            content_type = response.getheader("Content-Type", "application/json; charset=utf-8")
            connection.close()
        except (OSError, ValueError, http.client.HTTPException):
            self._send_error_json(502, "Runtime API Debian 13 jest niedostępne.")
            return

        if len(payload) > MAX_PROXY_RESPONSE_BYTES:
            self._send_error_json(502, "Odpowiedź API przekracza limit rozmiaru.")
            return
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if urlsplit(self.path).path.startswith("/api/"):
            self._proxy_api()
            return
        super().do_GET()

    def do_POST(self) -> None:
        self._proxy_api()

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    port = int(os.environ.get("DEBIAN13_UI_PORT", "4174"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid UI port")
    server = ThreadingHTTPServer(("127.0.0.1", port), UiHandler)
    print(f"Debian 13 UI listening on http://127.0.0.1:{port} (API proxy to loopback)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
