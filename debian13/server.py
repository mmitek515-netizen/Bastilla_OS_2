#!/usr/bin/env python3
"""Loopback-only Debian 13 user-space demo API."""

from __future__ import annotations

import json
import os
import platform
import shlex
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from model_adapter import OllamaAdapter

API_VERSION = "v1"
MAX_BODY_BYTES = 16_384
MAX_MESSAGE_LENGTH = 12_000
MAX_TASKS = 100
MAX_EVENTS = 200
WORKSPACE = Path(__file__).resolve().parent / "workspace"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}
AGENTS = {
    "aria": {
        "name": "Aria",
        "role": "Interfejs, dostępność i wygoda obsługi.",
    },
    "astyria": {
        "name": "Astyria",
        "role": "Intencje czatu i bezpieczne, kontrolowane operacje.",
    },
    "aurelius": {
        "name": "Aurelius",
        "role": "Testy, bezpieczeństwo i prywatność.",
    },
    "alex": {
        "name": "Alex",
        "role": "Architektura, backend i integracja.",
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def debian_runtime() -> dict[str, str | bool]:
    release: dict[str, str] = {}
    try:
        for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator:
                release[key] = value.strip('"')
    except OSError:
        pass
    verified = release.get("ID") == "debian" and release.get("VERSION_ID") == "13"
    return {
        "platform": platform.platform(),
        "distribution": release.get("PRETTY_NAME", "nieznana"),
        "debian_13_boot_verified": verified,
    }


class DemoApplication:
    def __init__(
        self,
        workspace: Path = WORKSPACE,
        model: OllamaAdapter | None = None,
    ) -> None:
        self.workspace = workspace.resolve()
        self.model = model or OllamaAdapter.from_environment()
        self._lock = threading.Lock()
        self._tasks: list[dict] = []
        self._events: list[dict] = []

    def _event(self, event_type: str, agent: str, task_id: str) -> None:
        with self._lock:
            self._events.append(
                {"at": utc_now(), "type": event_type, "agent": agent, "task_id": task_id}
            )
            self._events = self._events[-MAX_EVENTS:]

    def start_task(self, agent: str, kind: str) -> dict:
        task = {
            "id": str(uuid.uuid4()),
            "agent": agent,
            "kind": kind,
            "status": "queued",
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "result": None,
            "error": None,
        }
        with self._lock:
            self._tasks.append(task)
            self._tasks = self._tasks[-MAX_TASKS:]
        self._event("task.queued", agent, task["id"])
        return task

    def update_task(self, task: dict, status: str, **fields: str | None) -> dict:
        task.update(status=status, updated_at=utc_now(), **fields)
        with self._lock:
            for index, current in enumerate(self._tasks):
                if current["id"] == task["id"]:
                    self._tasks[index] = dict(task)
                    break
        self._event(f"task.{status}", task["agent"], task["id"])
        return dict(task)

    def tasks(self) -> list[dict]:
        with self._lock:
            return [dict(task) for task in reversed(self._tasks)]

    def events(self) -> list[dict]:
        with self._lock:
            return [dict(event) for event in reversed(self._events)]

    def status(self) -> dict:
        model_status = self.model.status()
        return {
            "api_version": API_VERSION,
            "application": {"status": "running", "product": "Debian 13 user-space demo"},
            "operating_system": {
                "target": "Debian 13",
                "runtime": debian_runtime(),
            },
            "model": model_status,
            "task_state": "in-memory; cleared on restart",
            "agents": self.agent_status(),
        }

    def agent_status(self) -> list[dict]:
        return [
            {
                "id": agent_id,
                **profile,
                "status": "profile_configured",
                "worker": "not_running",
                "model_backend": "shared_ollama_adapter",
            }
            for agent_id, profile in AGENTS.items()
        ]

    def terminal(self, command: str) -> str:
        try:
            parts = shlex.split(command)
        except ValueError as error:
            raise ValueError("Nieprawidłowa składnia polecenia.") from error
        if not parts or len(command) > 500:
            raise ValueError("Podaj krótkie, dozwolone polecenie.")

        operation, *arguments = parts
        if operation == "pwd" and not arguments:
            return "."
        if operation == "ls" and not arguments:
            try:
                return "\n".join(sorted(entry.name for entry in self.workspace.iterdir())) or "(pusty katalog)"
            except OSError as error:
                raise ValueError("Nie można odczytać katalogu roboczego.") from error
        if operation == "cat" and len(arguments) == 1:
            relative = Path(arguments[0])
            if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
                raise ValueError("cat obsługuje wyłącznie ścieżki względne w katalogu roboczym.")
            target = (self.workspace / relative).resolve()
            if not target.is_relative_to(self.workspace) or not target.is_file():
                raise ValueError("Plik nie istnieje w katalogu roboczym.")
            try:
                content = target.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as error:
                raise ValueError("Nie można odczytać pliku tekstowego.") from error
            if len(content.encode("utf-8")) > 64_000:
                raise ValueError("Plik przekracza limit odczytu 64 kB.")
            return content
        raise ValueError("Dozwolone są wyłącznie: pwd, ls oraz cat <plik-tekstowy>.")


class Debian13Handler(BaseHTTPRequestHandler):
    server_version = "Debian13Demo/0.1"

    @property
    def application(self) -> DemoApplication:
        return self.server.application  # type: ignore[attr-defined]

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Wymagany Content-Type: application/json.")
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ValueError("Nieprawidłowy Content-Length.") from error
        if length < 1 or length > MAX_BODY_BYTES:
            raise ValueError("Nieprawidłowy rozmiar żądania.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Nieprawidłowy JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Żądanie musi być obiektem JSON.")
        return payload

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path in STATIC_FILES:
            filename, content_type = STATIC_FILES[path]
            body = (Path(__file__).resolve().parent / filename).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == f"/api/{API_VERSION}/status":
            self._send_json(200, self.application.status())
        elif path == f"/api/{API_VERSION}/agents":
            self._send_json(200, {"agents": self.application.agent_status()})
        elif path == f"/api/{API_VERSION}/tasks":
            self._send_json(200, {"tasks": self.application.tasks()})
        elif path == f"/api/{API_VERSION}/events":
            self._send_json(200, {"events": self.application.events()})
        else:
            self._send_json(404, {"error": "Nie znaleziono endpointu."})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path not in {f"/api/{API_VERSION}/chat", f"/api/{API_VERSION}/terminal"}:
            self._send_json(404, {"error": "Nie znaleziono endpointu."})
            return
        try:
            payload = self._read_json()
            if path.endswith("/chat"):
                self._handle_chat(payload)
            else:
                self._handle_terminal(payload)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})

    def _handle_chat(self, payload: dict) -> None:
        if set(payload) != {"message", "agent"}:
            self._send_json(400, {"error": "Wymagane są wyłącznie pola message i agent."})
            return
        message, agent = payload["message"], payload["agent"]
        if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_LENGTH:
            self._send_json(400, {"error": f"Wiadomość musi zawierać 1–{MAX_MESSAGE_LENGTH} znaków."})
            return
        if not isinstance(agent, str) or agent not in AGENTS:
            self._send_json(400, {"error": "Nieznany profil agenta."})
            return

        task = self.application.start_task(agent, "chat")
        self.application.update_task(task, "running")
        message = message.strip()
        if message == "/help":
            reply = "Obsługiwane lokalne polecenia: /help, /status, /terminal pwd, /terminal ls, /terminal cat <plik>. Pozostałe wiadomości wymagają dostępnego modelu Ollama."
            source = "local_command"
        elif message == "/status":
            reply = json.dumps(self.application.status(), ensure_ascii=False)
            source = "local_status"
        elif message.startswith("/terminal "):
            try:
                reply = self.application.terminal(message.removeprefix("/terminal ").strip())
            except ValueError as error:
                self.application.update_task(task, "failed", error=str(error))
                self._send_json(400, {"error": str(error), "task": task})
                return
            source = "restricted_terminal"
        elif message.startswith("/"):
            error = "Nieobsługiwane polecenie czatu."
            self.application.update_task(task, "failed", error=error)
            self._send_json(400, {"error": error, "task": task})
            return
        else:
            try:
                reply = self.application.model.chat(agent, message)
            except RuntimeError as error:
                public_error = str(error)
                self.application.update_task(task, "failed", error=public_error)
                self._send_json(503, {"error": public_error, "task": task})
                return
            source = "ollama"

        completed = self.application.update_task(task, "completed", result=reply)
        self._send_json(
            200,
            {"reply": reply, "source": source, "agent": agent, "task": completed},
        )

    def _handle_terminal(self, payload: dict) -> None:
        if set(payload) != {"command"} or not isinstance(payload["command"], str):
            self._send_json(400, {"error": "Wymagane jest pole command typu tekstowego."})
            return
        task = self.application.start_task("alex", "terminal")
        self.application.update_task(task, "running")
        try:
            output = self.application.terminal(payload["command"])
        except ValueError as error:
            self.application.update_task(task, "failed", error=str(error))
            self._send_json(400, {"error": str(error), "task": task})
            return
        completed = self.application.update_task(task, "completed", result=output)
        self._send_json(200, {"output": output, "source": "restricted_terminal", "task": completed})

    def log_message(self, format: str, *args: object) -> None:
        # Avoid writing request content, credentials, or model output to stdout.
        return


def create_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    application: DemoApplication | None = None,
) -> ThreadingHTTPServer:
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("Demo API can bind only to loopback.")
    server = ThreadingHTTPServer((host, port), Debian13Handler)
    server.daemon_threads = True
    server.application = application or DemoApplication()  # type: ignore[attr-defined]
    return server


def main() -> None:
    port = int(os.environ.get("DEBIAN13_PORT", "8765"))
    server = create_server(port=port)
    print(f"Debian 13 user-space demo listening on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
