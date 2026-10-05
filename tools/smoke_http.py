"""Verify a running compiled deployment using only the standard library."""

import json
import re
import sys
from urllib.error import HTTPError
from urllib.request import urlopen


def main() -> None:
    origin = sys.argv[1] if len(sys.argv) == 2 else "http://localhost:8080"
    with urlopen(origin + "/api/v1/health", timeout=5) as response:
        assert json.load(response) == {"status": "ok", "version": "1.0.0", "apiVersion": "v1"}
    for path in ("/scan", "/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6/label", "/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6/tags", "/search?q=extension", "/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6/item/77eb8825-f466-4353-a106-d99d78ad0cc9/photos", "/", "/library", "/library/new", "/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6", "/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6/edit", "/box/9a46f128-1b5a-42ad-a240-b9015cff9ca6/item/77eb8825-f466-4353-a106-d99d78ad0cc9"):
        with urlopen(origin + path, timeout=5) as response:
            assert response.headers.get_content_type() == "text/html"
            html = response.read().decode()
            assert 'id="root"' in html
    scripts = re.findall(r'src="(/assets/[^\"]+\.js)"', html)
    assert scripts, "Compiled application script missing"
    for path in scripts:
        with urlopen(origin + path, timeout=5) as response:
            assert "javascript" in response.headers.get_content_type()
            assert response.read()
    for path in ("/api/v1/not-implemented", "/assets/not-a-file.js", "/.env"):
        try:
            urlopen(origin + path, timeout=5)
        except HTTPError as error:
            assert error.code == 404
            assert json.load(error)["error"]["code"] == "NOT_FOUND"
        else:
            raise AssertionError(f"Expected 404 for {path}")
    print("HTTP smoke passed: health, compiled frontend, deep routes, assets and JSON 404s.")


if __name__ == "__main__":
    main()
