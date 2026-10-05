"""Public, credential-free runtime UX flags. Invalid configuration fails closed."""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SearchContextFlags(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = False
    rolloutPercentage: int = Field(default=0, ge=0, le=100)
    forceVariant: Literal["control", "restore-search"] | None = None


class PhotoRecognitionFlags(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = False
    rolloutPercentage: int = Field(default=0, ge=0, le=100)
    forceVariant: Literal["control", "photo-recognition"] | None = None


class ReferenceLayoutFlags(BaseModel):
    baselineVariant: Literal["control", "reference-box"] = "control"
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = False
    rolloutPercentage: int = Field(default=0, ge=0, le=100)
    forceVariant: Literal["control", "reference-box"] | None = None


class UIExperiments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    experimentId: Literal["NAV-001"] = "NAV-001"
    enabled: bool = False
    rolloutPercentage: int = Field(default=0, ge=0, le=100)
    forceVariant: Literal["control", "persistent-navigation"] | None = None
    measurementEnabled: bool = False
    baselineVariant: Literal["control", "persistent-navigation"] = "control"
    referenceLayout: ReferenceLayoutFlags = Field(default_factory=ReferenceLayoutFlags)
    photoRecognition: PhotoRecognitionFlags = Field(default_factory=PhotoRecognitionFlags)
    searchContext: SearchContextFlags = Field(default_factory=SearchContextFlags)


def read_flags(path: Path) -> UIExperiments:
    try:
        return UIExperiments.model_validate_json(path.read_text())
    except (OSError, ValueError):
        return UIExperiments()
