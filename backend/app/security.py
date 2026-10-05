"""Deployment policies. Never trust caller-supplied forwarded headers for security."""

import base64
import hashlib
import re

from fastapi.openapi.docs import get_swagger_ui_html
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.app.config import Settings


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, config: Settings) -> None:
        self.app = app
        self.headers = {
            "Content-Security-Policy": "; ".join(
                [
                    "default-src 'self'",
                    "script-src 'self' https://accounts.google.com/gsi/client",
                    "style-src 'self' https://accounts.google.com/gsi/style",
                    "img-src 'self' blob: data:",
                    "media-src 'self' blob:",
                    "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com/revoke",
                    "frame-src https://accounts.google.com/gsi/",
                    "object-src 'none'",
                    "base-uri 'none'",
                    "frame-ancestors 'none'",
                    "form-action 'self'",
                ]
            ),
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin",
            "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
            "Permissions-Policy": ", ".join(
                [
                    "camera=(self)",
                    "microphone=()",
                    "geolocation=()",
                    "payment=()",
                    "usb=()",
                    "serial=()",
                    "bluetooth=()",
                    "nfc=(self)" if config.enable_web_nfc else "nfc=()",
                ]
            ),
        }
        if config.public_url.startswith("https://"):
            # The operator terminates TLS at the documented proxy. No preload or
            # includeSubDomains: unrelated services are not silently opted in.
            self.headers["Strict-Transport-Security"] = "max-age=31536000"
        self.docs_policy: str | None = None
        if config.enable_api_docs:
            html = bytes(
                get_swagger_ui_html(
                    openapi_url="/api/openapi.json",
                    title="Box Storage API - Swagger UI",
                    oauth2_redirect_url="/docs/oauth2-redirect",
                ).body
            ).decode()
            # Hash the exact bytes between tags, including surrounding whitespace.
            inline = re.search(r"<script>([\s\S]*?)</script>", html)
            if inline:
                digest = base64.b64encode(hashlib.sha256(inline[1].encode()).digest()).decode()
                self.docs_policy = "; ".join(
                    [
                        "default-src 'self'",
                        "object-src 'none'",
                        "base-uri 'none'",
                        "frame-ancestors 'none'",
                        "connect-src 'self'",
                        f"script-src https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js 'sha256-{digest}'",
                        "style-src https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css 'unsafe-inline'",
                        "img-src 'self' data: https://fastapi.tiangolo.com/img/favicon.png",
                    ]
                )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def secured(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                names = {key.lower().encode("ascii") for key in self.headers}
                headers = [(key, value) for key, value in headers if key.lower() not in names]
                headers.extend(
                    (key.lower().encode("ascii"), value.encode("ascii"))
                    for key, value in self.headers.items()
                )
                if scope["path"] == "/api/docs" and self.docs_policy:
                    headers = [
                        (key, value) for key, value in headers if key != b"content-security-policy"
                    ]
                    headers.append((b"content-security-policy", self.docs_policy.encode("ascii")))
                # Submitted inventories and QR responses are transient utility output.
                if scope["path"].startswith("/api/"):
                    headers = [
                        (key, value) for key, value in headers if key.lower() != b"cache-control"
                    ]
                    headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, secured)
