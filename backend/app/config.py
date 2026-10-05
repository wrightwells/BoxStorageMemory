"""Environment configuration; never contains user Google credentials."""

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from shared.python.contracts import public_origin

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore", env_file=".env")

    app_name: str = "Box Storage"
    public_url: str = "http://localhost:8080"
    # Public deployment registration shared across accounts; no user/billing credentials.
    google_web_client_id: str = ""
    api_host: Literal["127.0.0.1", "0.0.0.0", "::1"] = "127.0.0.1"
    api_port: int = Field(default=8080, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    allowed_origins: str = "http://localhost:5173"
    enable_web_nfc: bool = False
    enable_api_docs: bool = True
    max_request_bytes: int = Field(default=1048576, ge=1024, le=16777216)
    utility_requests_per_minute: int = Field(default=60, ge=1, le=10000)
    utility_global_requests_per_minute: int = Field(default=600, ge=1, le=100000)
    ui_experiment_config: Path = ROOT / "config" / "ui-experiments.json"
    frontend_dist: Path = ROOT / "frontend" / "dist"

    @field_validator("public_url")
    @classmethod
    def canonical_public_url(cls, value: str) -> str:
        if len(value) > 512:
            raise ValueError("PUBLIC_URL is too long")
        return public_origin(value)

    @field_validator("app_name")
    @classmethod
    def meaningful_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("APP_NAME must not be blank")
        return value.strip()

    @field_validator("log_level", mode="before")
    @classmethod
    def uppercase_log_level(cls, value: str) -> str:
        return value.upper()

    @field_validator("allowed_origins")
    @classmethod
    def explicit_origins(cls, value: str) -> str:
        from urllib.parse import urlsplit

        for origin in value.split(","):
            if not origin.strip():
                continue
            parsed = urlsplit(origin.strip())
            if (
                parsed.scheme not in {"https", "http"}
                or not parsed.hostname
                or parsed.netloc.find("*") >= 0
                or parsed.username is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("ALLOWED_ORIGINS requires explicit HTTP(S) origins")
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.allowed_origins.split(",")
            if origin.strip()
        ]
