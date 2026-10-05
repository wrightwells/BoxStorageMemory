from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    apiVersion: Literal["v1"] = "v1"
