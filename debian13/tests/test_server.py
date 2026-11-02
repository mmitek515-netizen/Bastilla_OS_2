import json
import platform
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model_adapter import OllamaAdapter
from server import (
    MAX_SESSION_BYTES,
    MAX_TASK_RESULT_BYTES,
    DemoApplication,
    create_server,
)


class StubModel:
    def __init__(self, failure=None):
        self.failure = failure

    def status(self):
        return {
            "provider": "test-double",
            "status": "unavailable" if self.failure else "not_configured",
            "model": None,
            "inference": "not_verified",
        }

    def chat(self, _agent, _message, _history=()):
        if self.failure:
            raise RuntimeError(self.failure)
        return "test-double reply"

    def chat_stream(self, _agent, _message, _history=()):
        if self.failure:
            raise RuntimeError(self.failure)
        yield "test-double "
        yield "reply"


class CommandReplyModel(StubModel):
    def chat(self, _agent, _message, _history=()):
        return "/terminal cat README.txt"


class PartialStreamModel(StubModel):
    def chat_stream(self, _agent, _message, _history=()):
        yield "partial answer"
        raise RuntimeError("upstream stream failed")


class OrderedModel(StubModel):
    def __init__(self):
        super().__init__()
        self.first_started = threading.Event()
        self.release_first = threading.Event()
        self.second_called = threading.Event()
        self.calls = []
        self.lock = threading.Lock()

    def chat(self, _agent, message, history=()):
        with self.lock:
            self.calls.append((message, list(history)))
        if message == "first":
            self.first_started.set()
            self.release_first.wait(timeout=3)
        elif message == "second":
            self.second_called.set()
        return f"reply:{message}"


