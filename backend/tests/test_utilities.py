import io
import json
import logging
from pathlib import Path

import pytest
import zxingcpp
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures/contracts"
UUID = "12345678-1234-4234-8234-123456789abc"


def client(**kwargs: object) -> TestClient:
    return TestClient(create_app(Settings(**kwargs)))


def test_public_config_is_allowlisted() -> None:
    result = (
        client(public_url="https://boxes.example/", google_web_client_id="public-id")
        .get("/api/v1/config")
        .json()
    )
    assert result == {
        "appName": "Box Storage",
        "applicationVersion": "1.0.0",
        "apiVersion": "v1",
        "publicUrl": "https://boxes.example",
        "googleWebClientId": "public-id",
        "features": {"webNfc": False, "qrFormat": "png"},
        "compatibility": {
            "supportedSchemaVersions": [1],
            "minimumWebClientVersion": "1.0.0",
            "minimumAndroidClientVersion": "1.0.0",
        },
    }


@pytest.mark.parametrize(
    "kind,file", [("inventory", "inventory.schema.json"), ("index", "box-index.schema.json")]
)
def test_published_schema(kind: str, file: str) -> None:
    assert client().get("/api/v1/schema/" + kind).json() == json.loads(
        (ROOT / "schemas/v1" / file).read_text()
    )


CASES = [
    case
    for case in json.loads((FIXTURES / "cases.json").read_text())
    if case["action"] == "validate"
]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_document_fixture_parity(case: dict) -> None:
    response = client().post(
        "/api/v1/validate/" + case["kind"], json=json.loads((FIXTURES / case["file"]).read_text())
    )
    assert response.status_code == 200
    result = response.json()
    for error in result["errors"]:
        assert error.pop("message")
    assert result == case["expected"]


