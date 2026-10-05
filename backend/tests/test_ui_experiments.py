import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


def test_flags_reload_without_restart_and_fail_closed(tmp_path: Path) -> None:
    path = tmp_path / "flags.json"
    client = TestClient(create_app(Settings(ui_experiment_config=path)))
    assert client.get("/api/v1/ui-experiments").json()["enabled"] is False
    path.write_text(json.dumps({"enabled": True, "rolloutPercentage": 25}))
    response = client.get("/api/v1/ui-experiments")
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["rolloutPercentage"] == 25
    path.write_text('{"enabled": false}')
    assert client.get("/api/v1/ui-experiments").json()["enabled"] is False
    for invalid in [
        '{"enabled": "true"}',
        '{"rolloutPercentage": 101}',
        '{"token":"secret"}',
        "broken",
    ]:
        path.write_text(invalid)
        result = client.get("/api/v1/ui-experiments").json()
        assert result["enabled"] is False
        assert "secret" not in str(result)


def test_promoted_baseline_and_independent_context_flags(tmp_path: Path) -> None:
    path = tmp_path / "flags.json"
    path.write_text(
        json.dumps(
            {
                "enabled": True,
                "baselineVariant": "persistent-navigation",
                "searchContext": {"enabled": True, "rolloutPercentage": 0},
            }
        )
    )
    client = TestClient(create_app(Settings(ui_experiment_config=path)))
    flags = client.get("/api/v1/ui-experiments").json()
    assert flags["baselineVariant"] == "persistent-navigation"
    assert flags["searchContext"]["enabled"] is True
    path.write_text(
        json.dumps(
            {
                "enabled": True,
                "baselineVariant": "persistent-navigation",
                "searchContext": {"enabled": False},
            }
        )
    )
    flags = client.get("/api/v1/ui-experiments").json()
    assert flags["baselineVariant"] == "persistent-navigation"
    assert flags["searchContext"]["enabled"] is False
    path.write_text(json.dumps({"searchContext": {"rolloutPercentage": 101}}))
    assert client.get("/api/v1/ui-experiments").json()["enabled"] is False


def test_photo_recognition_rolls_back_independently(tmp_path: Path) -> None:
    path = tmp_path / "flags.json"
    client = TestClient(create_app(Settings(ui_experiment_config=path)))
    flags = {
        "enabled": True,
        "baselineVariant": "persistent-navigation",
        "photoRecognition": {"enabled": True, "rolloutPercentage": 0},
    }
    path.write_text(json.dumps(flags))
    assert client.get("/api/v1/ui-experiments").json()["photoRecognition"]["enabled"] is True
    flags["photoRecognition"] = {"enabled": False}
    path.write_text(json.dumps(flags))
    result = client.get("/api/v1/ui-experiments").json()
    assert result["baselineVariant"] == "persistent-navigation"
    assert result["photoRecognition"]["enabled"] is False
    path.write_text(json.dumps({"photoRecognition": {"forceVariant": "invalid"}}))
    assert client.get("/api/v1/ui-experiments").json()["enabled"] is False


def test_reference_layout_flags_are_independent(tmp_path: Path) -> None:
    path = tmp_path / "flags.json"
    client = TestClient(create_app(Settings(ui_experiment_config=path)))
    path.write_text(
        json.dumps(
            {
                "enabled": True,
                "baselineVariant": "persistent-navigation",
                "referenceLayout": {"enabled": True, "rolloutPercentage": 0},
            }
        )
    )
    result = client.get("/api/v1/ui-experiments").json()
    assert result["referenceLayout"]["enabled"] is True
    assert result["photoRecognition"]["enabled"] is False
    path.write_text(
        json.dumps(
            {
                "enabled": True,
                "baselineVariant": "persistent-navigation",
                "referenceLayout": {"enabled": False},
            }
        )
    )
    result = client.get("/api/v1/ui-experiments").json()
    assert result["baselineVariant"] == "persistent-navigation"
    assert result["referenceLayout"]["enabled"] is False


def test_reference_baseline_can_be_promoted_and_validated(tmp_path: Path) -> None:
    path = tmp_path / "flags.json"
    path.write_text(
        json.dumps({"referenceLayout": {"enabled": True, "baselineVariant": "reference-box"}})
    )
    client = TestClient(create_app(Settings(ui_experiment_config=path)))
    assert (
        client.get("/api/v1/ui-experiments").json()["referenceLayout"]["baselineVariant"]
        == "reference-box"
    )
    path.write_text(json.dumps({"referenceLayout": {"baselineVariant": "invalid"}}))
    assert client.get("/api/v1/ui-experiments").json()["referenceLayout"]["enabled"] is False
