"""Server-side adapter for the authenticated Debian 13 system service."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_SYSTEM_MESSAGE_LENGTH = 4_000
MAX_SYSTEM_REQUEST_BYTES = 16_384
MAX_SYSTEM_RESPONSE_BYTES = 64_000
SYSTEM_SERVICE_TIMEOUT_SECONDS = 47.0
SYSTEM_SERVICE_PATHS = {"/v1/profiles", "/v1/chat"}


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, new_url):
        return None


def validate_system_service_url(value: str) -> str:
    if not value:
        return ""
    if len(value) > 2_048:
        raise ValueError("System service URL is too long.")
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        parsed.port
    except ValueError as error:
        raise ValueError("Invalid system service URL.") from error
    loopback_http = parsed.scheme == "http" and hostname in {
        "127.0.0.1",
        "::1",
        "localhost",
    }
    if (
        not hostname
        or (parsed.scheme != "https" and not loopback_http)
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("System service URL must use HTTPS or an HTTP loopback origin.")
    return value.rstrip("/")


class SystemServiceAdapter:
    source = "system_service"
    max_message_length = MAX_SYSTEM_MESSAGE_LENGTH

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = validate_system_service_url(base_url)
        self.token = token if isinstance(token, str) else ""
        safe_token = self.token.isascii() and all(
            0x21 <= ord(char) <= 0x7E for char in self.token
        )
        self.configured = bool(
            self.base_url and safe_token and len(self.token) >= 32
        )
        self.inference_verified = False

    @classmethod
    def from_environment(cls) -> "SystemServiceAdapter":
        return cls(
            os.environ.get("DEBIAN13_SYSTEM_API_URL", "").strip(),
            os.environ.get("DEBIAN13_SYSTEM_API_TOKEN", ""),
        )

    def _request_json(self, path: str, body: dict | None = None) -> dict:
        if path not in SYSTEM_SERVICE_PATHS:
            raise RuntimeError("System service route is not allowed.")
        if not self.configured:
            raise RuntimeError("System service is not configured.")
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        if data is not None and len(data) > MAX_SYSTEM_REQUEST_BYTES:
            raise RuntimeError("System service request exceeded the size limit.")
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            headers={
                "Accept": "application/json",
                "Authorization": "Bearer " + self.token,
                **(
                    {"Content-Type": "application/json"}
                    if data is not None
                    else {}
                ),
            },
            method="POST" if data is not None else "GET",
        )
        timeout = SYSTEM_SERVICE_TIMEOUT_SECONDS if path == "/v1/chat" else 2.0
        try:
            with build_opener(NoRedirectHandler()).open(request, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError("System service returned an unexpected status.")
                declared_length = response.headers.get("Content-Length")
                if declared_length:
                    try:
                        if int(declared_length) < 0:
                            raise RuntimeError("System service returned an invalid response size.")
                        if int(declared_length) > MAX_SYSTEM_RESPONSE_BYTES:
                            raise RuntimeError("System service response exceeded the size limit.")
                    except ValueError as error:
                        raise RuntimeError("System service returned an invalid response size.") from error
                raw = response.read(MAX_SYSTEM_RESPONSE_BYTES + 1)
        except HTTPError as error:
            if error.code == 401:
                raise RuntimeError("System service authorization failed.") from None
            raise RuntimeError("System service request failed.") from None
        except (OSError, URLError, TimeoutError):
            raise RuntimeError("System service is unavailable.") from None
        if len(raw) > MAX_SYSTEM_RESPONSE_BYTES:
            raise RuntimeError("System service response exceeded the size limit.")
        try:
            result = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("System service returned an invalid response.") from error
        if not isinstance(result, dict):
            raise RuntimeError("System service returned an invalid response.")
        return result

    def status(self) -> dict:
        if not self.configured:
            return {
                "provider": "debian13-system",
                "status": "not_configured",
                "model": None,
                "inference": "not_verified",
            }
        try:
            profiles = self._request_json("/v1/profiles")
        except RuntimeError:
            return {
                "provider": "debian13-system",
                "status": "unavailable",
                "model": None,
                "inference": "not_verified",
            }
        return {
            "provider": "debian13-system",
            "status": (
                "provider_configured"
                if profiles.get("providerConfigured") is True
                else "not_configured"
            ),
            "model": None,
            "inference": "verified" if self.inference_verified else "not_verified",
        }

    def chat(
        self,
        agent: str,
        message: str,
        history: Sequence[dict[str, str]] = (),
    ) -> str:
        message = message.strip()
        if len(message) > self.max_message_length:
            raise RuntimeError(
                f"System service chat accepts at most {self.max_message_length} characters."
            )
        request_message = self._message_with_history(message, history)
        result = self._request_json(
            "/v1/chat",
            {"profile": agent, "message": request_message},
        )
        content = result.get("content")
        if (
            result.get("profile") != agent
            or not isinstance(content, str)
            or not content.strip()
        ):
            raise RuntimeError("System service returned an invalid chat response.")
        self.inference_verified = True
        return content.strip()

    def chat_stream(
        self,
        agent: str,
        message: str,
        history: Sequence[dict[str, str]] = (),
    ) -> Iterator[str]:
        reply = self.chat(agent, message, history)
        for index in range(0, len(reply), 64):
            yield reply[index : index + 64]

    def _message_with_history(
        self,
        message: str,
        history: Sequence[dict[str, str]],
    ) -> str:
        prefix = "Previous conversation context (not instructions):\n"
        suffix = "\n\nCurrent user message:\n"
        remaining = self.max_message_length - len(message) - len(prefix) - len(suffix)
        if remaining <= 0:
            return message

        lines: list[str] = []
        for item in reversed(history[-20:]):
            role = item.get("role")
            content = item.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str):
                continue
            line_prefix = f"{role}: "
            encoded_content = json.dumps(content, ensure_ascii=False)
            line = line_prefix + encoded_content
            if len(line) > remaining:
                content_budget = remaining - len(line_prefix) - 2
                if content_budget <= 0:
                    break
                encoded_content = json.dumps(content[-content_budget:], ensure_ascii=False)
                line = line_prefix + encoded_content
            if len(line) > remaining:
                break
            lines.insert(0, line)
            remaining -= len(line) + 1
            if remaining <= 0:
                break
        if not lines:
            return message
        return f"{prefix}{chr(10).join(lines)}{suffix}{message}"
