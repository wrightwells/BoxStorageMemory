# Release acceptance and handoff — 1.0.0 candidate

Date: 4 October 2026. Stages 10–12 local deliverables are implemented. **Writable production release acceptance is not achieved.** Drive v3 stale conditions were ignored in subsequent live probes. Verified v2 ETags/CAS and generated IDs now enable coordinated new-box creation and empty-library bootstrap. Ordinary box/item saving now uses decision 008; index replacement and NFC writes retain separate gates; coordinated photo operations and owned cleanup use decision 009. The handoff publishes compatible read/validation contracts and explicitly records remaining limits rather than treating simulator behavior as a live guarantee.

## Executed evidence

- Frontend unit/component checks cover matching, drafts, photos, QR decoding/validation, camera cancellation, tag serial normalization, authority-based lookup, registration/replacement/removal, confirmed reassignment, duplicates, partial saves and account/root fences. Build-time browser validators match all 47 structural/domain fixture cases.
- Python checks cover schemas/domain rules, public API/QR decoding, credentials/body/rate limits, CORS, sanitized logs and security headers on successes/errors/preflight. Optional API docs use a matching initialization-script hash; production docs remain disabled.
- Twelve browser workflows pass across actual headless Google Chrome desktop, Playwright Firefox and Chrome with Pixel 7 layout emulation: connection/root setup, manual number lookup, search/item detail, disabled production editor, ordinary JPEG blob viewing, QR generation, recovery preview, external-edit refresh, sign-out/revocation, invalid-label rejection, QR login return, unknown boxes, camera-denial fallback, responsive layout and keyboard skip-link/focus. Google responses and permission denial are **synthetic**; policies and compiled frontend/API are real. No CSP violations or unhandled page exceptions were found in the principal workflow. Browser records/drafts and tokens did not enter local/session storage.
- Ten live-account workflow checkpoints passed on the updated localhost deployment with user-completed Google sign-in: manual lookup, real Drive JPEG rendering/close, search-to-editor and API draft validation, gated Save, QR generation/regeneration and strict URL routing, NFC metadata viewing, recursive recovery, root change and sign-out. No Google mutations, non-Google authorization, CSP violations or unhandled page errors were observed. Browser persistence held only the account-scoped root ID preference; session storage was empty. This closes the earlier editor UI interruption for this workflow. Real expiry/revocation, a second account and physical devices remain pending.
- Shared contract/prototype assertions, OpenAPI freshness, lint/format/type/build and updated documentation links are checked. Running OpenAPI is compared with the versioned export in container CI.
- A separately built application image was exercised as UID/GID 10001 with read-only filesystem, temporary /tmp, dropped capabilities and no-new-privileges. Health, compiled deep routes/assets, token-free contracts and running OpenAPI passed. A separate Caddy proxy served the app over HTTPS with a development CA certificate **verified against its root**, including HSTS and final route policies. Synthetic private body/query sentinels were absent from combined application/proxy logs. Test containers/network were removed. The existing localhost service was subsequently updated to the current image with its earlier image retained for rollback; see the [deployment/full-test record](deployment-test-2026-10-04.md).
- A synthetic backup/restore fixture changes Drive IDs, preserves UUID/number/NFC/photo filenames, previews a rebuilt index and reads the restored authority through the derived replacement. This is local recovery evidence, not a completed Google Drive backup/restore or live gated index replacement.
- The reproducible contract ZIP contains versioned schemas/OpenAPI, hash manifest, synthetic fixtures/examples, shared conventions, smoke tools and integration guidance. No native application or real account records are packaged.

## Criterion disposition

