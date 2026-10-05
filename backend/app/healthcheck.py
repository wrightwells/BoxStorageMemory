"""Container liveness check using the standard library, with no curl dependency."""

import json
import os
from urllib.request import urlopen


def main() -> None:
    port = int(os.environ.get("API_PORT", "8080"))
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=3) as response:
            data = json.load(response)
        if data.get("status") != "ok" or data.get("apiVersion") != "v1":
            raise SystemExit(1)
    except (OSError, ValueError):
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
