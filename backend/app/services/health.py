from backend.app.models.health import HealthResponse

APP_VERSION = "1.0.0"


def application_health() -> HealthResponse:
    """Safe liveness information; deliberately no Drive or account dependency."""
    return HealthResponse(version=APP_VERSION)
