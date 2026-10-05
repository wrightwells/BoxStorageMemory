# Deployment and full available test run — 4 October 2026

The user requested deployment and a full test. The existing Compose service was
updated at **http://localhost:8080** using its existing environment and Google
application registration. No public hostname was configured; this is the existing
loopback deployment, not a public-domain TLS rollout.

## Deployment

- Deployed application image: `sha256:70611784bbd56231bb19ed4acf88ebb120ae8b52a1a153944ea3be4d5b9c1ef3`.
- Previous image retained as `box-storage-memory:rollback-before-release-1.0.0`:
  `sha256:6176c41264f888f3d3e3d3bbcd18d84f3b704b70f124973a23e3b88b7561437e`.
- `docker compose up --build --wait` completed. The application is healthy and
  runs as UID/GID 10001 with a read-only filesystem, temporary /tmp, all
  capabilities dropped and no-new-privileges.
- Unrelated services were untouched. Isolated HTTPS test containers/network were
  removed afterward. Drive inventories, photos and tags were not mutated.

Rollback, if required:

```bash
BOX_STORAGE_IMAGE=box-storage-memory:rollback-before-release-1.0.0 \
  docker compose up -d --no-build --wait box-storage
```

## Automated and deployed-service results

| Check | Result |
| --- | --- |
| Frontend unit/component tests | 277 passed across 17 files |
| Python API/schema/domain/security/package tests | 114 passed |
| TypeScript contract and Stage 1 prototype assertions | Passed |
| ESLint, Prettier, TypeScript, Ruff/format and mypy | Passed |
| Generated validators, compiled production build, OpenAPI/contract manifest freshness | Passed |
| HTTP assets/deep routes/JSON errors and independent-client API contracts | Passed against the updated service |
| Running OpenAPI versus published v1 export | Exact match |
| Compiled browser workflows against `http://localhost:8080` | 12 passed: system Chrome desktop, Firefox, Chrome Pixel 7 layout emulation |
| Isolated HTTPS test of the exact deployed image | Passed: trusted development CA, health/routes/HSTS/CSP, non-root/read-only runtime and private body/query log exclusion |

Browser regression workflows use synthetic Google responses, including external
changes, revocation and camera denial. They also check photo blob rendering,
search/editor/labels/recovery, login deep links, unknown records, responsive
layout, keyboard focus and sign-out. Mobile layout emulation is not physical
Android acceptance. The separate live-account results below use real Google
responses.

Existing non-failing warnings remain: the Vite main bundle exceeds 500 kB,
Starlette's httpx test transport is deprecated, and local Compose falls back to
the available Docker builder because buildx is absent.

## Live-account results

The requested test account was verified in a dedicated Chrome profile with
user-completed sign-in. Tests selected only the previously created synthetic
stages 1–7 library; no unrelated Drive files were edited. Account identifiers,
Drive IDs and credentials are omitted from this distributable record.

All ten live workflow checkpoints passed. They cover account connection, manual `box-1` lookup and UUID
routing, real 320-pixel JPEG rendering/close, search-to-item-editor navigation,
in-memory draft validation through the API, disabled production Save, QR label
generation/regeneration and canonical URL, unrelated QR rejection, optional NFC
metadata display, recursive recovery of both inventories, root-change context
clearing and sign-out. Draft changes are discarded and never saved to Drive.

The final browser audit found zero Google mutation requests, authorization to
non-Google destinations, CSP violations and unhandled page errors. Browser
storage contained only the account-scoped test-root ID preference; session
storage was empty. The application was signed out and the dedicated browser
closed after testing. No token or request-header values were collected.

The synthetic inventory remains authoritative despite its intentionally stale
index from the earlier test. The stale-index warning is expected. No reconciliation
or fixture restoration write was attempted in this run.

## Remaining acceptance limits

This deployment remains a **read-capable release candidate**. Full writable
acceptance cannot pass while atomic Drive updates, bootstrap/number allocation,
cross-file coordination and cleanup exclusion are unverified. Save/Create,
photo upload/deletion, NFC mutation and rebuilt-index publication remain disabled;
simulator results do not close those gates.

Two-account isolation, real Google expiry/revocation, live concurrent writers,
Drive backup/restore and native Drive indexing still need live evidence. Physical
camera/Android/NFC interoperability, Edge and public-domain certificate/operator
setup were not available for this run. See the [criterion acceptance record](release-acceptance.md).