class FakeOllamaHandler(BaseHTTPRequestHandler):
    seen_messages = None

    def do_GET(self):
        body = json.dumps({"models": [{"name": "local-test"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        type(self).seen_messages = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["messages"]
        body = json.dumps({"message": {"content": "Odpowiedź z lokalnego testowego adaptera."}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


class FakeStreamingOllamaHandler(BaseHTTPRequestHandler):
    seen_messages = None

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).seen_messages = body["messages"]
        if body.get("stream") is not True:
            self.send_error(400)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        for event in [
            {"message": {"content": "Strumień "}, "done": False},
            {"message": {"content": "działa."}, "done": False},
            {"message": {}, "done": True},
        ]:
            self.wfile.write(json.dumps(event).encode() + b"\n")
            self.wfile.flush()

    def log_message(self, _format, *_args):
        return


class Debian13ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name)
        (self.workspace / "hello.txt").write_text("hello workspace", encoding="utf-8")
        self.app = DemoApplication(self.workspace, StubModel())
        self.server = create_server(port=0, application=self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_contract_reports_profiles_without_claiming_live_agents_or_debian_boot(self):
        status, response = self.request("/api/v1/status")
        self.assertEqual(status, 200)
        self.assertEqual(response["application"]["status"], "running")
        self.assertFalse(response["operating_system"]["runtime"]["debian_13_boot_verified"])
        self.assertEqual(response["model"]["status"], "not_configured")

        status, agents = self.request("/api/v1/agents")
        self.assertEqual(status, 200)
        self.assertEqual([agent["id"] for agent in agents["agents"]], ["aria", "astyria", "aurelius", "alex"])
        self.assertTrue(all(agent["worker"] == "not_running" for agent in agents["agents"]))

    def test_diagnostics_reports_observed_runtime_and_unverified_integrations(self):
        status, diagnostics = self.request("/api/v1/diagnostics")
        self.assertEqual(status, 200)
        self.assertEqual(diagnostics["application"]["status"], "running")
        self.assertEqual(diagnostics["runtime"]["system"], platform.system())
        self.assertEqual(diagnostics["runtime"]["architecture"], platform.machine())
        self.assertTrue(
            diagnostics["runtime"]["cpu_count"] is None
            or diagnostics["runtime"]["cpu_count"] >= 1
        )
        self.assertIn(diagnostics["resources"]["memory"]["status"], {"available", "unavailable"})
        self.assertIn(diagnostics["resources"]["workspace"]["status"], {"available", "unavailable"})
        self.assertIn(
            diagnostics["virtualization"]["kvm_device"]["status"],
            {"available", "permission_denied", "unavailable"},
        )
        self.assertIn(
            diagnostics["virtualization"]["qemu_x86_64_binary"],
            {"available", "unavailable"},
        )
        self.assertIn(
            diagnostics["virtualization"]["docker_binary"],
            {"available", "unavailable"},
        )
        self.assertEqual(diagnostics["integrations"]["model"]["inference"], "not_verified")
        self.assertTrue(
            all(agent["worker"] == "not_running" for agent in diagnostics["integrations"]["agents"])
        )
        self.assertEqual(diagnostics["integrations"]["mcp"]["connection"], "not_tested")
        self.assertEqual(diagnostics["integrations"]["gpt_actions"]["connection"], "not_tested")

    def test_help_completes_a_task_and_emits_bounded_audit_events(self):
        status, response = self.request("/api/v1/chat", {"message": "/help", "agent": "aria"})
        self.assertEqual(status, 200)
        self.assertEqual(response["source"], "local_command")
        self.assertEqual(response["task"]["status"], "completed")
        self.assertIn("/terminal ls", response["reply"])
        self.assertTrue(response["session_id"])

        status, tasks = self.request("/api/v1/tasks")
        self.assertEqual(status, 200)
        self.assertEqual(tasks["tasks"][0]["id"], response["task"]["id"])
        status, events = self.request("/api/v1/events")
        self.assertEqual(status, 200)
        self.assertEqual([item["type"] for item in events["events"]], ["task.completed", "task.running", "task.queued"])
        status, history = self.request(
            f"/api/v1/sessions/{response['session_id']}/messages"
        )
        self.assertEqual(status, 200)
        self.assertEqual([item["role"] for item in history["messages"]], ["user", "assistant"])

    def test_sessions_keep_chat_history_isolated_and_accept_legacy_requests(self):
        _, first = self.request("/api/v1/chat", {"message": "/help", "agent": "aria"})
        _, second = self.request("/api/v1/chat", {"message": "/help", "agent": "alex"})
        self.assertNotEqual(first["session_id"], second["session_id"])

        status, continued = self.request(
            "/api/v1/chat",
            {
                "message": "/status",
                "agent": "aria",
                "session_id": first["session_id"],
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(continued["session_id"], first["session_id"])

        status, history = self.request(
            f"/api/v1/sessions/{first['session_id']}/messages"
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(history["messages"]), 4)
        status, missing = self.request(
            f"/api/v1/sessions/{second['session_id']}/messages"
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(missing["messages"]), 2)

        status, _ = self.request(
            "/api/v1/chat",
            {"message": "/help", "agent": "aria", "session_id": "not-a-uuid"},
        )
        self.assertEqual(status, 404)

    def test_same_session_chat_requests_are_serialized_in_message_order(self):
        model = OrderedModel()
        self.app.model = model
        _, created = self.request("/api/v1/chat", {"message": "/help", "agent": "aria"})
        session_id = created["session_id"]
        results = {}

        def send(key, message):
            results[key] = self.request(
                "/api/v1/chat",
                {"message": message, "agent": "aria", "session_id": session_id},
            )

        first = threading.Thread(target=send, args=("first", "first"))
        second = threading.Thread(target=send, args=("second", "second"))
        first.start()
        self.assertTrue(model.first_started.wait(timeout=2))
        second.start()
        try:
            self.assertFalse(model.second_called.wait(timeout=0.1))
        finally:
            model.release_first.set()
            first.join(timeout=3)
            second.join(timeout=3)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(results["first"][0], 200)
        self.assertEqual(results["second"][0], 200)
        self.assertEqual(model.calls[1][0], "second")
        self.assertEqual(
            [message["content"] for message in model.calls[1][1][-2:]],
            ["first", "reply:first"],
        )

    def test_session_history_and_task_results_have_byte_limits(self):
        session = self.app.get_session()
        self.app.append_exchange(
            session,
            "aria",
            "u" * 48_000,
            "a" * 1_000_000,
            "ollama",
        )
        history = self.app.session_messages(session["id"])
        self.assertLessEqual(
            sum(len(item["content"].encode("utf-8")) for item in history),
            MAX_SESSION_BYTES,
        )

        task = self.app.start_task("aria", "chat")
        completed = self.app.update_task(task, "completed", result="r" * 100_000)
        self.assertLessEqual(
            len(completed["result"].encode("utf-8")),
            MAX_TASK_RESULT_BYTES,
        )

    def test_streaming_http_chat_completes_and_can_be_read_back_from_its_session(self):
        request = Request(
            self.base + "/api/v1/chat/stream",
            data=json.dumps({"message": "/help", "agent": "aria"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=3) as response:
            self.assertEqual(response.headers.get_content_type(), "text/event-stream")
            events = response.read().decode()
        self.assertIn("event: delta", events)
        self.assertIn("event: done", events)
        meta = json.loads(
            next(line.removeprefix("data: ") for line in events.splitlines() if line.startswith("data: "))
        )
        status, history = self.request(
            f"/api/v1/sessions/{meta['session_id']}/messages"
        )
        self.assertEqual(status, 200)
        self.assertEqual([item["role"] for item in history["messages"]], ["user", "assistant"])

    def test_incomplete_stream_fails_task_and_does_not_save_partial_turn(self):
        app = DemoApplication(self.workspace, PartialStreamModel())
        server = create_server(port=0, application=app)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(
                f"http://127.0.0.1:{server.server_port}/api/v1/chat/stream",
                data=json.dumps({"message": "Cześć", "agent": "aria"}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urlopen(request, timeout=3) as response:
                events = response.read().decode()
            self.assertIn("event: delta", events)
            self.assertIn("event: error", events)
            self.assertNotIn("event: done", events)
            meta = json.loads(
                next(line.removeprefix("data: ") for line in events.splitlines() if line.startswith("data: "))
            )
            self.assertEqual(app.session_messages(meta["session_id"]), [])
            self.assertEqual(app.tasks()[0]["status"], "failed")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_model_unavailable_is_a_real_failure_not_a_fallback_reply(self):
        app = DemoApplication(self.workspace, StubModel("Model niedostępny; brak odpowiedzi."))
        server = create_server(port=0, application=app)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.base = f"http://127.0.0.1:{server.server_port}"
        try:
            status, response = self.request("/api/v1/chat", {"message": "Cześć", "agent": "astyria"})
            self.assertEqual(status, 503)
            self.assertEqual(response["task"]["status"], "failed")
            self.assertEqual(response["error"], "Model niedostępny; brak odpowiedzi.")
            self.assertNotIn("reply", response)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_model_text_that_looks_like_a_terminal_command_is_only_returned_as_text(self):
        app = DemoApplication(self.workspace, CommandReplyModel())
        server = create_server(port=0, application=app)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.base = f"http://127.0.0.1:{server.server_port}"
        try:
            status, response = self.request("/api/v1/chat", {"message": "Sprawdź workspace.", "agent": "aria"})
            self.assertEqual(status, 200)
            self.assertEqual(response["reply"], "/terminal cat README.txt")
            self.assertEqual(response["source"], "ollama")
            self.assertEqual(response["task"]["status"], "completed")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_terminal_allows_only_bounded_read_only_workspace_operations(self):
        status, response = self.request("/api/v1/terminal", {"command": "cat hello.txt"})
        self.assertEqual(status, 200)
        self.assertEqual(response["output"], "hello workspace")
        self.assertEqual(response["task"]["status"], "completed")

        for command in ["sh -c id", "cat ../README.md", "pwd /tmp", "ls /"]:
            status, response = self.request("/api/v1/terminal", {"command": command})
            self.assertEqual(status, 400, command)
            self.assertEqual(response["task"]["status"], "failed")

    def test_request_validation_and_non_loopback_bind_are_rejected(self):
        for body in [
            {"message": "hello", "agent": []},
            {"message": "hello", "agent": "root"},
            {"message": "hello", "agent": "aria", "extra": True},
            {"message": "  ", "agent": "aria"},
        ]:
            status, _ = self.request("/api/v1/chat", body)
            self.assertEqual(status, 400)
        with self.assertRaises(ValueError):
            create_server(host="0.0.0.0", port=0)


class OllamaAdapterTests(unittest.TestCase):
    def test_validates_model_url_as_loopback_only(self):
        for url in [
            "https://127.0.0.1:11434",
            "http://example.org:11434",
            "http://127.0.0.1:11434/path",
            "******127.0.0.1:11434",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                OllamaAdapter(url, "local-test")

    def test_adapter_uses_real_ollama_http_shape_and_selected_profile(self):
        FakeOllamaHandler.seen_messages = None
        fake = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllamaHandler)
        thread = threading.Thread(target=fake.serve_forever, daemon=True)
        thread.start()
        try:
            model = OllamaAdapter(f"http://127.0.0.1:{fake.server_port}", "local-test")
            self.assertEqual(model.status()["status"], "model_available")
            self.assertEqual(model.status()["inference"], "not_verified")
            self.assertEqual(model.chat("aurelius", "Sprawdź tę zmianę."), "Odpowiedź z lokalnego testowego adaptera.")
            self.assertEqual(FakeOllamaHandler.seen_messages[0]["role"], "system")
            self.assertIn("bezpieczeństwo", FakeOllamaHandler.seen_messages[0]["content"])
            self.assertEqual(model.status()["inference"], "verified")
        finally:
            fake.shutdown()
            fake.server_close()
            thread.join(timeout=2)

    def test_streaming_http_flow_uses_ollama_chunks_and_saves_session_history(self):
        FakeStreamingOllamaHandler.seen_messages = None
        fake = ThreadingHTTPServer(("127.0.0.1", 0), FakeStreamingOllamaHandler)
        fake_thread = threading.Thread(target=fake.serve_forever, daemon=True)
        fake_thread.start()
        try:
            model = OllamaAdapter(
                f"http://127.0.0.1:{fake.server_port}", "local-test"
            )
            with tempfile.TemporaryDirectory() as workspace:
                app = DemoApplication(Path(workspace), model)
                server = create_server(port=0, application=app)
                server_thread = threading.Thread(target=server.serve_forever, daemon=True)
                server_thread.start()
                try:
                    request = Request(
                        f"http://127.0.0.1:{server.server_port}/api/v1/chat/stream",
                        data=json.dumps({"message": "Cześć", "agent": "aurelius"}).encode(),
                        headers={"Content-Type": "application/json"},
                    )
                    with urlopen(request, timeout=3) as response:
                        events = response.read().decode()
                    self.assertIn('"text": "Strumień "', events)
                    self.assertIn('"text": "działa."', events)
                    self.assertIn("event: done", events)
                    self.assertTrue(model.inference_verified)
                    self.assertEqual(FakeStreamingOllamaHandler.seen_messages[1]["content"], "Cześć")
                    meta = json.loads(
                        next(line.removeprefix("data: ") for line in events.splitlines() if line.startswith("data: "))
                    )
                    request = Request(
                        f"http://127.0.0.1:{server.server_port}/api/v1/chat/stream",
                        data=json.dumps(
                            {
                                "message": "Kontynuuj",
                                "agent": "aurelius",
                                "session_id": meta["session_id"],
                            }
                        ).encode(),
                        headers={"Content-Type": "application/json"},
                    )
                    with urlopen(request, timeout=3) as response:
                        continued = response.read().decode()
                    self.assertIn("event: done", continued)
                    self.assertEqual(
                        [item["role"] for item in FakeStreamingOllamaHandler.seen_messages],
                        ["system", "user", "assistant", "user"],
                    )
                    self.assertEqual(
                        FakeStreamingOllamaHandler.seen_messages[1]["content"],
                        "Cześć",
                    )
                    self.assertEqual(
                        FakeStreamingOllamaHandler.seen_messages[3]["content"],
                        "Kontynuuj",
                    )
                    self.assertEqual(len(app.session_messages(meta["session_id"])), 4)
                finally:
                    server.shutdown()
                    server.server_close()
                    server_thread.join(timeout=2)
        finally:
            fake.shutdown()
            fake.server_close()
            fake_thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
