from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from threading import Thread
import unittest

from tools.serve_stage1 import Handler


class PrototypeServerTests(unittest.TestCase):
    def test_only_allowlisted_readonly_assets_are_served(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = HTTPConnection("127.0.0.1", server.server_port)
            for path, expected in (("/prototypes/stage1/index.html", 200), ("/prototypes/stage1/ui.mjs", 200), ("/fixtures/contracts/valid-inventory.json", 200), ("/.git/config", 404), ("/.env", 404), ("/prototypes/stage1/../../.env", 404)):
                with self.subTest(path=path):
                    connection.request("GET", path)
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected)
                    if expected == 200:
                        self.assertEqual(response.getheader("Cache-Control"), "no-store")
                    response.read()
            connection.request("POST", "/prototypes/stage1/index.html", "credentials=not-real")
            response = connection.getresponse()
            self.assertEqual(response.status, 501)
            response.read()
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
