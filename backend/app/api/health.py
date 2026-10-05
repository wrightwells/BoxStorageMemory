from fastapi import APIRouter

from backend.app.models.health import HealthResponse
from backend.app.services.health import application_health

router = APIRouter(prefix="/api/v1")


@router.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return application_health()
