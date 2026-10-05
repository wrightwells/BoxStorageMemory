# Version 1 stateless API

The API never connects to Google Drive. Clients load and save their own Drive documents using their own Google authorization. Send no Google tokens, Authorization header, OAuth code or client secret to this server. The public OAuth client ID returned by configuration is not a secret.

`googleWebClientId` is the operator-configured web application identity, shared by all
users of that deployment. It is independent of Google account selection and is not a
native application registration. The Android publisher configures its own trusted
native client identity. Users need no Cloud project or payment-card setup; the API has
no credential/billing provisioning endpoint. If the web ID is empty, browser login is
unavailable until operator setup, but these stateless operations still work. See
[ADR 006](decisions/006-application-oauth-registration.md). API/schema versions remain v1.

The contract is [api/v1/openapi.json](../api/v1/openapi.json), also mirrored at [openapi.json](../openapi.json). The running API publishes `/api/openapi.json`; `/api/docs` requires `ENABLE_API_DOCS=true` (off by default in Docker). Regenerate with `.venv/bin/python tools/export_openapi.py`; CI checks the export with `--check`. API v1 supports schema version 1 and client versions starting at 1.0.0; the separate Android project consumes these interfaces without any Android code in this repository.

| Operation | Response |
| --- | --- |
| GET `/api/v1/health` | Liveness, application version, API version |
| GET `/api/v1/ui-experiments` | Credential-free runtime UX flags; invalid/missing operator configuration returns disabled Control A |
| GET `/api/v1/config` | Application name/version, canonical public origin, public web OAuth client ID, Web NFC flag, PNG format and compatibility |
| GET `/api/v1/schema/inventory` | Frozen v1 inventory JSON Schema |
| GET `/api/v1/schema/index` | Frozen v1 index JSON Schema |
| POST `/api/v1/validate/inventory` | `{ "valid": true, "errors": [] }` or validation errors |
| POST `/api/v1/validate/index` | Same result for an index |
| POST `/api/v1/qr/generate` | `image/png`, no-store, black/white, four-module quiet zone |
| POST `/api/v1/qr/drive-folder` | Same PNG format, encoding the direct Google Drive folder URL |

Runtime UX flags are read on every request and are never cached. They are separate from the existing strict public configuration contract. See [UX experiment controls and study workflow](ux-experiments.md).

`/qr/drive-folder` accepts `{ "folderId": "<Drive folder ID>" }`, with a strict 1–256 character ASCII letters/digits/underscore/hyphen ID and no additional fields or URL overrides. It encodes `https://drive.google.com/drive/folders/<folderId>` without accessing Drive. The browser saves this PNG as `box-folder-qr.png` during coordinated box creation. It uses the same request limits, credential rejection and utility rate limit as `/qr/generate`.

Validation receives the document directly, without a wrapper. Any finite JSON value is eligible for document validation. A structurally or semantically invalid document returns **200** with `valid:false`; this is a successful validation operation. Each error contains a JSON Pointer `path`, stable `code`, and a fixed human-readable `message`. For example, `{}` returns a root `SCHEMA_VIOLATION`. Error messages never repeat submitted values. Known extension fields remain allowed by the schemas; reserved credential keys listed below are rejected at transport level. Validation cannot determine uniqueness or consistency across documents that were not supplied. It performs no library lookup and no migration.

```sh
curl http://localhost:8080/api/v1/config
curl http://localhost:8080/api/v1/schema/inventory
curl -H 'Content-Type: application/json' --data-binary @fixtures/contracts/valid-inventory.json \
  http://localhost:8080/api/v1/validate/inventory
curl -H 'Content-Type: application/json' --data-binary @fixtures/contracts/valid-index.json \
  http://localhost:8080/api/v1/validate/index
curl -H 'Content-Type: application/json' \
  -d '{"boxId":"12345678-1234-4234-8234-123456789abc"}' \
  http://localhost:8080/api/v1/qr/generate -o box-qr.png
python3 tools/smoke_api.py http://localhost:8080
```

QR requests accept only a canonical lowercase UUID `boxId`. The encoded value is `PUBLIC_URL/box/{boxId}`. `PUBLIC_URL` must be a canonical HTTPS origin, or HTTP loopback for development, with no path, query or user information. Trailing root slash is normalized. Requests cannot substitute an origin, text or box number. Display the permanent box number separately on labels. This operation verifies UUID syntax, not whether the client can access that box.

Errors use `{ "error": { "code": "...", "message": "...", "details": [] } }`:

| Status | Meaning |
| --- | --- |
| 400 | `INVALID_JSON`: malformed UTF-8/JSON, duplicate keys, nonfinite numbers, credentials in JSON, or excessive complexity; `CREDENTIALS_NOT_SUPPORTED`: Authorization header or OAuth query |
| 404 / 405 | Resource absent / method unsupported |
| 413 | `REQUEST_TOO_LARGE`: request body exceeds configured bytes, including chunked requests |
| 415 | `UNSUPPORTED_MEDIA_TYPE`: utility POST requires application/json |
| 422 | `INVALID_REQUEST`: QR payload shape/UUID invalid; no submitted input echoed |
| 429 | `RATE_LIMITED`: utility request limit exceeded, with Retry-After seconds |
| 500 | `INTERNAL_ERROR`: generic failure; no exception contents exposed |

Bodies are bounded by `MAX_REQUEST_BYTES` (default 1 MiB, configurable 1 KiB–16 MiB), nesting depth 64 and 50,000 JSON nodes. Utility POSTs share fixed 60-second counters: `UTILITY_REQUESTS_PER_MINUTE` (60 per direct peer) and `UTILITY_GLOBAL_REQUESTS_PER_MINUTE` (600 per process). Counters store only transient keyed hashes of peer addresses, at most 1,024 peers, and reset every window or restart. Health/schema/config reads are exempt. Rate limiting precedes parsing, so failed POSTs count too. Forwarded headers are ignored: behind a proxy clients share its peer allowance. Multi-worker/replica deployments need proxy-level body and rate limits for a deployment-wide guarantee. No user inventory, QR output or credentials are cached or saved. Payloads exist only while handling the request. Request logs include method, matched route template, status and duration only.

API Authorization headers and query keys `access_token`, `refresh_token`, `id_token`, `client_secret`, `googleAccessToken`, `googleRefreshToken`, `code` are rejected. JSON documents additionally reject the credential keys above except `code`, recursively. These keys are reserved transport fields even where the data schema allows extensions. Generic inventory text is never treated as a credential or sent to Google.

CORS permits only `ALLOWED_ORIGINS`, does not allow credentials, and permits Content-Type. Error responses also receive the applicable CORS headers. CORS configuration is separate from Google's authorized JavaScript origins; operators must configure both appropriately. The optional server search endpoint is not implemented or advertised. Stage 5 supplies browser authentication/root setup and a direct Drive adapter; inventory/photo mutations remain gated on concurrency verification, while Stage 6 implements read-only library/box/item/photo views and recovery previews using that adapter. Stage 7 draft editors use the existing inventory/index validation endpoints without Google tokens. The backend still has no persistence or Drive mutation endpoint. Search and labels/scanning UI remain later stages.
