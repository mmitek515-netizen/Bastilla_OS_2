"""Local Ollama adapter; never claims a model or inference is available without evidence."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator, Sequence
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

AGENT_ROLES = {
    "aria": "Zaprojektuj interfejs i zwracaj uwagę na dostępność oraz UX.",
    "astyria": "Rozpoznaj intencję. Nie proponuj dowolnych poleceń powłoki ani nie deklaruj ich wykonania.",
    "aurelius": "Analizuj bezpieczeństwo, prywatność, testy i ryzyka.",
    "alex": "Odpowiadaj jako koordynator architektury, backendu i integracji.",
}
MAX_MODEL_RESPONSE_BYTES = 1_000_000


class OllamaAdapter:
    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.model = (model or "").strip()
        if self.model and not self.base_url:
            raise ValueError("A local model URL is required when a model is configured.")
        if len(self.model) > 128 or any(ord(char) < 32 for char in self.model):
            raise ValueError("Invalid local model name.")
        self.inference_verified = False
        self._validate_local_url()

    @classmethod
    def from_environment(cls) -> "OllamaAdapter":
        return cls(
            os.environ.get("DEBIAN13_OLLAMA_URL", "http://127.0.0.1:11434"),
            os.environ.get("DEBIAN13_OLLAMA_MODEL", ""),
        )

    def _validate_local_url(self) -> None:
        if not self.base_url:
            return
        parsed = urlsplit(self.base_url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}
            or parsed.port is None
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Model adapter accepts only an explicit HTTP loopback URL.")

    def _request_json(self, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            headers={"Accept": "application/json", **({"Content-Type": "application/json"} if data else {})},
            method="POST" if data else "GET",
        )
        try:
            with urlopen(request, timeout=2.0) as response:
                declared_length = response.headers.get("Content-Length")
                if declared_length:
                    try:
                        if int(declared_length) > MAX_MODEL_RESPONSE_BYTES:
                            raise RuntimeError("Model response exceeded the size limit.")
                    except ValueError as error:
                        raise RuntimeError("Model returned an invalid response size.") from error
                payload = response.read(MAX_MODEL_RESPONSE_BYTES + 1)
        except (OSError, URLError, TimeoutError) as error:
            raise RuntimeError("Model niedostępny; nie wygenerowano odpowiedzi.") from error
        if len(payload) > MAX_MODEL_RESPONSE_BYTES:
            raise RuntimeError("Model response exceeded the size limit.")
        try:
            result = json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("Model returned an invalid response.") from error
        if not isinstance(result, dict):
            raise RuntimeError("Model returned an invalid response.")
        return result

    def status(self) -> dict:
        if not self.model:
            return {
                "provider": "ollama",
                "status": "not_configured",
                "model": None,
                "inference": "not_verified",
            }
        try:
            tags = self._request_json("/api/tags")
        except RuntimeError:
            return {
                "provider": "ollama",
                "status": "unavailable",
                "model": self.model,
                "inference": "not_verified",
            }
        models = tags.get("models")
        available = isinstance(models, list) and any(
            isinstance(item, dict) and item.get("name") == self.model for item in models
        )
        return {
            "provider": "ollama",
            "status": "model_available" if available else "model_missing",
            "model": self.model,
            "inference": "verified" if self.inference_verified else "not_verified",
        }

    def chat(
        self,
        agent: str,
        message: str,
        history: Sequence[dict[str, str]] = (),
    ) -> str:
        if not self.model:
            raise RuntimeError("Brak skonfigurowanego modelu. Ustaw DEBIAN13_OLLAMA_MODEL.")
        messages = [{"role": "system", "content": AGENT_ROLES[agent]}]
        messages.extend(
            item
            for item in history[-40:]
            if item.get("role") in {"user", "assistant"}
            and isinstance(item.get("content"), str)
        )
        messages.append({"role": "user", "content": message})
        result = self._request_json(
            "/api/chat",
            {
                "model": self.model,
                "stream": False,
                "messages": messages,
            },
        )
        message_result = result.get("message")
        content = message_result.get("content") if isinstance(message_result, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("Model returned no answer.")
        self.inference_verified = True
        return content.strip()

    def chat_stream(
        self,
        agent: str,
        message: str,
        history: Sequence[dict[str, str]] = (),
    ) -> Iterator[str]:
        if not self.model:
            raise RuntimeError("Brak skonfigurowanego modelu. Ustaw DEBIAN13_OLLAMA_MODEL.")
        messages = [{"role": "system", "content": AGENT_ROLES[agent]}]
        messages.extend(
            item
            for item in history[-40:]
            if item.get("role") in {"user", "assistant"}
            and isinstance(item.get("content"), str)
        )
        messages.append({"role": "user", "content": message})
        body = json.dumps(
            {"model": self.model, "stream": True, "messages": messages}
        ).encode("utf-8")
        request = Request(
            f"{self.base_url}/api/chat",
            data=body,
            headers={"Accept": "application/x-ndjson", "Content-Type": "application/json"},
            method="POST",
        )
        total_bytes = 0
        response_parts: list[str] = []
        try:
            with urlopen(request, timeout=15.0) as response:
                while True:
                    line = response.readline(MAX_MODEL_RESPONSE_BYTES + 1)
                    if not line:
                        break
                    total_bytes += len(line)
                    if total_bytes > MAX_MODEL_RESPONSE_BYTES:
                        raise RuntimeError("Model response exceeded the size limit.")
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except (json.JSONDecodeError, UnicodeDecodeError) as error:
                        raise RuntimeError("Model returned an invalid stream.") from error
                    if not isinstance(event, dict):
                        raise RuntimeError("Model returned an invalid stream.")
                    if event.get("error"):
                        raise RuntimeError("Model returned an error.")
                    event_message = event.get("message")
                    content = event_message.get("content") if isinstance(event_message, dict) else None
                    if content is not None:
                        if not isinstance(content, str):
                            raise RuntimeError("Model returned an invalid stream.")
                        if content:
                            response_parts.append(content)
                            yield content
                    if event.get("done") is True:
                        if not response_parts:
                            raise RuntimeError("Model returned no answer.")
                        self.inference_verified = True
                        return
        except (OSError, URLError, TimeoutError) as error:
            raise RuntimeError("Model niedostępny; nie wygenerowano odpowiedzi.") from error
        raise RuntimeError("Model returned an incomplete stream.")
