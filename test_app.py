import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class JarvisApiTests(unittest.TestCase):
    def setUp(self):
        app.app.config["TESTING"] = True
        self.client = app.app.test_client()
        self.memory_file = tempfile.NamedTemporaryFile(delete=False)
        self.memory_file.close()
        self.memory_path = Path(self.memory_file.name)
        self.memory_path.write_text("[]", encoding="utf-8")
        self.memory_patch = patch.object(app, "MEMORY_FILE", self.memory_path)
        self.memory_patch.start()

    def tearDown(self):
        self.memory_patch.stop()
        self.memory_path.unlink(missing_ok=True)

    def post_json(self, path, body):
        return self.client.post(
            path,
            data=json.dumps(body),
            content_type="application/json",
            headers={"Origin": "http://127.0.0.1:8765"},
        )

    def test_status_and_diagnostics_are_available(self):
        self.assertEqual(self.client.get("/api/status").status_code, 200)
        self.assertEqual(self.client.get("/api/diagnostics").status_code, 200)
        dashboard = self.client.get("/api/dashboard")
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(dashboard.get_json()["service"], "online")

    def test_memory_round_trip_and_clear(self):
        saved = self.post_json("/api/memory", {
            "value": "Prefers concise replies.", "category": "preference"
        })
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(len(saved.get_json()["items"]), 1)
        self.assertEqual(saved.get_json()["items"][0]["category"], "preference")
        self.assertEqual(self.client.get("/api/memory").get_json()["items"][0]["value"],
                         "Prefers concise replies.")
        deleted = self.client.delete("/api/memory/0")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.get_json()["items"], [])
        self.assertEqual(self.client.delete("/api/memory").status_code, 200)
        self.assertEqual(self.client.get("/api/memory").get_json()["items"], [])

    def test_chat_rejects_invalid_image_and_history(self):
        invalid_image = self.post_json("/api/chat", {"message": "Look", "image": "bad"})
        self.assertEqual(invalid_image.status_code, 400)
        invalid_history = self.post_json(
            "/api/chat", {"message": "Hello", "history": ["not an object"]}
        )
        self.assertEqual(invalid_history.status_code, 400)

    def test_action_allowlist_rejects_unsafe_requests(self):
        response = self.post_json("/api/action", {"type": "url", "value": "http://example.com"})
        self.assertEqual(response.status_code, 403)
        response = self.post_json("/api/action", {"type": "timer", "seconds": 0})
        self.assertEqual(response.status_code, 403)

    @patch.object(app, "subprocess")
    def test_approved_app_action_is_confirmed_by_backend_allowlist(self, subprocess):
        response = self.post_json("/api/action", {"type": "app", "value": "Safari"})
        self.assertEqual(response.status_code, 200)
        subprocess.Popen.assert_called_once_with(["open", "-a", "Safari"])

    @patch.object(app, "subprocess")
    def test_approved_productivity_actions_open_only_allowlisted_apps(self, subprocess):
        for kind, app_name in (("note", "Notes"), ("reminder", "Reminders"), ("calendar", "Calendar")):
            response = self.post_json("/api/action", {"type": kind, "value": "Sprint planning"})
            self.assertEqual(response.status_code, 200)
            subprocess.Popen.assert_called_with(["open", "-a", app_name])

    @patch.object(app, "subprocess")
    def test_timer_action_requires_bounded_integer_seconds(self, subprocess):
        response = self.post_json("/api/action", {"type": "timer", "seconds": 300})
        self.assertEqual(response.status_code, 200)
        subprocess.Popen.assert_called_once_with(["open", "-a", "Clock"])


if __name__ == "__main__":
    unittest.main()
