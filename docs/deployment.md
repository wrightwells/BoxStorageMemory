# Deployment and recovery runbook

Release 1.0.0 packages one server/web application image. Production Drive writes remain disabled; use the [acceptance record](release-acceptance.md) before treating this candidate as a writable production release. There is no server inventory database, Google token store, image proxy or inventory volume.

## Local start

```bash
cp .env.example .env
# Set the public operator-managed GOOGLE_WEB_CLIENT_ID if web sign-in is needed.
docker compose up --build --wait
python3 tools/smoke_http.py http://localhost:8080
python3 tools/smoke_api.py http://localhost:8080
python3 tools/check_running_openapi.py http://localhost:8080
```

The application binds host loopback, runs as UID/GID 10001 and uses a read-only filesystem, temporary /tmp, no capabilities and no-new-privileges. Health probes `/api/v1/health`; restart is `unless-stopped`. Local HTTP is permitted only for canonical localhost/loopback origins. Remote application origins must use HTTPS.

### Host IP access

Set `HOST_IP_ADDRESS` to the host's specific IPv4 address in `.env`, then run:

```bash
docker compose -f compose.yaml -f compose.host-ip.yaml up -d --no-build --wait box-storage
python3 tools/smoke_http.py http://<host-ip>:8080
```

The overlay adds that interface's port 8080 while retaining localhost access. The default Compose file binds loopback only. Use both files for subsequent updates to retain host-IP access. Update HOST_IP_ADDRESS and recreate the service if the host's address changes.

