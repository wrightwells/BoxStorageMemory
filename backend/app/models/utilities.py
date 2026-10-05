from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class ValidationIssue(BaseModel):
    path: str
    code: str
    message: str


class ValidationResponse(BaseModel):
    valid: bool
    errors: list[ValidationIssue]


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: list[ValidationIssue] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorDetail


class Compatibility(BaseModel):
    supportedSchemaVersions: list[int]
    minimumWebClientVersion: str
    minimumAndroidClientVersion: str


class Features(BaseModel):
    webNfc: bool
    qrFormat: Literal["png"] = "png"


class PublicConfig(BaseModel):
    appName: str
    applicationVersion: str
    apiVersion: Literal["v1"] = "v1"
    publicUrl: str
    googleWebClientId: str
    features: Features
    compatibility: Compatibility


class QRRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, regex_engine="python-re")
    boxId: str = Field(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])"
    )


# The validation operations accept any finite JSON value, including invalid documents.
class DriveFolderQRRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, regex_engine="python-re")
    folderId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,256}$(?![\s\S])")


Document = JsonValue
