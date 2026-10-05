"""Safe access metadata only: no headers, bodies, queries or raw request paths."""

import logging
from time import monotonic

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("box_storage.requests")
METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}


class SafeRequestLoggingMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = monotonic()
        status = 500
        response_started = False

        async def safe_send(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, safe_send)
        except Exception:
            # Do not forward exception text/tracebacks to access logs or clients.
            logger.error("request_failed")
            if not response_started:
                await JSONResponse(
                    {
                        "error": {
                            "code": "INTERNAL_ERROR",
                            "message": "Request failed",
                            "details": [],
                        }
                    },
                    status_code=500,
                )(scope, receive, safe_send)
            else:
                await send({"type": "http.response.body", "body": b"", "more_body": False})
        finally:
            route = getattr(scope.get("route"), "path", "unmatched")
            method = scope.get("method", "OTHER")
            logger.info(
                "method=%s route=%s status=%s duration_ms=%.1f",
                method if method in METHODS else "OTHER",
                route,
                status,
                (monotonic() - started) * 1000,
            )
