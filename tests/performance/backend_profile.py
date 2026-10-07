"""Measure app processing separately from TCP/Google latency using token-free fixtures."""

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app

started = time.perf_counter()
app = create_app(Settings(public_url="http://localhost:8080", performance_timing=True))
construction = (time.perf_counter() - started) * 1000
client = TestClient(app)
inventory = json.loads(Path("fixtures/contracts/valid-inventory.json").read_text())
results = []
for sample in range(5):
    for operation, path, body in [
        ("health", "/api/v1/health", None),
        ("config", "/api/v1/config", None),
        ("validateInventory", "/api/v1/validate/inventory", inventory),
        ("qr", "/api/v1/qr/generate", {"boxId": inventory["box"]["id"]}),
    ]:
        start = time.perf_counter()
        response = client.get(path) if body is None else client.post(path, json=body)
        assert response.status_code == 200
        results.append(
            {
                "sample": sample,
                "operation": operation,
                "elapsedMs": (time.perf_counter() - start) * 1000,
                "appToHeadersMs": float(response.headers["server-timing"].split("dur=")[1]),
                "responseBytes": len(response.content),
            }
        )
print(
    json.dumps(
        {
            "model": "optimized backend in-process TestClient; app timing to response headers excludes socket/Drive latency; 5 samples; synthetic validation/QR payloads",
            "appConstructionMs": construction,
            "results": results,
        },
        indent=2,
    )
)
