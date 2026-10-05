import json
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import Response

from backend.app.config import Settings
from backend.app.models.utilities import (
    Compatibility,
    Document,
    DriveFolderQRRequest,
    ErrorResponse,
    Features,
    PublicConfig,
    QRRequest,
    ValidationResponse,
)
from backend.app.services.health import APP_VERSION
from backend.app.services.ui_experiments import UIExperiments, read_flags
from backend.app.services.utilities import UtilityService

ERRORS: dict[int | str, dict[str, Any]] = {
    status: {"model": ErrorResponse, "description": description}
    for status, description in {
        400: "Malformed JSON or unsupported credentials",
        413: "Request body exceeds configured limit",
        415: "JSON content type required",
        422: "Invalid request shape",
        429: "Rate limit exceeded; Retry-After gives seconds",
        404: "Resource not found",
        405: "Method not allowed",
        500: "Internal failure",
    }.items()
}


def utility_router(config: Settings) -> APIRouter:
    router = APIRouter(prefix="/api/v1", responses=ERRORS)
    service = UtilityService()
    schema_dir = Path(__file__).resolve().parents[3] / "schemas" / "v1"
    schemas: dict[str, dict[str, Any]] = {
        kind: json.loads((schema_dir / name).read_text())
        for kind, name in {
            "inventory": "inventory.schema.json",
            "index": "box-index.schema.json",
        }.items()
    }

    @router.get("/ui-experiments", response_model=UIExperiments)
    def ui_experiments(response: Response) -> UIExperiments:
        response.headers["Cache-Control"] = "no-store"
        return read_flags(config.ui_experiment_config)

    @router.get("/config", response_model=PublicConfig)
    def public_config() -> PublicConfig:
        return PublicConfig(
            appName=config.app_name,
            applicationVersion=APP_VERSION,
            publicUrl=config.public_url,
            googleWebClientId=config.google_web_client_id,
            features=Features(webNfc=config.enable_web_nfc),
            compatibility=Compatibility(
                supportedSchemaVersions=[1],
                minimumWebClientVersion="1.0.0",
                minimumAndroidClientVersion="1.0.0",
            ),
        )

    @router.get("/schema/inventory", response_model=dict[str, Any])
    def inventory_schema() -> dict[str, Any]:
        return schemas["inventory"]

    @router.get("/schema/index", response_model=dict[str, Any])
    def index_schema() -> dict[str, Any]:
        return schemas["index"]

    @router.post(
        "/validate/inventory",
        response_model=ValidationResponse,
        description="Submit the document directly. Invalid documents return 200 with valid=false.",
        openapi_extra={"requestBody": {"required": True}},
    )
    def validate_inventory(document: Annotated[Document, Body()] = None) -> ValidationResponse:
        return service.validate("inventory", document)

    @router.post(
        "/validate/index",
        response_model=ValidationResponse,
        description="Submit the document directly. Invalid documents return 200 with valid=false.",
        openapi_extra={"requestBody": {"required": True}},
    )
    def validate_index(document: Annotated[Document, Body()] = None) -> ValidationResponse:
        return service.validate("index", document)

    @router.post(
        "/qr/generate",
        response_class=Response,
        responses={
            200: {"content": {"image/png": {}}, "description": "PNG QR with four-module quiet zone"}
        },
        description="Encodes configured publicUrl + /box/ + immutable UUID; no URL overrides.",
    )
    def generate_qr(request: QRRequest) -> Response:
        return Response(
            service.qr(config.public_url, request.boxId),
            media_type="image/png",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    @router.post(
        "/qr/drive-folder",
        response_class=Response,
        responses={200: {"content": {"image/png": {}}, "description": "Drive folder QR PNG"}},
        description="Encodes https://drive.google.com/drive/folders/ + folderId; no URL overrides.",
    )
    def generate_drive_folder_qr(request: DriveFolderQRRequest) -> Response:
        return Response(
            service.drive_folder_qr(request.folderId),
            media_type="image/png",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    return router
