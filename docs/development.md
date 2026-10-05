# Development and local deployment

Stage 3 provides a runnable FastAPI/Uvicorn service, React/TypeScript/Vite web shell,
health endpoint, browser routes, locked dependencies, checks and a Compose deployment.
Stage 4 adds public configuration, schemas, document validation and PNG QR generation.
Stage 5 adds browser Google authorization, account/root setup and the direct Drive adapter.
Stage 6 adds read-only browsing, on-demand photos and recursive index recovery previews.
Stage 7 adds in-memory creation/edit forms, local/API validation and gated mutation/reconciliation services.
Stage 8 adds photograph selection/capture, JPEG processing and gated reference/cleanup recovery.
No Google client ID is needed to use the stateless API. See [API integration instructions](api.md)
and [Google application setup](google-setup.md#stage-5-application-setup-and-live-checks).

These installation/configuration commands are for the application operator. Ordinary
web/Android users sign in with Google and select a library; they need no Cloud project,
project membership or payment-card setup. One managed project may register the separate
platform clients. Independent web deployments still need their exact trusted origin
registered. Operator quota/verification and potential costs are described in
[ADR 006](decisions/006-application-oauth-registration.md).

## Requirements

- Python 3.12 and venv support.
- Node 22.13 or newer in the Node 22 series, with npm.
- Docker Engine and Docker Compose v2 for container verification.

## Install from a clean checkout

Run from the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.lock
npm ci --ignore-scripts --no-audit --no-fund
cp .env.example .env
```

Copy the example only if `.env` does not already exist; preserve existing configuration.
Python Settings reads `.env` and environment variables, with explicit environment
variables taking precedence. Compose reads the same file for substitution. Do not put
Google tokens, passwords or client secrets in it. Only the public OAuth client ID is
returned by the public configuration endpoint for browser authentication. Configure
one `GOOGLE_WEB_CLIENT_ID` for the deployment; adding/switching users does not change it.
An empty ID disables web login with an operator-setup message while utility endpoints
remain usable. No application billing credential or Google account password belongs
in environment configuration.

The root npm package manages the frontend workspace and existing shared contract
tooling with one `package-lock.json`. Python runtime dependencies are recorded in
`backend/requirements.lock`; `requirements-dev.lock` also includes test, lint, format,
type and contract tooling. Both Python locks contain exact versions and hashes.

## Develop with live frontend reload

In one terminal:

```bash
.venv/bin/python -m uvicorn backend.app.main:create_app --factory --reload --host 127.0.0.1 --port 8080 --no-access-log --no-proxy-headers
```

In another:

```bash
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `127.0.0.1:8080`. The backend's
safe logger records method, matched route pattern, status and duration, never raw
paths, queries, headers or bodies. Keep Uvicorn's regular access logger disabled in
development as shown. The frontend's service status calls `/api/v1/health` without
credentials. If you change the development backend port, update the Vite proxy too.

## Run a compiled deployment locally

```bash
npm run build
.venv/bin/python -m backend.app
```

Open `http://localhost:8080`. Native startup binds loopback by default. This command honours `API_HOST`, `API_PORT` and `LOG_LEVEL` and
disables Uvicorn's normal request logger. With no frontend build, API health still
works but browser routes explicitly return `FRONTEND_UNAVAILABLE` (503). Health is
service liveness; it is not a Google connectivity check.

Browser routes include `/`, `/login`, `/library`, `/library/new`, `/search`, `/scan`, `/box/:boxId/label`, `/box/:boxId/tags`, `/box/:boxId`,
`/box/:boxId/edit`, `/box/:boxId/item/:itemId`, `/box/:boxId/item/:itemId/photos` and `/settings`. Reloading a deep link
returns the compiled application. The browser shows a page-not-found screen for
unknown pages. Missing `/api/*` endpoints and missing static assets return JSON 404s
and never fall back to HTML. Sign-in and settings provide working Drive connection and
folder setup when configured. [Library browsing](library.md) resolves box/item UUIDs, supports
manual number lookup and previews recovery. Inventory/photo mutations and saving a rebuilt
index stay blocked until the Stage 1 write gates pass; list thumbnails remain deferred.
[Creation/editing drafts](editing.md) retain extension fields and protect identities.
Drafts are volatile; the production Save/Create controls remain disabled.
[Search](search.md) progressively reads indexed inventories, reports incomplete results and opens matching items.
[Photograph controls](photos.md) allow local JPEG previews; upload/reference/trash controls remain gated.

## Run with Compose

```bash
docker compose up --build --wait
python3 tools/smoke_http.py http://localhost:8080
python3 tools/smoke_api.py http://localhost:8080
docker compose down
```

Compose defaults to loopback port 8080. `HOST_PORT` changes the published port and
`API_PORT` changes the application's internal port; update `PUBLIC_URL` and
`ALLOWED_ORIGINS` to match the browser origin when changing the deployment URL.
`BOX_STORAGE_IMAGE` optionally selects an already-built image; otherwise Compose
builds/tags `box-storage-memory:local`.

The image uses a Node build stage and a Python runtime stage, runs as UID/GID 10001,
and exposes only the application port. Compose enables a read-only filesystem,
temporary `/tmp`, no new privileges and no Linux capabilities. Health checks use
Python's standard library and honour `API_PORT`. There are no inventory/database
volumes. Localhost HTTP is a development configuration; remotely accessible HTTPS
and the full production header/proxy policy belong to Stage 11.

## Configuration

| Variable | Default / purpose |
| --- | --- |
| `APP_NAME` | `Box Storage`, application/OpenAPI title |
| `PUBLIC_URL` | `http://localhost:8080`, reserved for shared client/QR configuration |
| `GOOGLE_WEB_CLIENT_ID` | Empty, one operator-managed public web registration shared by deployment users |
| `API_PORT` | `8080`, runtime listener and health check |
| `API_HOST` | `127.0.0.1` for native startup, `0.0.0.0` inside the image; Compose still publishes only loopback |
| `HOST_PORT` | `8080`, Compose loopback port only |
| `BOX_STORAGE_IMAGE` | `box-storage-memory:local`, Compose image name |
| `LOG_LEVEL` | `INFO`, safe application logging |
| `ALLOWED_ORIGINS` | Comma-separated explicit browser origins; wildcard rejected |
| `ENABLE_WEB_NFC` | `false`, reserved capability flag |
| `ENABLE_API_DOCS` | `false` in example/container, `true` when no configuration overrides local defaults |
| `FRONTEND_DIST` | Repository `frontend/dist`, `/app/frontend/dist` in image |

The OpenAPI document at `/api/openapi.json` describes all seven Stage 4 operations:
health, public configuration, inventory/index schemas, inventory/index validation,
and PNG QR generation. Interactive `/api/docs` is controlled by `ENABLE_API_DOCS`.
The versioned export is `api/v1/openapi.json`, with `openapi.json` as the root alias.
See [API integration instructions](api.md) for request/response examples and limits.

## Required checks

```bash
.venv/bin/ruff check backend
.venv/bin/ruff format --check backend
.venv/bin/mypy
.venv/bin/pytest
PYTHON=.venv/bin/python npm run test:contracts
npm run test:prototypes
npm run lint
npm run format:check
npm run typecheck
npm run test:frontend
npm run build
```

The Python tests include FastAPI integration tests and the existing shared contract
and prototype-server checks. Frontend tests exercise routes, connection/root setup,
account isolation, token boundaries, Drive failures, service failure, library/box/item views,
photo cleanup, external refresh, recovery ambiguity/conflicts, creation/edit drafts,
validation, unsaved navigation, conditional-write races and partial/ambiguous operation results. The existing independent contract validators retain
their shared vectors. Some restricted sandboxes require permission for the Python
test transport's temporary sockets; CI and ordinary local development do not.

CI in `.github/workflows/ci.yml` runs these checks and separately builds the image,
starts Compose, performs the HTTP smoke test and verifies UID 10001. It needs no
OAuth credentials or deployed secrets and does not publish the image.

## Updating locks and formatting

```bash
.venv/bin/pip-compile --generate-hashes --strip-extras --no-emit-index-url --no-emit-trusted-host --output-file backend/requirements.lock backend/requirements.in
.venv/bin/pip-compile --generate-hashes --strip-extras --allow-unsafe --no-emit-index-url --no-emit-trusted-host --output-file requirements-dev.lock requirements-dev.in
.venv/bin/ruff format backend
npm exec prettier -- --write frontend package.json tsconfig.contracts.json .github/workflows/ci.yml compose.yaml
```

Review resolved dependency changes, then rerun the required checks and image build.
For deliberate upgrades use pip-compile's upgrade options; normal compilation keeps
existing pins where possible. Use npm workspace install commands from the root and
commit the single npm lock. Generated builds, caches, venvs and local `.env` files
are ignored; `.env.example` is included in source control.

Stage 4 utility limits are configured with `MAX_REQUEST_BYTES`, `UTILITY_REQUESTS_PER_MINUTE`
and `UTILITY_GLOBAL_REQUESTS_PER_MINUTE`; defaults and proxy limitations are documented
in [the API guide](api.md). The packaged server disables forwarded-header interpretation.

Check the versioned HTTP contract with `.venv/bin/python tools/export_openapi.py --check`.


## Labels, security and release checks

[QR/NFC](qr-nfc.md) uses local camera decoding and optional runtime NDEFReader serials; mutations remain gated. Browser validators are generated with `npm run build:web-validators` after schema changes; `npm run check:web-validators` checks freshness, and build enforces that check. Their structural/domain fixture parity is tested without requiring browser unsafe-eval. The QR decoder is lazy loaded.

[HTTPS deployment/security](deployment.md) includes strict CSP/permissions, sanitized logs and a standalone production Compose example. Use the [release acceptance commands](release-acceptance.md) for browser and contract handoff verification. `npm run test:browser` starts/stops its own compiled loopback test server and mocks Google with synthetic data; it does not grant real-account/hardware acceptance. Install Playwright Chromium/Firefox first, or set BSM_CHROME_PATH for a system Chrome. BSM_EDGE_PATH adds an explicit installed Edge run; mobile layout emulation does not prove physical Android behavior.

Build the versioned client archive with `python3 tools/release_contracts.py --check --output /tmp/box-storage-contracts-1.0.0.zip`; the [integration guide](client-integration.md) documents token-free API and direct Drive responsibilities. `tools/check_running_openapi.py ORIGIN` compares the released export with a running service and is run in container CI. There is no native Android build here.
