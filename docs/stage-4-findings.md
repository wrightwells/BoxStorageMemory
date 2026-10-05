# Stage 4 verification

Date: 3 October 2026. Stage 4 is complete locally. No Google account or OAuth client configuration was needed, and no Android application code was added.

Design revision: 4 October 2026. `googleWebClientId` is the deployment's shared application registration, independent of the connected user's account. The public config allowlist exposes no billing/project provisioning, user credential material or native identity registration. ADR 006 requires no HTTP/schema change or OpenAPI version bump; the utility API still works without Google configuration. Historical execution results below are unchanged. See [registration decision](decisions/006-application-oauth-registration.md).

Delivered all seven v1 operations: health, public configuration, inventory/index schemas, inventory/index validation and PNG QR generation. Backend request/response models are typed; the validation operations accept arbitrary finite JSON documents and distinguish invalid documents (200, valid=false) from malformed transport. QR requests validate canonical UUIDs and reject extra fields. Public URLs use the shared canonical-origin contract.

The [versioned OpenAPI](../api/v1/openapi.json) and root alias match `/api/openapi.json`. Only implemented operations appear. CI verifies export freshness and executes the standalone [HTTP contract smoke tool](../tools/smoke_api.py) against Compose. [API documentation](api.md) includes token-free examples, compatibility information, status codes and deployment limits.

Verification performed:

- Hash-pinned runtime/development dependency locks regenerated and development installation verified with `--require-hashes`. QR runtime dependencies are qrcode/Pillow; zxing-cpp is a development-only independent decoder.
- Ruff lint/format and strict mypy passed (17 backend source files); repository Prettier check passed.
- Pytest: **105 passed**, plus **116 passed subtests** from existing contract/prototype checks. This includes every shared validation-document fixture over HTTP, exact published schemas, allowlisted configuration, malformed/duplicate/nonfinite/UTF-8 JSON, null/scalar documents, request size including chunked bodies, nesting/node limits, rate reset/global caps, QR request shape, token rejection, CORS errors and log/input privacy.
- TypeScript contract suite: **112 passed**, covering 110 shared vectors, unknown-field editing and independent Python/TypeScript parity.
- QR PNG decoded with zxing-cpp to the exact configured HTTPS `/box/{UUID}` URL.
- Native server on a temporary loopback port passed existing frontend/health and new API HTTP smoke checks.
- Docker image built from the updated lock. Isolated Compose deployment passed both HTTP smoke checks on an assigned host port with API_PORT=9090, was healthy, ran as UID 10001 and had a read-only root filesystem. Temporary services were stopped after verification.

Only public schemas and transient rate counters exist in server service state. Documents and QR bytes are processed in memory for the request, never saved, logged, forwarded to Google or retained in a server inventory cache. Configuration has an explicit public response model. Common errors omit inputs, headers, queries and exception contents. Packaged Uvicorn disables ordinary access logs and forwarded-header interpretation.

Limits and remaining work:

- Rate limits are bounded, process-local fixed-window counters. Behind a reverse proxy, direct peers share its allowance. Production proxy/global rate controls are still Stage 11 work; these counters are not a distributed limit.
- Validation sees only the supplied document; library-wide consistency and Drive access remain client responsibilities. PNG UUID validity does not prove box accessibility.
- Schema extension support remains intact, with the reserved credential key transport restriction documented in the API guide.
- The existing upstream Starlette TestClient/httpx deprecation warning remains; tests pass. No dependency migration outside this stage was needed.
- Stage 1 live Google scope/authentication and concurrency verification still require operator configuration. Stage 5 has since delivered local browser authorization/root setup and a direct Drive adapter using the shared web registration; live same-application account acceptance remains pending. Search, labels/scanning UI and production deployment acceptance remain later stages. Optional server search is deferred.
