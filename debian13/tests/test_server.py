import json
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
from server import DemoApplication, create_server


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

    def chat(self, _agent, _message):
        if self.failure:
            raise RuntimeError(self.failure)
        return "test-double reply"


class CommandReplyModel(StubModel):
    def chat(self, _agent, _message):
        return "/terminal cat README.txt"


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

    def test_help_completes_a_task_and_emits_bounded_audit_events(self):
        status, response = self.request("/api/v1/chat", {"message": "/help", "agent": "aria"})
        self.assertEqual(status, 200)
        self.assertEqual(response["source"], "local_command")
        self.assertEqual(response["task"]["status"], "completed")
        self.assertIn("/terminal ls", response["reply"])

        status, tasks = self.request("/api/v1/tasks")
        self.assertEqual(status, 200)
        self.assertEqual(tasks["tasks"][0]["id"], response["task"]["id"])
        status, events = self.request("/api/v1/events")
        self.assertEqual(status, 200)
        self.assertEqual([item["type"] for item in events["events"]], ["task.completed", "task.running", "task.queued"])

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


if __name__ == "__main__":
    unittest.main()
