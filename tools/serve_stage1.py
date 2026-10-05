"""Read-only localhost server with an explicit Stage 1 asset allow-list."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ASSETS = {
    "/prototypes/stage1/index.html": "text/html",
    "/prototypes/stage1/ui.mjs": "text/javascript",
    "/prototypes/stage1/google-drive.mjs": "text/javascript",
    "/prototypes/stage1/concurrency.mjs": "text/javascript",
    "/fixtures/contracts/valid-inventory.json": "application/json",
    "/docs/google-setup.md": "text/plain",
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in ASSETS:
            self.send_error(404)
            return
        data = (ROOT / path.lstrip("/")).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ASSETS[path] + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass  # No request/query/body logging in the prototype server.


if __name__ == "__main__":
    print("Stage 1 probe: http://localhost:8765/prototypes/stage1/index.html")
    with ThreadingHTTPServer(("127.0.0.1", 8765), Handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
