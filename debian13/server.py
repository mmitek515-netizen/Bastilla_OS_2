#!/usr/bin/env python3
"""Loopback-only Debian 13 user-space demo API."""

from __future__ import annotations

import json
import os
import platform
import shutil
import shlex
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from model_adapter import MAX_MODEL_RESPONSE_BYTES, OllamaAdapter

API_VERSION = "v1"
MAX_BODY_BYTES = 16_384
MAX_MESSAGE_LENGTH = 12_000
MAX_TASKS = 100
MAX_EVENTS = 200
MAX_SESSIONS = 100
MAX_SESSION_MESSAGES = 40
MAX_SESSION_BYTES = 64_000
MAX_TASK_RESULT_BYTES = 16_000
SESSION_TTL_SECONDS = 3600
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


def bounded_text(value: str, max_bytes: int) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value
    marker = "\n[treść skrócona]"
    limit = max(0, max_bytes - len(marker.encode("utf-8")))
    return encoded[:limit].decode("utf-8", errors="ignore") + marker


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


def memory_metrics() -> dict[str, int | str | None]:
    try:
        values = {}
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition(":")
            if separator and key in {"MemTotal", "MemAvailable"}:
                values[key] = int(value.strip().split()[0]) * 1024
        total = values.get("MemTotal")
        available = values.get("MemAvailable")
        if total is None or available is None:
            raise ValueError("Memory metrics are incomplete.")
        return {"status": "available", "total_bytes": total, "available_bytes": available}
    except (OSError, ValueError, IndexError):
        return {"status": "unavailable", "total_bytes": None, "available_bytes": None}


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
        self._sessions: dict[str, dict] = {}
        self.started_at = time.monotonic()

    def get_session(self, session_id: str | None = None) -> dict | None:
        now = time.monotonic()
        with self._lock:
            expired = [
                key
                for key, session in self._sessions.items()
                if now - session["last_access"] > SESSION_TTL_SECONDS
            ]
            for key in expired:
                del self._sessions[key]
            if session_id is not None:
                try:
                    if str(uuid.UUID(session_id)) != session_id:
                        return None
                except (ValueError, AttributeError):
                    return None
                session = self._sessions.get(session_id)
                if session is None:
                    return None
                session["last_access"] = now
                return session

            if len(self._sessions) >= MAX_SESSIONS:
                oldest = min(self._sessions, key=lambda key: self._sessions[key]["last_access"])
                del self._sessions[oldest]
            session_id = str(uuid.uuid4())
            session = {
                "id": session_id,
                "created_at": utc_now(),
                "updated_at": utc_now(),
                "last_access": now,
                "messages": [],
                "lock": threading.Lock(),
                "chat_lock": threading.Lock(),
            }
            self._sessions[session_id] = session
            return session

    def session_messages(self, session_id: str) -> list[dict] | None:
        session = self.get_session(session_id)
        if session is None:
            return None
        with session["lock"]:
            return [dict(message) for message in session["messages"]]

    def append_exchange(
        self,
        session: dict,
        agent: str,
        user_message: str,
        assistant_message: str,
        source: str,
    ) -> None:
        now = utc_now()
        with session["lock"]:
            user_budget = min(
                len(user_message.encode("utf-8")), MAX_SESSION_BYTES // 2
            )
            stored_user = bounded_text(user_message, user_budget)
            stored_assistant = bounded_text(
                assistant_message, MAX_SESSION_BYTES - len(stored_user.encode("utf-8"))
            )
            session["messages"].extend(
                [
                    {
                        "role": "user",
                        "content": stored_user,
                        "agent": agent,
                        "source": source,
                        "created_at": now,
                    },
                    {
                        "role": "assistant",
                        "content": stored_assistant,
                        "agent": agent,
                        "source": source,
                        "created_at": now,
                    },
                ]
            )
            session["messages"] = session["messages"][-MAX_SESSION_MESSAGES:]
            while (
                sum(len(item["content"].encode("utf-8")) for item in session["messages"])
                > MAX_SESSION_BYTES
            ):
                session["messages"] = session["messages"][2:]
            session["updated_at"] = now
            session["last_access"] = time.monotonic()

    def model_history(self, session: dict) -> list[dict[str, str]]:
        with session["lock"]:
            return [
                {"role": item["role"], "content": item["content"]}
                for item in session["messages"]
                if item["source"] == "ollama"
            ][-MAX_SESSION_MESSAGES:]

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
        result = fields.get("result")
        if isinstance(result, str):
            fields["result"] = bounded_text(result, MAX_TASK_RESULT_BYTES)
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

    def diagnostics(self) -> dict:
        kvm_device = Path("/dev/kvm")
        if not kvm_device.exists():
            kvm_status = "unavailable"
        elif os.access(kvm_device, os.R_OK | os.W_OK):
            kvm_status = "available"
        else:
            kvm_status = "permission_denied"
        try:
            disk = shutil.disk_usage(self.workspace)
            workspace = {
                "status": "available",
                "total_bytes": disk.total,
                "free_bytes": disk.free,
            }
        except OSError:
            workspace = {
                "status": "unavailable",
                "total_bytes": None,
                "free_bytes": None,
            }
        return {
            "generated_at": utc_now(),
            "application": {
                "status": "running",
                "uptime_seconds": max(0, int(time.monotonic() - self.started_at)),
            },
            "runtime": {
                "python": platform.python_version(),
                "system": platform.system(),
                "kernel": platform.release(),
                "architecture": platform.machine(),
                "cpu_count": os.cpu_count(),
                "operating_system": debian_runtime(),
            },
            "resources": {
                "memory": memory_metrics(),
                "workspace": workspace,
            },
            "virtualization": {
                "kvm_device": {"status": kvm_status},
                "qemu_x86_64_binary": "available" if shutil.which("qemu-system-x86_64") else "unavailable",
                "docker_binary": "available" if shutil.which("docker") else "unavailable",
            },
            "integrations": {
                "model": self.model.status(),
                "agents": [
                    {"id": agent["id"], "worker": agent["worker"]}
                    for agent in self.agent_status()
                ],
                "mcp": {"implementation": "not_implemented", "connection": "not_tested"},
                "gpt_actions": {"implementation": "not_implemented", "connection": "not_tested"},
            },
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
        elif path == f"/api/{API_VERSION}/diagnostics":
            self._send_json(200, self.application.diagnostics())
        elif path == f"/api/{API_VERSION}/agents":
            self._send_json(200, {"agents": self.application.agent_status()})
        elif path == f"/api/{API_VERSION}/tasks":
            self._send_json(200, {"tasks": self.application.tasks()})
        elif path == f"/api/{API_VERSION}/events":
            self._send_json(200, {"events": self.application.events()})
        elif path.startswith(f"/api/{API_VERSION}/sessions/"):
            parts = path.strip("/").split("/")
            if len(parts) != 5 or parts[2] != "sessions" or parts[4] != "messages":
                self._send_json(404, {"error": "Nie znaleziono endpointu."})
                return
            session_id = parts[3]
            messages = self.application.session_messages(session_id)
            if messages is None:
                self._send_json(404, {"error": "Sesja nie istnieje lub wygasła."})
            else:
                self._send_json(200, {"session_id": session_id, "messages": messages})
        else:
            self._send_json(404, {"error": "Nie znaleziono endpointu."})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path not in {
            f"/api/{API_VERSION}/chat",
            f"/api/{API_VERSION}/chat/stream",
            f"/api/{API_VERSION}/terminal",
        }:
            self._send_json(404, {"error": "Nie znaleziono endpointu."})
            return
        try:
            payload = self._read_json()
            if path in {f"/api/{API_VERSION}/chat", f"/api/{API_VERSION}/chat/stream"}:
                self._handle_chat(payload, streaming=path.endswith("/stream"))
            else:
                self._handle_terminal(payload)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})

    def _handle_chat(self, payload: dict, streaming: bool = False) -> None:
        if not {"message", "agent"} <= set(payload) or set(payload) - {
            "message",
            "agent",
            "session_id",
        }:
            self._send_json(400, {"error": "Wymagane są pola message i agent; opcjonalne pole to session_id."})
            return
        message, agent = payload["message"], payload["agent"]
        if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_LENGTH:
            self._send_json(400, {"error": f"Wiadomość musi zawierać 1–{MAX_MESSAGE_LENGTH} znaków."})
            return
        if not isinstance(agent, str) or agent not in AGENTS:
            self._send_json(400, {"error": "Nieznany profil agenta."})
            return
        session_id = payload.get("session_id")
        if session_id is not None and not isinstance(session_id, str):
            self._send_json(400, {"error": "session_id musi być identyfikatorem tekstowym."})
            return
        session = self.application.get_session(session_id)
        if session is None:
            self._send_json(404, {"error": "Sesja nie istnieje lub wygasła."})
            return

        with session["chat_lock"]:
            if streaming:
                self._handle_stream_chat(session, agent, message.strip())
            else:
                self._handle_json_chat(session, agent, message.strip())

    def _handle_json_chat(self, session: dict, agent: str, message: str) -> None:
        task = self.application.start_task(agent, "chat")
        self.application.update_task(task, "running")
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
                reply = self.application.model.chat(
                    agent, message, self.application.model_history(session)
                )
            except RuntimeError as error:
                public_error = str(error)
                self.application.update_task(task, "failed", error=public_error)
                self._send_json(503, {"error": public_error, "task": task})
                return
            source = "ollama"

        self.application.append_exchange(session, agent, message, reply, source)
        completed = self.application.update_task(task, "completed", result=reply)
        self._send_json(
            200,
            {
                "reply": reply,
                "source": source,
                "agent": agent,
                "session_id": session["id"],
                "task": completed,
            },
        )

    def _handle_stream_chat(self, session: dict, agent: str, message: str) -> None:
        task = self.application.start_task(agent, "chat")
        self.application.update_task(task, "running")
        source = "ollama"
        try:
            local_reply = self._local_reply(message)
            if local_reply is None:
                reply_stream = self.application.model.chat_stream(
                    agent, message, self.application.model_history(session)
                )
            else:
                source, reply = local_reply
                reply_stream = (
                    reply[index : index + 64]
                    for index in range(0, len(reply), 64)
                )
        except (RuntimeError, ValueError) as error:
            self.application.update_task(task, "failed", error=str(error))
            self._send_json(
                400 if isinstance(error, ValueError) else 503,
                {"error": str(error), "task": task},
            )
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        parts: list[str] = []
        total_bytes = 0
        try:
            self._send_sse("meta", {"session_id": session["id"], "task_id": task["id"]})
            for chunk in reply_stream:
                if not chunk:
                    continue
                total_bytes += len(chunk.encode("utf-8"))
                if total_bytes > MAX_MODEL_RESPONSE_BYTES:
                    raise RuntimeError("Model response exceeded the size limit.")
                parts.append(chunk)
                self._send_sse("delta", {"text": chunk})
            reply = "".join(parts).strip()
            if not reply:
                raise RuntimeError("Model returned no answer.")
        except (BrokenPipeError, ConnectionResetError):
            self.application.update_task(
                task, "failed", error="Klient przerwał połączenie ze strumieniem."
            )
            return
        except RuntimeError as error:
            failed = self.application.update_task(task, "failed", error=str(error))
            try:
                self._send_sse("error", {"error": str(error), "task": failed})
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        self.application.append_exchange(session, agent, message, reply, source)
        completed = self.application.update_task(task, "completed", result=reply)
        try:
            self._send_sse(
                "done",
                {
                    "session_id": session["id"],
                    "source": source,
                    "agent": agent,
                    "task": {"id": completed["id"], "status": completed["status"]},
                },
            )
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _local_reply(self, message: str) -> tuple[str, str] | None:
        if message == "/help":
            return (
                "local_command",
                "Obsługiwane lokalne polecenia: /help, /status, /terminal pwd, /terminal ls, /terminal cat <plik>. Pozostałe wiadomości wymagają dostępnego modelu Ollama.",
            )
        if message == "/status":
            return "local_status", json.dumps(self.application.status(), ensure_ascii=False)
        if message.startswith("/terminal "):
            return (
                "restricted_terminal",
                self.application.terminal(message.removeprefix("/terminal ").strip()),
            )
        if message.startswith("/"):
            raise ValueError("Nieobsługiwane polecenie czatu.")
        return None

    def _send_sse(self, event: str, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        self.wfile.write(f"event: {event}\ndata: {data}\n\n".encode("utf-8"))
        self.wfile.flush()

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
