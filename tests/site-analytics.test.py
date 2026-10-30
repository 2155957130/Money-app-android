import base64
import importlib.util
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("money_analytics", Path(__file__).resolve().parents[1] / "server" / "analytics.py")
analytics = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(analytics)


class AnalyticsTest(unittest.TestCase):
    def test_counts_and_admin_access(self):
        with tempfile.TemporaryDirectory() as folder:
            analytics.DATA = Path(folder) / "stats.sqlite3"
            server = analytics.ThreadingHTTPServer(("127.0.0.1", 0), analytics.Handler)
            server.admin_user = "admin"
            server.admin_password = "a-long-test-password"
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def request(method, path, auth=None):
                con = HTTPConnection("127.0.0.1", server.server_port, timeout=4)
                con.request(method, path, headers={"Authorization": auth} if auth else {})
                response = con.getresponse()
                status, body = response.status, response.read()
                con.close()
                return status, body
            try:
                self.assertEqual(request("GET", "/admin/")[0], 401)
                self.assertEqual(request("GET", "/admin/", "Basic !!!")[0], 401)
                self.assertEqual(request("GET", "/")[0], 200)
                self.assertEqual(request("GET", "/style.css")[0], 200)
                self.assertEqual(request("HEAD", "/downloads/Money-1.8.11.apk")[0], 200)
                self.assertEqual(request("GET", "/downloads/Money-1.8.11.apk")[0], 200)
                self.assertEqual(request("GET", "/downloads/../../signing/keystore-password.txt")[0], 404)
                auth = "Basic " + base64.b64encode(b"admin:a-long-test-password").decode()
                status, body = request("GET", "/admin/", auth)
                self.assertEqual(status, 200)
                self.assertIn("总浏览量", body.decode())
                totals, _, _, _, files = analytics.report()
                self.assertEqual(totals, {"download": 1, "view": 1})
                self.assertEqual(files, [("Money-1.8.11.apk", 1)])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=4)


if __name__ == "__main__":
    unittest.main()
