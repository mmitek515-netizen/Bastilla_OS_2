#!/usr/bin/env python3
"""Drive the Debian 13 UI in headless Chromium against its real loopback API."""

from __future__ import annotations

import base64
import json
import os
import signal
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from system_service_adapter import SystemServiceAdapter
from server import DemoApplication, create_server

sys.path.insert(0, str(Path(__file__).resolve().parent / "tests"))
from system_service_fixture import (
    TEST_SERVICE_TOKEN,
    start_system_service,
    stop_system_service,
)


class DevTools:
    def __init__(self, websocket_url: str):
        parsed = urlsplit(websocket_url)
        self.socket = socket.create_connection((parsed.hostname, parsed.port), timeout=5)
        self.socket.settimeout(5)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request_path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        request = (
            f"GET {request_path} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}:{parsed.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Origin: http://127.0.0.1\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(request.encode("ascii"))
        response = bytearray()
        while not response.endswith(b"\r\n\r\n"):
            chunk = self.socket.recv(1)
            if not chunk:
                raise RuntimeError("Chromium DevTools closed the websocket handshake.")
            response.extend(chunk)
        if b" 101 " not in response:
            headers = response.decode("ascii", errors="replace").split("\r\n")
            length = next(
                (int(line.split(":", 1)[1]) for line in headers if line.lower().startswith("content-length:")),
                0,
            )
            body = self._read_exactly(length).decode("utf-8", errors="replace") if length else ""
            raise RuntimeError(
                f"Chromium DevTools did not upgrade the websocket: {headers[0]} {body}"
            )
        self.sequence = 0

    def close(self) -> None:
        self.socket.close()

    def _send(self, payload: bytes, opcode: int = 1) -> None:
        mask = os.urandom(4)
        size = len(payload)
        if size < 126:
            header = bytes((0x80 | opcode, 0x80 | size))
        elif size <= 0xFFFF:
            header = bytes((0x80 | opcode, 0x80 | 126)) + struct.pack("!H", size)
        else:
            header = bytes((0x80 | opcode, 0x80 | 127)) + struct.pack("!Q", size)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.socket.sendall(header + mask + masked)

    def _read_exactly(self, size: int) -> bytes:
        result = bytearray()
        while len(result) < size:
            chunk = self.socket.recv(size - len(result))
            if not chunk:
                raise RuntimeError("Chromium DevTools websocket closed unexpectedly.")
            result.extend(chunk)
        return bytes(result)

    def _receive(self) -> str:
        fragments = bytearray()
        while True:
            first, second = self._read_exactly(2)
            opcode = first & 0x0F
            size = second & 0x7F
            if size == 126:
                size = struct.unpack("!H", self._read_exactly(2))[0]
            elif size == 127:
                size = struct.unpack("!Q", self._read_exactly(8))[0]
            mask = self._read_exactly(4) if second & 0x80 else None
            payload = self._read_exactly(size)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 8:
                raise RuntimeError("Chromium DevTools websocket closed.")
            if opcode == 9:
                self._send(payload, opcode=10)
                continue
            if opcode in {1, 2, 0}:
                fragments.extend(payload)
                if first & 0x80:
                    return fragments.decode("utf-8")

    def call(self, method: str, params: dict | None = None) -> dict:
        self.sequence += 1
        call_id = self.sequence
        self._send(
            json.dumps(
                {"id": call_id, "method": method, "params": params or {}}
            ).encode("utf-8")
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            message = json.loads(self._receive())
            if message.get("id") != call_id:
                continue
            if "error" in message:
                raise RuntimeError(f"DevTools {method} failed: {message['error']}")
            return message.get("result", {})
        raise TimeoutError(f"Timed out waiting for DevTools {method}.")

    def evaluate(self, expression: str) -> object:
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
                "userGesture": True,
            },
        )
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("text", "Browser script failed."))
        return result.get("result", {}).get("value")


def available_chromium() -> str:
    for candidate in (
        os.environ.get("CHROME_BIN"),
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
    ):
        if candidate and (Path(candidate).is_file() or shutil.which(candidate)):
            return candidate
    raise RuntimeError(
        "Browser E2E requires Chromium or Google Chrome; set CHROME_BIN if needed."
    )


def chromium_details(binary: str) -> tuple[str, str]:
    path = str(Path(shutil.which(binary) or binary).resolve())
    try:
        result = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        version = (result.stdout or result.stderr).strip()
    except (OSError, subprocess.SubprocessError) as error:
        version = f"unavailable ({type(error).__name__})"
    return path, version or "unknown"