This port binding does not change the configured canonical QR origin or Google application registration. Google OAuth requires HTTPS and rejects raw IP origins except loopback; use a registered HTTPS hostname and the production example for Google sign-in from another device. See [Google origin validation rules](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#origin-validation).

### Tailscale HTTPS

The current host is available to devices on its tailnet at **https://dell-linux-mint.bandicoot-pumpkinseed.ts.net**, resolving to `100.82.50.120`. Tailscale Serve terminates HTTPS and proxies to the existing loopback application at `http://127.0.0.1:8080`. The localhost and `10.10.1.8:8080` bindings remain available.

Inspect existing routes before changing Serve; preserve unrelated handlers. Configure this host with:

```bash
tailscale serve status
tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:8080
```

Set `PUBLIC_URL=https://dell-linux-mint.bandicoot-pumpkinseed.ts.net` in the operator's `.env`. Add that exact origin to `ALLOWED_ORIGINS`, retaining any existing localhost/development/LAN origins that are still required, and recreate the app using both Compose files above. New application QR labels use this canonical HTTPS origin. Serve runs persistently in background mode; access remains subject to the tailnet's access rules. [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve).

Register the same HTTPS address under **Authorized JavaScript origins** on the existing Google web OAuth client, without a trailing slash. Application CORS configuration does not register an origin with Google. See [Google setup](google-setup.md).

Verified on 5 October 2026: hostname-validated TLS certificate, HTTPS health/assets/deep routes, canonical URL/CORS/HSTS, retained LAN access, and 12 browser checks across Chrome, Firefox and mobile. Google/Drive requests in those browser checks were mocked; real Google sign-in at the new origin still needs operator registration and a live check.

## HTTPS example

`compose.production.yaml` is a standalone deployment, not an overlay on the local port-publishing file. Its application port is internal only; Caddy terminates HTTPS on 80/443. Caddy configuration is copied into its proxy image, so no host configuration mount is required. Named TLS volumes contain certificate/configuration state, not inventories or Google user tokens. No privileged mode, host/Docker-socket mount or inventory/database service is used.

Point a hostname you control at the host. Open TCP 80/443 for certificate validation and HTTPS. Copy `.env.production.example` to an operator-owned env file, set `BOX_STORAGE_HOST`, matching origin-only `PUBLIC_URL`, public web client ID and a versioned application image tag/digest. Do not put account passwords, OAuth tokens or client secrets there.

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up --build --wait
python3 tools/smoke_http.py https://boxes.example.com
python3 tools/smoke_api.py https://boxes.example.com
python3 tools/check_running_openapi.py https://boxes.example.com
```

Register that exact HTTPS origin in the operator's Google web application and configure allowed/test users and scope consent as described in [Google setup](google-setup.md). This implementation uses the GIS popup token client, not a server authorization-code callback; it needs no app redirect handler/client secret. A separately developed native client uses its publisher's platform registration. Ordinary users need no Cloud project or payment card.

The example pins [Caddy 2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7). Its official Docker tag was not published at verification time, so the proxy build uses the official runtime layout with the upstream amd64/arm64 binary verified against pinned SHA-512 [release checksums](https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_checksums.txt). The installed proxy binary is 2.11.7; unsupported architectures fail explicitly. [Caddy's proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) documents forwarded headers; this application does not trust caller-supplied forwarded headers to change security policy. Public URLs, QR origins and HTTPS/HSTS mode come from operator configuration. Caddy performs TLS and HTTPS redirects. Keep the application's port private. Public certificate issuance and a real domain require operator infrastructure; the local acceptance test uses an isolated development certificate and does not prove public issuance.

## Policies and diagnostics

The application sends CSP, nosniff, frame denial, strict-origin referrer policy, popup-compatible COOP and capability-specific Permissions-Policy on web/API/error responses. CSP permits only self scripts plus Google's GIS client, Google API/GIS and OAuth revocation connections, the GIS frame/styles and local blob/data photos; it excludes inline script/eval, embedding and arbitrary connections. Schema validation is generated at build time. Camera access is self-only, microphone/location/payment/USB/serial/Bluetooth are disabled; NFC is self-only when enabled. Policies do not grant device permission. No cross-origin isolation policy blocks Google's popup.

HSTS (`max-age=31536000`, without preload/includeSubDomains) is configured only for HTTPS public origins. Browsers ignore it over plain HTTP. See [Google's CSP/popup setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) and [HSTS behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security). GIS/Drive/camera hardware under final policies still require live acceptance. Keep API docs disabled in production; the released OpenAPI and integration guide are the supported documentation. Optional interactive API docs use a separate CDN-and-script-hash policy; production Compose disables them. No CSP reporting/analytics endpoint receives user URLs or content.

Application logs contain safe method, route-template, status, duration and generic failure metadata; request headers/bodies/queries, raw private paths, image data and exception text are excluded. Uvicorn access logs and proxy request/exception logs are disabled. API responses use no-store. Browser application code does not emit tokens, payloads or scan frames to telemetry/console. Do not add request-body, network-trace or CSP-report collection to production; use synthetic data for diagnostic captures. Google libraries/browser tools are external software and their own diagnostics are not application persistence.

## Configuration

| Setting | Meaning |
| --- | --- |
| `APP_NAME` | Public display name |
| `PUBLIC_URL` | Canonical origin for QR/compatibility and HTTPS policy; no path/query/fragment |
| `GOOGLE_WEB_CLIENT_ID` | Public operator registration; blank disables web authorization |
| `ALLOWED_ORIGINS` | Exact API CORS origins, no wildcard; production example uses PUBLIC_URL |
| `ENABLE_WEB_NFC` | Optional runtime NFC feature and permissions policy; false by default |
| `ENABLE_API_DOCS` | Interactive API docs, false in Compose; versioned OpenAPI remains available |
| `API_HOST`, `API_PORT` | Listener; container defaults 0.0.0.0:8080, native defaults loopback |
| `HOST_PORT` | Local Compose's published port, default 8080 |
| `HOST_IP_ADDRESS` | Specific additional IPv4 interface for the optional compose.host-ip.yaml overlay |
| `BOX_STORAGE_HOST` | HTTPS proxy's controlled hostname |
| `BOX_STORAGE_IMAGE` | Versioned application image/digest |
| `LOG_LEVEL` | INFO default; logs remain sanitized at every level |
| `MAX_REQUEST_BYTES` | Utility request limit, default 1 MiB |
| `UTILITY_REQUESTS_PER_MINUTE` / `UTILITY_GLOBAL_REQUESTS_PER_MINUTE` | Transient per-peer/global limits, defaults 60/600 |
| `FRONTEND_DIST` | Native runtime asset path; container fixes it to /app/frontend/dist |

Configuration exposes no private provider secret. CORS is a browser policy, not API authentication. Reverse-proxy peers can share a rate-limit bucket because forwarded peer headers are deliberately untrusted; configure limits for actual load, and preserve edge privacy if adding rate limiting.

## Update, rollback and health

Record the current image digest, env configuration and contract release before upgrading. Build/tag the candidate, run all checks in an isolated deployment, and retain the previous image. Replace the app with `docker compose ... up -d --no-build --wait box-storage`; validate health, routes, running OpenAPI and a disposable library. Roll back by restoring the previous `BOX_STORAGE_IMAGE` digest and repeating that command. No server inventory migration is required; never roll back to a client that rewrites an unsupported schema. Proxy certificate state should be retained across replacement. Do not run `down -v` as an update step.

If unhealthy, inspect `docker compose ... ps`, bounded sanitized app logs and `/api/v1/health`. Check API_PORT, frontend assets and configuration validity. A healthy API does not prove Google consent, selected-root permissions, hardware support or TLS issuance. Sign-in errors usually require exact origin/client registration or renewed consent; blank web client IDs deliberately disable authorization. QR deep routes require the same frontend SPA fallback; missing API/assets must remain JSON 404s.

## Drive backup, restore and portability

Back up the selected root in Google Drive, preserving every authoritative inventory, ordinary photo and pending/recovery marker; the index alone is not a backup. Never include OAuth credentials. Export/copy with tools that preserve exact image filenames and bytes. Test on a disposable copy and retain originals until the restore is checked. Copying can change Drive folder/file IDs and introduce duplicate names; avoid opening originals and restored copies under one indexed root as though they were distinct UUID boxes.

Restore into a separate root, sign in with an authorized account and select it. Validate supported inventories and photos, then preview recursive index recovery. Check box UUID/number uniqueness, item/photo references, NFC uniqueness, current folder IDs and unavailable/unsupported files. Index remains derived; do not renumber/reidentify boxes to match changed folders. **Saving a rebuilt index is gated in this candidate**: recovery previews and validation are available, while a verified coordinated replacement remains a release blocker. Preserve corrupt originals for deliberate review. No automatic pending-operation resume or cleanup occurs.

A compatible replacement deployment can select the same Drive root without moving inventories. Retain the canonical public origin to keep printed QR URLs valid. For another origin, retain a controlled old domain with deliberate HTTPS redirects or regenerate labels; scanner trust never automatically expands. Register the new origin with the operator's Google application. Every account/client still needs its own Google grant and permissions. See [client integration](client-integration.md) and [compatibility](compatibility.md).

## Creation capability

This build enables empty-library initialization and new-box creation through the live-tested [coordinated v2 protocol](decisions/007-coordinated-creation.md). Ordinary box/item saves use decision 008. Photo management follows decision 009; no configuration override enables NFC mutation or recovery publication. Interrupted creations retain a durable owner and pending records for review; do not clear or expire the owner automatically.


Existing-box save follow-up (4 October 2026): ordinary box/item additions, updates and removals now use the coordinated v2 protocol in [decision 008](decisions/008-coordinated-editing.md). Photo management now uses the same owner and conditional writes. NFC mutation, recovery publication and automatic interrupted-operation recovery remain gated. This supersedes the earlier existing-box-save limitation above.


## Runtime UX experiments

The approved default is NAV-001 persistent desktop navigation and the phone/tablet bottom bar. `baselineVariant: "persistent-navigation"` promotes both new and existing sessions; `?ui=control` preserves the prior navigation as a rollback option. Both Compose configurations mount `./config:/app/config:ro`; edit or atomically replace `config/ui-experiments.json` on the host without restarting. Disabling NAV-001 or forcing `control` restores the previous navigation. Missing/invalid global configuration also uses that safe fallback.

[CTX-001 — return to search results](search-context-experiment.md) is the next independent experiment. Its default rollout is 0% and measurement remains disabled. Preview with `?context=restore-search`; disable `searchContext.enabled` or force `searchContext.forceVariant` to `control` to roll it back while keeping approved navigation. Open pages poll every 15 seconds, with a 5-second request timeout. `UI_EXPERIMENT_CONFIG` sets the file path outside Compose. Each future baseline promotion requires explicit approval.

[IMG-001 — photo recognition](photo-recognition-experiment.md) adds `photoRecognition` flags with 0% default rollout. Preview with `?photos=photo-recognition`; disable its `enabled` flag or force `control` to restore photo icons without changing navigation or search flags. No Drive writes or external analytics are introduced.

[REF-001 — reference-based box workspace](reference-box-experiment.md) adds independent `referenceLayout` flags. Preview with `?layout=reference-box`; disable its `enabled` flag or force `control` for rollback. The approved `referenceLayout.baselineVariant: "reference-box"` is the default regardless of old session assignments; explicit control selection and runtime rollback remain available. Measurement remains off.
