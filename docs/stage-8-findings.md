# Stage 8 verification

Date: 4 October 2026. Local photograph controls, processing and gated mutation/recovery services are delivered. **Production Stage 8 acceptance remains blocked** by Stage 1/7 live concurrency gates and coordination between reference writers and cleanup. The original Stage 8 run used no real Google account or device camera; later single-account photo-viewing evidence is linked below. Production upload/reference/trash operations remain disabled.

Delivered:

- File batches, device capture input and explicit video-only camera start/close/capture controls with permission-denial fallback.
- JPEG conversion/previews, optional aspect-preserving 2560-pixel resizing, white transparency background, source/batch/decoded-pixel limits and bitmap/canvas/object-URL cleanup.
- Descriptive box-number/item-name/item-UUID/photo-UUID filenames, ordinary images beside inventory, operation/box/item ownership properties and filename-only references. Stable item/box identity and unknown fields survive mutations.
- Add/view/replace/reference-removal and confirmed item removal with disclosed separate file cleanup. Missing image files do not block removal of stale references.
- Upload-before-reference and reference-removal-before-trash orchestration. Fresh-reference, file identity/version, ownership and permission checks retain unrelated, changed or unverified files. Invalid shared ownership stops mutations rather than deleting data.
- Precise partial results, retained uploaded candidates, explicit reference-only retry, lost-save recognition and reviewed trash retry. Unknown lost-upload IDs remain locked for deliberate inspection; uploads are never blindly replayed.
- Navigation/unload prompts and clearing of selections, camera streams and late responses on context changes. The box editor remains a deliberate retain-all-files deletion path.
- Updated usage/development/plan documentation and compiled deep-route smoke coverage.

Executed verification:

- 162 frontend tests passed in the full suite. Two further service checks were added; the final 22-test photograph service suite passed, bringing verified coverage to 164 tests. Coverage includes independent-client races, permission guards, publication/cleanup order, missing/invalid/shared files, validation failure, stale inventory, lost upload/save/trash responses and context changes. UI checks cover previews, denied camera access, disabled production writes, navigation/unload guards and sign-out resource release.
- Frontend ESLint, Prettier, TypeScript and production build passed. Vite retains its nonfatal main-chunk warning (approximately 551 kB minified, 166 kB gzip).
- All 105 Python tests passed, with the existing Starlette/httpx transport deprecation warning. Restricted test-transport socket access required running these checks outside the sandbox.
- Shared Python/TypeScript contract fixture parity, Stage 1 prototype assertions and OpenAPI freshness passed.
- A temporary native compiled deployment passed frontend assets, photograph deep-route, health/error and all public API HTTP smoke checks; the temporary server was stopped afterward. No existing deployment was changed.
- Updated local documentation links passed. No container rebuild was needed for a dependency-free frontend change; container verification remains in CI. No schema/API/dependency release changed, and no backend image proxy or inventory persistence was added.

Remaining acceptance: real Google add/view/replace/delete/reload, atomic two-client writes, cleanup exclusion against concurrent re-reference, device orientation/camera behaviour and recovery across page restart. Read-only owned-upload discovery and explicit confirmed association/cleanup now work after restart; automatic resumption is not implemented. Review details remain volatile and upload ownership metadata stays in Drive. A reference pre-read alone does not prove safe live trash. See [photo instructions](photos.md) and [write/recovery decision](decisions/004-writes-and-recovery.md).


## Recovery follow-up — 4 October 2026

Read-only owned-upload scans, explicit recovered-file association/cleanup and deleted-item cleanup review are now implemented. Scans verify operation/photo UUIDs, box/item ownership, JPEG names/versions, unique filenames and current references. A recovered action rechecks reviewed identity/version/reference state before using the existing gated mutation path. Changed, referenced, duplicate, unrelated or unverifiable files are retained. Confirmed abandonment of an in-memory operation releases its previews without undoing Drive changes. No upload or failed operation is automatically replayed.

The requested account's live Stage 1–7 tests have since verified Drive image viewing and session/root cleanup, but found no strong browser-visible inventory/index ETags. See the [account test record](stages-1-7-account-test.md). These observations do not unlock Stage 8 writes. Google's [files.update reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) does not establish the missing executed conditional-write evidence; label `WriteControl` is a separate API and cannot be substituted for inventory concurrency.

Production add/replace/delete/reload acceptance remains incomplete until a verified cross-client write/cleanup strategy is adopted and exercised. No production gate bypass or architecture/schema change was introduced.

Recovery follow-up verification: the full suite passed 170 tests after six new service cases; the final photograph-service/UI rerun passed 32 tests after one additional UI case and confirmed preview-discard cleanup, bringing verified frontend coverage to 171 tests. ESLint, Prettier, TypeScript and build passed. No backend, schema, API or dependency changes were needed. The main bundle remains above Vite's 500 kB warning threshold.

A possible future experiment is Drive v2's [File.etag metadata field](https://developers.google.com/workspace/drive/api/reference/rest/v2/files). This is not proof of conditional update support, not a validator for a different endpoint, and not an enabled fallback. A future candidate must be tested on its own exact browser-visible read/write endpoints, with independent stale writers and cleanup coordination, before changing the production adapter.

## Coordinated photo delivery follow-up

The deployed workflow now supports photo uploads, reference changes, item deletion, confirmed owned cleanup and explicit recovered associations through [decision 009](decisions/009-coordinated-photos.md). 306 frontend tests, 12 browser workflows and eight live photo checks passed. See [photo evidence](live-photo-management-test.md). Pending operations retain durable markers and the shared owner; automatic resume and hardware/orientation acceptance remain outstanding.
