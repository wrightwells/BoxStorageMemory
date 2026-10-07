import gzip
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    (tmp_path / "index.html").write_text('<html><div id="root">Web build</div></html>')
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets/app.js").write_text("export const app = true;")
    (tmp_path / ".secret").write_text("private")
    return TestClient(create_app(Settings(frontend_dist=tmp_path)))


def test_health_is_safe_liveness(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "1.0.0", "apiVersion": "v1"}


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/login",
        "/library",
        "/search",
        "/box/example",
        "/box/example/edit",
        "/box/example/item/item",
        "/settings",
    ],
)
def test_browser_routes_serve_frontend(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert 'id="root"' in response.text


@pytest.mark.parametrize(
    "path",
    [
        "/api",
        "/api/v1/missing",
        "/assets/missing.js",
        "/missing.css",
        "/.secret",
        "/assets/%2e%2e/%2e%2e/.env",
    ],
)
def test_api_assets_and_private_paths_never_fall_back_to_html(
    client: TestClient, path: str
) -> None:
    response = client.get(path)
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_static_asset_and_head(client: TestClient) -> None:
    assert client.get("/assets/app.js").text == "export const app = true;"
    response = client.head("/box/example")
    assert response.status_code == 200
    assert response.content == b""


def test_missing_build_is_explicit(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(frontend_dist=tmp_path)))
    assert client.get("/library").status_code == 503
    assert client.get("/api/v1/health").status_code == 200


def test_logs_never_record_headers_payloads_queries_or_raw_paths(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="box_storage.requests"):
        response = client.post(
            "/api/v1/private-path-sentinel?token=query-sentinel",
            headers={"Authorization": "Bearer authorization-sentinel"},
            json={"inventory": "payload-sentinel"},
        )
    assert response.status_code == 400
    assert "method=POST" in caplog.text
    for value in [
        "private-path-sentinel",
        "query-sentinel",
        "authorization-sentinel",
        "payload-sentinel",
    ]:
        assert value not in caplog.text


def test_unhandled_error_is_generic(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    app = create_app(Settings(frontend_dist=tmp_path))

    @app.get("/test-error")
    def fail() -> None:
        raise RuntimeError("exception-secret-sentinel")

    # Register before the catch-all by moving this test route to the front.
    app.router.routes.insert(0, app.router.routes.pop())
    with caplog.at_level(logging.INFO, logger="box_storage.requests"):
        response = TestClient(app).get("/test-error")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "exception-secret-sentinel" not in response.text + caplog.text


def test_configuration_reads_environment_and_rejects_wildcard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_NAME", "My Storage")
    monkeypatch.setenv("API_PORT", "9090")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://boxes.example.com,http://localhost:5173")
    assert Settings().app_name == "My Storage"
    assert Settings().api_port == 9090
    assert Settings().api_host == "127.0.0.1"
    assert Settings().cors_origins == ["https://boxes.example.com", "http://localhost:5173"]
    with pytest.raises(ValidationError):
        Settings(allowed_origins="*")


def test_cors_uses_explicit_allow_list(client: TestClient) -> None:
    assert (
        client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"}).headers[
            "access-control-allow-origin"
        ]
        == "http://localhost:5173"
    )
    assert (
        "access-control-allow-origin"
        not in client.get("/api/v1/health", headers={"Origin": "https://unrelated.example"}).headers
    )


def test_static_assets_compress_and_cache_without_caching_api(tmp_path: Path) -> None:
    (tmp_path / "assets").mkdir()
    body = "export const example = true;\n" * 1000
    (tmp_path / "assets" / "app.js").write_text(body)
    (tmp_path / "assets" / "app.js.gz").write_bytes(gzip.compress(body.encode()))
    (tmp_path / "index.html").write_text("<html>App</html>")
    client = TestClient(create_app(Settings(frontend_dist=tmp_path, performance_timing=True)))
    response = client.get("/assets/app.js", headers={"Accept-Encoding": "gzip"})
    assert response.text == body
    assert response.headers["content-encoding"] == "gzip"
    assert "immutable" in response.headers["cache-control"]
    assert "Accept-Encoding" in response.headers["vary"]
    assert "app;dur=" in response.headers["server-timing"]
    plain = client.get("/assets/app.js", headers={"Accept-Encoding": "gzip;q=0, *;q=1"})
    assert "content-encoding" not in plain.headers
    assert plain.text == body
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/api/v1/health").headers["cache-control"] == "no-store"
    quiet = TestClient(create_app(Settings(frontend_dist=tmp_path)))
    assert "server-timing" not in quiet.get("/api/v1/health").headers