def run_e2e() -> None:
    system_service, service_thread, service_url = start_system_service()
    app = DemoApplication(
        workspace=Path(__file__).resolve().parent / "workspace",
        model=SystemServiceAdapter(service_url, TEST_SERVICE_TOKEN),
    )
    server = create_server(port=0, application=app)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        with tempfile.TemporaryDirectory(prefix="debian13-chromium-") as profile_dir:
            chromium = available_chromium()
            chromium_path, chromium_version = chromium_details(chromium)
            print(
                f"Chromium runtime: binary={chromium_path}, version={chromium_version}",
                flush=True,
            )
            port_socket = socket.socket()
            port_socket.bind(("127.0.0.1", 0))
            port = port_socket.getsockname()[1]
            port_socket.close()
            stderr_path = Path(profile_dir) / "chromium.stderr.log"
            stderr_file = stderr_path.open("w", encoding="utf-8")
            browser = subprocess.Popen(
                [
                    chromium_path,
                    "--headless=new",
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--remote-allow-origins=http://127.0.0.1",
                    "--no-first-run",
                    "--no-default-browser-check",
                    f"--remote-debugging-port={port}",
                    f"--user-data-dir={profile_dir}",
                    "about:blank",
                ],
                stdout=subprocess.DEVNULL,
                stderr=stderr_file,
                start_new_session=True,
            )
            devtools = None
            try:
                version = None
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    process_exit = browser.poll()
                    if process_exit is not None:
                        stderr_file.flush()
                        details = stderr_path.read_text(
                            encoding="utf-8", errors="replace"
                        )
                        raise RuntimeError(
                            "Chromium exited before opening DevTools; "
                            f"binary={chromium_path!r}, version={chromium_version!r}, "
                            f"exit={process_exit}, stderr={details[-8_000:]!r}"
                        )
                    try:
                        with urllib.request.urlopen(
                            f"http://127.0.0.1:{port}/json/version", timeout=0.25
                        ) as response:
                            version = json.loads(response.read())
                        break
                    except OSError:
                        time.sleep(0.05)
                if version is None:
                    stderr_file.flush()
                    details = stderr_path.read_text(encoding="utf-8", errors="replace")
                    raise TimeoutError(
                        "Chromium did not start its DevTools endpoint within 30 seconds; "
                        f"binary={chromium_path!r}, version={chromium_version!r}, "
                        f"port={port}, process_exit={browser.poll()}, "
                        f"stderr={details[-8_000:]!r}"
                    )
                if "Chrome/" not in version.get("Browser", ""):
                    raise RuntimeError("The browser endpoint is not Chromium or Chrome.")
                page_url = (
                    f"http://127.0.0.1:{server.server_port}/"
                )
                target_request = urllib.request.Request(
                    f"http://127.0.0.1:{port}/json/new?{page_url}",
                    method="PUT",
                )
                with urllib.request.urlopen(target_request, timeout=3) as response:
                    target = json.loads(response.read())
                devtools = DevTools(target["webSocketDebuggerUrl"])
                devtools.call("Page.enable")
                devtools.call("Runtime.enable")
                devtools.call("Network.enable")
                devtools.call(
                    "Emulation.setDeviceMetricsOverride",
                    {
                        "width": 1440,
                        "height": 900,
                        "deviceScaleFactor": 1,
                        "mobile": False,
                    },
                )
                devtools.call("Page.navigate", {"url": page_url})

                ready = False
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if devtools.evaluate(
                        "document.readyState === 'complete' && "
                        "document.querySelector('#system-status')?.textContent.includes('running')"
                    ):
                        ready = True
                        break
                    time.sleep(0.1)
                if not ready:
                    raise TimeoutError("Debian 13 UI did not finish loading from HTTP.")
                diagnostics_ready = devtools.evaluate(
                    """(() => {
                      const output = document.querySelector('#diagnostics-result').textContent;
                      return output.includes('"generated_at"') &&
                        output.includes('"kvm_device"') &&
                        output.includes('"not_tested"');
                    })()"""
                )
                if not diagnostics_ready:
                    raise AssertionError("The UI did not render diagnostics from the HTTP API.")

                result = devtools.evaluate(
                    """(async () => {
                      const waitFor = async (predicate) => {
                        const deadline = Date.now() + 5000;
                        while (Date.now() < deadline) {
                          if (predicate()) return true;
                          await new Promise((resolve) => setTimeout(resolve, 25));
                        }
                        throw new Error('Timed out waiting for a UI/API result.');
                      };
                      const agents = [...document.querySelectorAll('#agents strong')]
                        .map((node) => node.textContent);
                      if (agents.join(',') !== 'Aria,Astyria,Aurelius,Alex') {
                        throw new Error('The UI did not load the four API profiles.');
                      }
                      document.querySelector('#agent').value = 'astyria';
                      document.querySelector('#message').value = 'Check the system service integration';
                      document.querySelector('#chat-form').requestSubmit();
                      await waitFor(() =>
                        sessionStorage.getItem('debian13.session.v1') &&
                        document.querySelectorAll('#chat-history li').length === 2 &&
                        document.querySelector('#chat-result').textContent.includes('system_service') &&
                        document.querySelector('#chat-result').textContent.includes('System service fixture')
                      );
                      const sessionId = sessionStorage.getItem('debian13.session.v1');
                      const roles = [...document.querySelectorAll('#chat-history strong')]
                        .map((node) => node.textContent);
                      document.querySelector('#command').value = 'pwd';
                      document.querySelector('#terminal-form').requestSubmit();
                      await waitFor(() =>
                        document.querySelector('#terminal-result').textContent.includes('restricted_terminal')
                      );
                      const terminal = document.querySelector('#terminal-result').textContent;
                      return {
                        agents,
                        roles,
                        terminal,
                        sessionId,
                        chatResult: document.querySelector('#chat-result').textContent,
                      };
                    })()"""
                )
                if result["roles"] != ["Ty · user", "astyria · assistant"]:
                    raise AssertionError(f"Unexpected agent session history: {result['roles']}")
                if not result["terminal"].endswith("."):
                    raise AssertionError(f"Unexpected terminal output: {result['terminal']}")
                if "system_service" not in result["chatResult"]:
                    raise AssertionError("The browser UI did not receive the system-service chat result.")
                if not system_service.requests or not system_service.requests[-1]["authorized"]:
                    raise AssertionError("The system service did not receive its server-side bearer token.")
                devtools.call("Page.reload", {"ignoreCache": True})
                ready = False
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if devtools.evaluate(
                        "document.readyState === 'complete' && "
                        "document.querySelectorAll('#chat-history li').length === 2"
                    ):
                        ready = True
                        break
                    time.sleep(0.1)
                if not ready:
                    raise TimeoutError("Session history did not reload in the browser UI.")
                desktop_layout_ok = devtools.evaluate(
                    "document.documentElement.scrollWidth <= window.innerWidth && "
                    "getComputedStyle(document.querySelector('.columns')).gridTemplateColumns.split(' ').length === 2"
                )
                restored = devtools.evaluate(
                    """(() => {
                      const sessionId = sessionStorage.getItem('debian13.session.v1');
                      const modelStatus = document.querySelector('#runtime-details').textContent;
                      document.querySelector('#new-session').click();
                      return {
                        sessionId,
                        modelStatus,
                        newSessionCleared:
                          !sessionStorage.getItem('debian13.session.v1') &&
                          document.querySelectorAll('#chat-history li').length === 0,
                      };
                    })()"""
                )
                devtools.call(
                    "Emulation.setDeviceMetricsOverride",
                    {
                        "width": 320,
                        "height": 800,
                        "deviceScaleFactor": 1,
                        "mobile": True,
                    },
                )
                mobile_layout_ok = devtools.evaluate(
                    "document.documentElement.scrollWidth <= window.innerWidth && "
                    "getComputedStyle(document.querySelector('.columns')).gridTemplateColumns.split(' ').length === 1"
                )
                if restored["sessionId"] != result["sessionId"] or not restored["newSessionCleared"]:
                    raise AssertionError("Session restore or reset did not work in the UI.")
                if "provider_configured" not in restored["modelStatus"]:
                    raise AssertionError("The UI did not report the system-service provider status.")
                if not desktop_layout_ok or not mobile_layout_ok:
                    raise AssertionError("The UI overflows or does not switch columns responsively.")
                print(
                    "PASS Debian 13 Chromium E2E over loopback HTTP: UI -> chat API -> "
                    "authenticated system-service contract fixture, four profiles, diagnostics, SSE, "
                    "terminal, session reload/reset, desktop and 320px layout; fixture is not model inference."
                )
            finally:
                if devtools:
                    devtools.close()
                try:
                    os.killpg(browser.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    browser.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(browser.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    browser.wait(timeout=5)
                stderr_file.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        stop_system_service(system_service, service_thread)


if __name__ == "__main__":
    run_e2e()