@pytest.mark.parametrize("document", [None, [], "text", 3, False])
def test_invalid_json_documents_are_results(document: object) -> None:
    response = client().post(
        "/api/v1/validate/index",
        content=json.dumps(document),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 200
    assert response.json()["valid"] is False


@pytest.mark.parametrize(
    "body",
    [
        "{",
        '{"a":1,"a":2}',
        '{"a":NaN}',
        '{"a":1e400}',
        "[" * 70 + "0" + "]" * 70,
        '{"access_token":"secret"}',
    ],
)
def test_bad_transport(body: str) -> None:
    response = client().post(
        "/api/v1/validate/index", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_JSON"
    assert response.json()["error"]["details"] == []
    assert "secret" not in response.text


def test_size_and_content_type_limits() -> None:
    app = client(max_request_bytes=1024)
    assert app.post("/api/v1/validate/index", content="{}").status_code == 415
    headers = {"Content-Type": "application/json"}
    assert (
        app.post("/api/v1/validate/index", content=" " * 1025, headers=headers).status_code == 413
    )
    assert (
        app.post(
            "/api/v1/validate/index", content=iter([b" " * 600, b" " * 600]), headers=headers
        ).status_code
        == 413
    )


def test_rate_limit_and_health_exemption() -> None:
    app = client(utility_requests_per_minute=1)
    assert app.post("/api/v1/validate/index", json={}).status_code == 200
    response = app.post("/api/v1/qr/generate", json={"boxId": UUID})
    assert response.status_code == 429
    assert 1 <= int(response.headers["Retry-After"]) <= 60
    assert app.get("/api/v1/health").status_code == 200


def test_qr_decodes_to_configured_origin() -> None:
    response = client(public_url="https://boxes.example").post(
        "/api/v1/qr/generate", json={"boxId": UUID}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    decoded = zxingcpp.read_barcode(Image.open(io.BytesIO(response.content)))
    assert decoded is not None
    assert decoded.text == "https://boxes.example/box/" + UUID


def test_drive_folder_qr_decodes_to_google_folder_url() -> None:
    folder_id = "synthetic_Folder-123"
    response = client(public_url="https://boxes.example").post(
        "/api/v1/qr/drive-folder", json={"folderId": folder_id}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    decoded = zxingcpp.read_barcode(Image.open(io.BytesIO(response.content)))
    assert decoded is not None
    assert decoded.text == "https://drive.google.com/drive/folders/" + folder_id


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"folderId": ""},
        {"folderId": "../bad"},
        {"folderId": "folder\n"},
        {"folderId": "x" * 257},
        {"folderId": 3},
        {"folderId": "folder", "url": "https://evil.example"},
    ],
)
def test_drive_folder_qr_rejects_invalid_id_and_url_overrides(body: dict) -> None:
    response = client().post("/api/v1/qr/drive-folder", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_drive_folder_qr_uses_utility_guard() -> None:
    app = client(utility_requests_per_minute=1)
    assert app.post("/api/v1/qr/drive-folder", json={"folderId": "folder"}).status_code == 200
    assert app.post("/api/v1/qr/drive-folder", json={"folderId": "folder"}).status_code == 429
    assert (
        client()
        .post("/api/v1/qr/drive-folder", json={"folderId": "folder", "access_token": "sentinel"})
        .status_code
        == 400
    )


@pytest.mark.parametrize(
    "body",
    [
        {"boxId": "bad-private-value"},
        {"boxId": UUID.upper()},
        {"boxId": UUID, "publicUrl": "https://evil.example"},
        {"boxId": 3},
        {},
    ],
)
def test_qr_invalid_request_does_not_echo_input(body: dict) -> None:
    response = client().post("/api/v1/qr/generate", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert "bad-private-value" not in response.text


def test_api_never_accepts_credentials_or_logs_payload(caplog: pytest.LogCaptureFixture) -> None:
    app = client()
    with caplog.at_level(logging.INFO, logger="box_storage.requests"):
        response = app.post("/api/v1/validate/index", json={"private": "payload-sentinel"})
        assert response.status_code == 200
        assert (
            app.get(
                "/api/v1/config", headers={"Authorization": "Bearer token-sentinel"}
            ).status_code
            == 400
        )
        assert app.get("/api/v1/config?access_token=query-sentinel").status_code == 400
    assert not any(
        value in caplog.text for value in ["payload-sentinel", "token-sentinel", "query-sentinel"]
    )
    assert "payload-sentinel" not in response.text


def test_cors_on_transport_errors() -> None:
    response = client().post(
        "/api/v1/validate/index",
        content="bad",
        headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"},
    )
    assert response.status_code == 400
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_openapi_matches_export_and_has_only_implemented_operations() -> None:
    schema = client().get("/api/openapi.json").json()
    assert schema == json.loads((ROOT / "api/v1/openapi.json").read_text())
    assert schema == json.loads((ROOT / "openapi.json").read_text())
    assert len(schema["paths"]) == 9
    assert "/api/v1/search" not in schema["paths"]
    assert (
        "image/png" in schema["paths"]["/api/v1/qr/generate"]["post"]["responses"]["200"]["content"]
    )
    assert "securitySchemes" not in schema["components"]
    assert client(enable_api_docs=False).get("/api/docs").status_code == 404


@pytest.mark.parametrize(
    "origin",
    [
        "http://example.com",
        "https://example.com/path",
        "https://user:pass@example.com",
        "https://example.com?token=x",
    ],
)
def test_public_url_rejects_unsafe_origin(origin: str) -> None:
    with pytest.raises(ValidationError):
        Settings(public_url=origin)


def test_global_rate_limit_window_and_forwarded_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app import guards

    now = [100.0]
    monkeypatch.setattr(guards, "monotonic", lambda: now[0])
    app = client(utility_requests_per_minute=10, utility_global_requests_per_minute=1)
    assert app.post("/api/v1/validate/index", json={}).status_code == 200
    assert (
        app.post(
            "/api/v1/validate/index", json={}, headers={"X-Forwarded-For": "192.0.2.9"}
        ).status_code
        == 429
    )
    now[0] += 60
    assert app.post("/api/v1/validate/index", json={}).status_code == 200


def test_invalid_utf8_and_empty_body() -> None:
    for body in [b"\xff", b""]:
        response = client().post(
            "/api/v1/validate/index", content=body, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 400


def test_json_node_limit() -> None:
    response = client().post("/api/v1/validate/index", json=[0] * 50001)
    assert response.status_code == 400
