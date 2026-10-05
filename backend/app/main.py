from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException

from backend.app.api.health import router as health_router
from backend.app.api.utilities import ERRORS, utility_router
from backend.app.config import Settings
from backend.app.guards import ApiGuardMiddleware
from backend.app.logging import SafeRequestLoggingMiddleware
from backend.app.security import SecurityHeadersMiddleware
from backend.app.services.health import APP_VERSION


def api_error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, "details": []}}, status_code=status
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()
    app = FastAPI(
        title="Box Storage API",
        version=APP_VERSION,
        responses=ERRORS,
        docs_url="/api/docs" if config.enable_api_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(ApiGuardMiddleware, config=config)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "HEAD", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(SafeRequestLoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, config=config)
    app.include_router(health_router)
    app.include_router(utility_router(config))

    @app.exception_handler(RequestValidationError)
    async def request_error(_request: Request, _exc: RequestValidationError) -> Response:
        return api_error("INVALID_REQUEST", "Request does not match the API contract", 422)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> Response:
        if exc.status_code == 404:
            return api_error("NOT_FOUND", "Resource not found", 404)
        if exc.status_code == 405:
            result = api_error("METHOD_NOT_ALLOWED", "Method not allowed", 405)
            if exc.headers:
                result.headers.update(exc.headers)
            return result
        return api_error("HTTP_ERROR", "Request failed", exc.status_code)

    dist = config.frontend_dist.resolve()

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def frontend(path: str) -> Response:
        # API errors and missing assets must never become a successful HTML SPA response.
        if path == "api" or path.startswith("api/"):
            return api_error("NOT_FOUND", "API endpoint not found", 404)
        if any(part.startswith(".") for part in Path(path).parts) or "\\" in path:
            return api_error("NOT_FOUND", "Resource not found", 404)
        candidate = (dist / path).resolve()
        if not candidate.is_relative_to(dist):
            return api_error("NOT_FOUND", "Resource not found", 404)
        if path and candidate.is_file():
            return FileResponse(candidate)
        if path.startswith("assets/") or Path(path).suffix:
            return api_error("NOT_FOUND", "Asset not found", 404)
        index = dist / "index.html"
        if not index.is_file():
            return api_error("FRONTEND_UNAVAILABLE", "Web application is not built", 503)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app