| Criterion | Evidence and limit |
| --- | --- |
| AC-01 clean deployment/account/isolation | Isolated container/HTTPS and browser setup; single-account live workflows on the updated deployment. Two real accounts under final policies remain pending; mocked account/root generation tests reject late data. |
| AC-02 no persisted credentials | API credential rejection, sanitized-log tests/container sentinels, browser storage checks, non-root read-only runtime and direct client Google requests. Audited live single-account utility/Drive calls and post-sign-out storage passed; real expiry/revocation and a second account remain pending. |
| AC-03 permanent box/folder/inventory | v1 identity fixtures, creation/concurrent-claim simulator and pending-marker recovery. Independent signed-in sessions initialized one index, raced BOX-0001 with exactly one winner, then reloaded and created BOX-0002. Fresh reads/recovery confirmed two committed identities; The requested library also persisted Garage Tools and item details. See [creation evidence](live-box-creation-test.md). |
| AC-04 item add/edit/delete | Draft/validation/save/conflict/reconciliation simulator coverage with identity/unknown-field preservation. Ordinary box/item saving is enabled through decision 008; live item persistence and concurrent-writer rejection passed. See [item save verification](live-item-save-test.md). |
| AC-05 ordinary photos | Earlier live JPEG viewing, browser authenticated JPEG blob display under CSP, processing/upload/reference/cleanup/restart simulator tests. Coordinated photo mutations and owned cleanup are now delivered through decision 009. Eight live workflow checks passed; concurrent cleanup/reassociation is covered by the shared live-tested owner and independent emulator races. See [photo evidence](live-photo-management-test.md). |
| AC-06 QR opens authorized UUID | Actual API QR pixel decode, strict malformed/unrelated URL vectors, browser deep link/login/root/unknown-box checks. Real Google connection and canonical QR-to-box routing passed on the updated deployment; physical camera reading and another live before-login QR session remain pending. |
| AC-07 native Android NFC | Native application excluded; released UID/byte-order/mapping/API fixtures and integration guide are provided. Native hardware implementation/acceptance is external-project work. |
| AC-08 replace label/tag preserves identity | Label regeneration performs no Drive write; tag registration/replacement/removal/reassignment simulator retains UUID/number/folder and reports partial steps. Live tag writes and physical cross-reader byte order remain pending. |
| AC-09 item search identifies containing box | Description/notes/tags/number matching, progressive/inaccessible states, item links/focused editing, save invalidation and browser external refresh. Ready scope is indexed boxes; unindexed folders use recovery. |
| AC-10 independent Drive discovery | Ordinary folder/photo names and derived description tests; earlier direct Drive viewing. Native Drive search/indexing and live description publication have not been observed and remain pending. |
| AC-11 independent user/deployment | Environment-based setup, operator/public-ID separation, HTTPS proxy/runbook and local replacement/restore fixtures. A new operator's public certificate/domain/Google registration and live Drive restore must still be exercised. |
| AC-12 honest network/save failures | Fault-injected grants, pagination/rate limits, permissions, missing/corrupt/newer records, late responses, CAS races and interrupted/ambiguous saves. UI preserves drafts/orphans, names partial phases and disables unverified production writes. Live independent concurrent writers remain a release blocker. |

## Browser/device matrix

| Environment | Result |
| --- | --- |
| Google Chrome desktop/Linux | Compiled browser workflows passed with synthetic Google responses and enforced policies. |
| Firefox (Playwright Firefox 155) | Same workflows passed; optional NFC unavailable fallback works. |
| Chrome mobile layout emulation | Same responsive/touch-layout workflows passed. This is not a physical Android Chrome run. |
| Microsoft Edge | Not executed: no Edge binary supplied. The test configuration accepts BSM_EDGE_PATH for a real installation; run the same suite before claiming Edge acceptance. |
| Physical Chrome Android/browser camera | Not available in this environment; real scanning, photo orientation/capture and permission UX remain device checks. |
| NFC serial/reference tags | Not available; simulated NDEFReader serial/error/abort checks passed. Compare actual ordered UID bytes with the separate native reader before interoperability claims. |

