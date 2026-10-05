"""Bounded, transient transport checks. Never log or retain submitted documents."""

import hashlib
import json
import math
import secrets
from time import monotonic
from urllib.parse import parse_qsl

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.app.config import Settings

CREDENTIAL_KEYS = {
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
    "googleAccessToken",
    "googleRefreshToken",
}
UTILITY_PATHS = {
    "/api/v1/validate/inventory", "/api/v1/validate/index", "/api/v1/qr/generate",
    "/api/v1/qr/drive-folder",
}


def error_response(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, "details": []}}, status_code=status
    )


def strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value: str) -> None:
    raise ValueError("Nonfinite JSON number")


def check_json(document: object) -> None:
    pending = [(document, 0)]
    nodes = 0
    while pending:
        value, depth = pending.pop()
        nodes += 1
        if depth > 64 or nodes > 50000:
            raise ValueError("JSON complexity limit exceeded")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Nonfinite JSON number")
        if isinstance(value, dict):
            if CREDENTIAL_KEYS.intersection(value):
                raise ValueError("Credentials are not supported")
            pending.extend((child, depth + 1) for child in value.values())
        elif isinstance(value, list):
            pending.extend((child, depth + 1) for child in value)


class ApiGuardMiddleware:
    def __init__(self, app: ASGIApp, config: Settings) -> None:
        self.app = app
        self.config = config
        self.window = monotonic()
        self.count = 0
        self.peers: dict[str, int] = {}
        self.salt = secrets.token_bytes(32)

    def allow(self, scope: Scope) -> bool:
        now = monotonic()
        if now - self.window >= 60:
            self.window = now
            self.count = 0
            self.peers.clear()
        peer = str((scope.get("client") or ("unknown", 0))[0])
        digest = hashlib.blake2b(peer.encode(), key=self.salt, digest_size=16).hexdigest()
        previous = self.peers.get(digest, 0)
        if (
            self.count >= self.config.utility_global_requests_per_minute
            or previous >= self.config.utility_requests_per_minute
            or (digest not in self.peers and len(self.peers) >= 1024)
        ):
            return False
        self.count += 1
        self.peers[digest] = previous + 1
        return True

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        queries = {key for key, _ in parse_qsl(scope.get("query_string", b"").decode("latin1"))}
        if b"authorization" in headers or queries.intersection(CREDENTIAL_KEYS | {"code"}):
            await error_response(
                "CREDENTIALS_NOT_SUPPORTED", "Do not send Google credentials", 400
            )(scope, receive, send)
            return
        if scope["method"] != "POST" or scope["path"] not in UTILITY_PATHS:
            await self.app(scope, receive, send)
            return
        if not self.allow(scope):
            response = error_response("RATE_LIMITED", "Utility request limit exceeded", 429)
            response.headers["Retry-After"] = str(
                max(1, math.ceil(60 - (monotonic() - self.window)))
            )
            await response(scope, receive, send)
            return
        if headers.get(b"content-type", b"").split(b";")[0].strip().lower() != b"application/json":
            await error_response("UNSUPPORTED_MEDIA_TYPE", "Use application/json", 415)(
                scope, receive, send
            )
            return
        body = bytearray()
        try:
            declared = headers.get(b"content-length")
            if declared is not None and int(declared) > self.config.max_request_bytes:
                await error_response("REQUEST_TOO_LARGE", "Request body too large", 413)(
                    scope, receive, send
                )
                return
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body.extend(message.get("body", b""))
                if len(body) > self.config.max_request_bytes:
                    await error_response("REQUEST_TOO_LARGE", "Request body too large", 413)(
                        scope, receive, send
                    )
                    return
                if not message.get("more_body", False):
                    break
            document = json.loads(
                body.decode("utf-8"),
                object_pairs_hook=strict_object,
                parse_constant=reject_constant,
            )
            check_json(document)
        except (ValueError, RecursionError):
            await error_response(
                "INVALID_JSON",
                "Use finite UTF-8 JSON without duplicate keys, credentials or excessive nesting",
                400,
            )(scope, receive, send)
            return
        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
