# Stages 1–7 account test record

Date: 4 October 2026. Requested account: `boxstoragememory@gmail.com`.
Deployment: `http://localhost:8080`, existing Compose application.
Browser: Google Chrome 148.0.7778.215, separate temporary test profile.

## Executed checks

| Stage | Executed evidence | Result |
| --- | --- | --- |
| 1 | 11 prototype tests: token destination, lifecycle/context fences, fail-closed writes, simulated stale writes/index races/number allocation | Passed locally; live inventory metadata/media expose no strong ETag, so the candidate write gate stays open |
| 2 | 112 contract tests, including 110 fixture cases, unknown-field round trips and independent Python/TypeScript parity | Passed |
| 3 | Backend/frontend checks and compiled HTTP routing/assets/errors; running container UID 10001, read-only filesystem and health | Passed |
| 4 | Backend API integration tests, OpenAPI freshness and all public HTTP utility smoke checks | Passed |
| 5 | Automated authentication/account/root/permission/token-boundary checks; real browser loaded login and GIS script, enabled sign-in | Passed: requested account verified, account lookup/listing and disposable-root creation/selection succeeded |
| 6 | Automated library/deep-link/photo/recovery checks | Live nested library/manual lookup/item/photo/recovery subset passed; remaining error/context cases pending |
| 7 | Automated drafts/validation/conflicts/partial operations/creation races | Live draft services/API validation and creation proposal passed; editor screen test interrupted; real saves remain gated |

The complete frontend suite passed **164 tests** (includes Stage 8 regression coverage).
Python suite passed **105 tests**. Ruff lint/format, strict mypy, ESLint, Prettier,
TypeScript/build, contract parity, prototype tests, OpenAPI freshness and HTTP
smoke checks passed. Existing warnings: Starlette/httpx transport deprecation and
Vite main bundle over 500 kB. No existing deployment was changed.

## Live-account status

The user completed Google sign-in/consent in the separate Chrome window. The
application verified `boxstoragememory@gmail.com`, and real browser requests to
Drive `about` and `files.list` succeeded. The credential-free audit observed
Google-origin requests with authorization headers present; no token/header value
was collected. Before sign-in local/session storage were empty. Post-login storage
and the complete API/network boundary inspection remain pending.

A disposable root was created through the application and selected successfully:

- Name: `Box Storage Stages 1-7 Test 2026-10-04T13:50:17.189Z` (UTC timestamp in folder name).
- Drive root ID: `15E9_hyXWT-1VtZ_bKnEoyuJJAgg890J2`.
- [Inspect the synthetic test folder](https://drive.google.com/drive/folders/15E9_hyXWT-1VtZ_bKnEoyuJJAgg890J2).

Only synthetic fixtures were installed in this new root: a nested Garage/BOX-0001
folder with an inventory and generated 320×160 JPEG, an empty BOX-0002 folder with
an inventory, and a root index. Seven child folders/files were created. Fixture
installation used browser-local direct Drive requests, with the token remaining
inside the app's private authentication object. It did not enable or invoke the
production Save/Create/Reconcile services. Fixtures include unknown extension
fields and authoritative NFC metadata. No existing Drive files were changed or
trashed; the disposable folder is retained for inspection.

Executed live observations:

- New empty root reports `INDEX_MISSING`; recovery preview is available without writing an index.
- Seeded root index reads two boxes; the nested inventory matches its UUID/number and preserves extension fields.
- Recovery discovers both inventories and preserves the authoritative BOX-0001 number/NFC association.
- Manual `box-1` lookup opens the permanent BOX-0001 UUID route; its item deep link loads.
- Synthetic image downloads directly from Drive and renders at 320×160; closing removes the rendered object URL.
- Inventory metadata and media responses provide **no strong browser-visible ETag**. No conditional or unconditional inventory write was attempted by the probe. Index/metadata atomicity and independent-session races remain untested.
- Opening **Edit box and items** reached the editor route, after which the first tab stopped responding to renderer/debug commands. The tab was closed before a pending evaluation could resume. A fresh tab reconnected successfully and restored the same account's selected root.
- In the fresh browser session, live draft-service edits and a BOX-0003 creation proposal validated both locally and through the API. Item identity and unknown extension fields survived; the inventory version/content stayed unchanged. Production write availability remained false. These service checks do not substitute for full editor/navigation UI acceptance.
- Direct external edits of this run's synthetic data renamed/moved the BOX-0001 folder within the root and changed inventory metadata. Refresh preserved identity and reported `INVENTORY_CHANGED`/`INDEX_STALE`; recovery reflected fresh authoritative metadata/NFC without changing the inventory version.
- A deliberately missing image reference produced `IMAGE_NOT_FOUND`. A synthetic newer schema produced `UNSUPPORTED_SCHEMA`; deliberately corrupt JSON produced `INVALID_JSON`. Temporary missing/newer/corrupt content was restored after the tests.
- Root change cleared library state and revoked a loaded photograph's object URL. Root reselection succeeded. Local sign-out cleared account/root/draft/library state.
- Four audited stateless API validation requests had no authorization header. No audited request to a non-Google origin had an authorization header. Browser storage held only one `box-storage:root:<accountId>` preference, and session storage was empty.

The synthetic BOX-0001 folder remains renamed/moved inside the root, and its
inventory contains the successful external metadata change. Its derived index
intentionally remains stale: the app correctly reports it, and production
reconciliation is gated. Temporary invalid inventory content was restored. No
fixture or unrelated file was trashed/deleted. The app was signed out at the end.

The first-tab stall remains an unresolved browser/UI test interruption, not an
established application bug. Fresh-tab reconnection recovered live service tests;
full editor UI/navigation acceptance still needs a reproducible follow-up.

Stage 1 live conditional inventory/index/metadata writes and safe bootstrap remain
open. Stage 7 production Save/Create/Reconcile are intentionally disabled. One
account alone cannot establish two-account isolation; a second ordinary test
account is still required for that acceptance criterion. Browser/device matrix,
real token expiry and external revocation also require separate live evidence.

See [Google live procedures](google-setup.md), [library checklist](library.md) and
[Stage 7 gates](editing.md#live-acceptance-gates). Remaining live checks need additional acceptance sessions and a verified write strategy.
