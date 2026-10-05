import base64
import hashlib
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


def test_optional_docs_hash_matches_actual_initialization_script() -> None:
    client = TestClient(create_app(Settings(enable_api_docs=True)))
    response = client.get("/api/docs")
    assert response.status_code == 200
    inline = re.search(r"<script>([\s\S]*?)</script>", response.text)
    assert inline
    digest = base64.b64encode(hashlib.sha256(inline[1].encode()).digest()).decode()
    assert f"'sha256-{digest}'" in response.headers["content-security-policy"]
    assert (
        "unsafe-inline"
        not in response.headers["content-security-policy"].split("script-src ")[1].split(";")[0]
    )


@pytest.mark.parametrize(
    "path", ["/", "/scan", "/api/v1/health", "/api/v1/missing", "/assets/missing.js"]
)
def test_policies_cover_frontend_api_and_errors(tmp_path: Path, path: str) -> None:
    (tmp_path / "index.html").write_text('<div id="root"></div>')
    app = TestClient(create_app(Settings(frontend_dist=tmp_path)))
    response = app.get(path)
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "strict-origin"
    assert response.headers["cross-origin-opener-policy"] == "same-origin-allow-popups"
    policy = response.headers["content-security-policy"]
    assert "unsafe-eval" not in policy and "unsafe-inline" not in policy
    assert "https://accounts.google.com/gsi/client" in policy
    assert "https://www.googleapis.com" in policy
    assert "https://oauth2.googleapis.com/revoke" in policy
    assert "img-src 'self' blob: data:" in policy
    assert "frame-ancestors 'none'" in policy
    assert "camera=(self)" in response.headers["permissions-policy"]
    assert "microphone=()" in response.headers["permissions-policy"]
    assert "nfc=()" in response.headers["permissions-policy"]
    assert "strict-transport-security" not in response.headers
    if path.startswith("/api/"):
        assert response.headers["cache-control"] == "no-store"


def test_https_policy_is_operator_configured_not_forwarded_header() -> None:
    https = TestClient(
        create_app(Settings(public_url="https://boxes.example", enable_web_nfc=True))
    )
    response = https.get("/api/v1/health")
    assert response.headers["strict-transport-security"] == "max-age=31536000"
    assert "nfc=(self)" in response.headers["permissions-policy"]
    http = TestClient(create_app(Settings()))
    response = http.get("/api/v1/health", headers={"X-Forwarded-Proto": "https"})
    assert "strict-transport-security" not in response.headers


def test_policies_survive_rejected_credentials_and_cors_preflight() -> None:
    app = TestClient(create_app(Settings()))
    response = app.get("/api/v1/config", headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 400
    assert "content-security-policy" in response.headers
    response = app.options(
        "/api/v1/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "content-security-policy" in response.headers