## Repeatable verification

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check:web-validators
npm run test:contracts
npm run test:prototypes
npm run lint
npm run format:check
npm run typecheck
npm run test:frontend
npm run build
.venv/bin/ruff check backend
.venv/bin/ruff format --check backend
.venv/bin/mypy
.venv/bin/pytest
.venv/bin/python tools/export_openapi.py --check
python3 tools/release_contracts.py --check --output /tmp/box-storage-contracts-1.0.0.zip
npx playwright install chromium firefox
npm run test:browser
```

The browser suite starts/stops an isolated native server on loopback port 18123 and uses synthetic account/library fixtures. Set `BSM_CHROME_PATH` for a system Chrome, `BSM_EDGE_PATH` for optional Edge, or `BSM_BASE_URL` for an explicitly prepared test deployment. Default CI downloads Chromium/Firefox. Artifacts/traces/video are disabled by default; failure context contains synthetic data only. See [deployment runbook](deployment.md) for compiled/container HTTP and HTTPS checks and [client integration](client-integration.md) for the stdlib-only independent-client smoke commands.

## Remaining live release checks

Use a disposable library and two consenting accounts on a real HTTPS deployment. Verify actual GIS consent/revoke/expiry/root switches and no credentials/records in service logs/storage under final policies. Exercise valid and invalid printed QR labels before/after login, physical camera denial/capture/orientation and supported tag serial/UID order. Validate a Drive backup/restore and replacement deployment using the same identity conventions. Observe native Drive name/description/content-search behavior and update timing. Single-account sign-in, read/draft/search/QR/recovery/root-change/sign-out already passed on the updated localhost deployment; the remaining lifecycle and second-account checks still need evidence.

Initialization and new-box creation use the exact live-tested protocol in decision 007. Keep other mutations disabled until their multi-file recovery/tag coordination and cleanup exclusion pass independent-client stale/racing writers. Then exercise create/label, item/photo add/edit/delete/reload, search-to-edit, tag reassignment and index replacement end to end. No unconditional fallback is permitted. These are explicit release limitations, not tests marked passed or a request to bypass the gates.

Initial release automated verification: 277 frontend tests and 114 Python tests (116 contract subtests) passed, plus 12 browser workflows. ESLint/Prettier, TypeScript, Ruff/format, mypy, contract/prototype checks, generated-validator freshness, OpenAPI export and contract-archive checks passed. Existing Starlette/httpx deprecation and Vite main-chunk warnings remain; the main bundle is approximately 600 kB minified/175 kB gzip, with a separate lazily loaded QR decoder.

## Coordinated creation verification

291 frontend tests and 114 Python tests (116 contract subtests) passed, including 14 new tests of the real creation service against an independent conditional Drive emulator. Final transport/UI changes passed 59 targeted tests, type checks and lint. Deployed browser regressions passed all 12 workflows: one Firefox case timed out under concurrent load and passed in an isolated rerun. Five live independent-client media races each yielded one success and one stale-write rejection. Root registration, duplicate fixed-ID creation and explicit property removal were also verified. Normal app creation/reload checks are recorded in [creation evidence](live-box-creation-test.md). Full existing-box editing/photo/NFC and interrupted-operation recovery acceptance remains outstanding.

## Existing-box save follow-up

298 frontend tests passed, including seven checks of coordinated existing-box editing. Ordinary item additions now persist using a shared root owner and fresh conditional v2 writes. Exact original JSON is verified before accepting metadata-only version changes; changed contents remain conflicts. All 12 browser regressions passed, with a final deployed Chromium recheck. See [item save verification](live-item-save-test.md) for live evidence and retained recovery limits.

## Photo management follow-up

306 frontend tests and 12 deployed browser workflows passed. Eight live photo workflow checks verified upload/byte preservation, viewing/reload, replacement, reference removal, explicit recovered association, item deletion and confirmed owned cleanup. Final recovery found no pending, duplicate or unavailable records. NFC, index recovery publication, automatic interrupted-operation recovery and physical camera/device acceptance remain outstanding.
