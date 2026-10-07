"""Token-free HTTP timing/transfer measurements; never reads operator credentials."""

import argparse
import gzip
import json
import re
import time
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--origin", required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
results = []
for sample in range(5):
    for operation, path in [
        ("health", "/api/v1/health"),
        ("config", "/api/v1/config"),
        ("schema", "/api/v1/schema/index"),
        ("html", "/"),
    ]:
        start = time.perf_counter()
        request = urllib.request.Request(args.origin + path, headers={"Accept-Encoding": "gzip"})
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            results.append(
                {
                    "sample": sample,
                    "operation": operation,
                    "elapsedMs": (time.perf_counter() - start) * 1000,
                    "transferBytes": len(body),
                    "encoding": response.headers.get("Content-Encoding", "identity"),
                    "status": response.status,
                }
            )
            if operation == "html":
                asset = re.search(
                    rb'src="(/assets/[^\"]+\.js)"',
                    gzip.decompress(body)
                    if response.headers.get("Content-Encoding") == "gzip"
                    else body,
                )[1].decode()
    start = time.perf_counter()
    with urllib.request.urlopen(
        urllib.request.Request(args.origin + asset, headers={"Accept-Encoding": "gzip"}), timeout=20
    ) as response:
        body = response.read()
        results.append(
            {
                "sample": sample,
                "operation": "entryJavaScript",
                "elapsedMs": (time.perf_counter() - start) * 1000,
                "transferBytes": len(body),
                "encoding": response.headers.get("Content-Encoding", "identity"),
                "cacheControl": response.headers.get("Cache-Control", ""),
                "status": response.status,
            }
        )
args.output.write_text(
    json.dumps(
        {
            "model": "sequential token-free urllib requests to deployed HTTPS; gzip accepted; 5 samples; response body bytes exclude HTTP/TLS overhead",
            "results": results,
        },
        indent=2,
    )
)
