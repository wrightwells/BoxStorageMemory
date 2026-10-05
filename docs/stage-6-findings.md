# Stage 6 verification

Date: 4 October 2026. Read-only library/box/item/photo views and recursive index recovery previews are implemented. Local checks pass; live Google acceptance, recovery saving and list thumbnails remain outstanding. No real Google account was used in the original local-only run. OAuth has since been configured and live results are appended below; at the original run the deployment had no configured public OAuth client ID; an account password cannot substitute for OAuth setup.

Delivered:

- Validated root index with box number/name/location, normalized manual number lookup, nested folder browsing and empty states.
- UUID-based box/item resolution with root ancestry checks, inventory schema and UUID/number verification, authoritative metadata and explicit stale-index warnings.
- On-demand private image downloads through the client Drive adapter, missing/duplicate photo handling, retry and object URL cleanup. List loading does not request full images.
- Explicit refresh invalidates runtime documents/photos and reports observed inventory-version changes. Damaged/newer records fail safely without mutation.
- Recursive recovery proposal preserving authoritative number/NFC associations, refreshed folder IDs, supported extension fields and unavailable original entries. Duplicate/invalid/newer/inaccessible records are reported. Confirmation and listing/version rechecks exist behind the closed write adapter; they are not an atomic-write guarantee.
- Context resets abort pending library work and clear documents, photos and recovery reports on account/root/authorization changes. Box/item presentation is keyed to that context so old records are removed immediately.

Verification:

- **80 frontend tests passed**, including 25 library service tests and 11 inventory screen tests alongside the 44 existing tests. Coverage includes nested/manual lookup, direct item links, account-setup return destinations, external edits, empty/missing records, schema/identity guards, photo cleanup, late responses, recovery duplicates/retention/NFC mapping, changed scan inputs and the closed write gate.
- Frontend lint, TypeScript, formatting and production build passed. Shared Python/TypeScript contract parity and Stage 1 prototype assertions passed.
- **105 Python tests passed**; backend Ruff lint/format, strict mypy and versioned OpenAPI freshness passed. The pre-existing Starlette/httpx test transport deprecation warning remains.
- An isolated Compose deployment passed frontend/deep-route/assets and stateless API smoke checks, became healthy, ran as UID 10001 with a read-only filesystem, and was removed afterward. No existing deployment was changed.
- Documentation links were checked.
- The Stage 6 Docker image builds with shared TypeScript/schema inputs and synthetic test fixtures required by frontend type checking. No schema/API contract, dependency or backend endpoint was added.

## Remaining acceptance

Run [the live checklist](library.md#live-acceptance-checklist) after operator OAuth setup. Actual consent/CORS/scope reach, nested/shared-folder behaviour, expiry and multi-account isolation remain unverified. Shared application registration still requires no Cloud project/payment card from each user.

Recovery replacement and initial index creation remain disabled by the Stage 1 atomic-update/bootstrap gate. Re-listing files and comparing versions cannot close the final read/write race. A damaged original index produces a guarded preview; a safe archival/replacement procedure still requires the gated write implementation. No file is saved or removed by Stage 6 browsing/recovery UI.

List thumbnails are an explicit acceptance gap. Google's [Drive files reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) documents `thumbnailLink` as short-lived, credentialed for private files, and unsuitable for direct web use because of CORS; its recommended proxy conflicts with this application's client-only Google access. Stage 6 uses metadata/photo counts and explicit full-photo requests. No server proxy, public-sharing workaround or token-bearing image URL was introduced. A compatible client-only thumbnail strategy needs independent verification.

The selected root remains an application traversal boundary, not a folder-scoped OAuth permission. Production hosting/CSP work remains Stage 11; search, editing, photo mutations and scanning remain later stages.

## Live single-account follow-up — 4 October 2026

Live single-account checks passed for nested/empty-box inventory reads, manual box-number lookup, item UUID links, direct JPEG viewing/closing, missing-index recovery, missing-photo errors, external folder rename/move within the root, external inventory refresh and stale-index warnings. Recovery preserved authoritative number/NFC data and did not write. Newer/corrupt schema guards, root-change photo URL cleanup and local sign-out also passed. Recovery saving remains gated. See the [account test record](stages-1-7-account-test.md).
