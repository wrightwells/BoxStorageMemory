# Live coordinated creation acceptance

4 October 2026. Credential-free evidence for the creation-only protocol in [decision 007](decisions/007-coordinated-creation.md). The tests used synthetic records in disposable Drive folders and a user-requested empty library. Account addresses, personal records, tokens and Drive IDs are excluded from this distributable document.

## Primitive verification

- v3 media and metadata PATCH accepted stale conditions; these transports are rejected for CAS.
- v2 media PUT and metadata PATCH accepted a fresh ETag and rejected its stale reuse with HTTP 412, preserving the accepted content.
- Five races between independently authorized clients each produced exactly one successful media write and one HTTP 412; both sessions won at least once.
- Root property registration yielded one HTTP 200 and one HTTP 412; v3 reads reflected the winning PUBLIC property.
- Sequential and simultaneous create requests with the same generated ID yielded one successful file and HTTP 409 for the duplicate.
- Explicit null property removal cleared the creation owner. Omitting a property from the PATCH did not clear it.

## Deployed application verification

Two independently authorized app sessions selected one newly created test root. Concurrent **Initialize empty library** actions returned one valid shared index. Each session prepared a distinct UUID with proposal BOX-0001 and validated its item details through the local validators and stateless API. Concurrent **Create box** actions produced exactly one **Save verified** and one explicit rejection.

The rejected session used **Reload current records**, received BOX-0002, validated a new draft and completed creation. Refresh and recursive recovery found two valid inventories in three folders, with no duplicate or unavailable records. Confirmed outcomes required index claim, inventory publication, folder metadata, owned marker trash and verified owner removal.

The requested empty library was then initialized through the normal app UI. It received BOX-0001, named Garage Tools, location Garage Boxes, description “Created by the verified live box creation test.” Its inventory contains a 10 mm socket with quantity 2. Manual number lookup, fresh box reads and an editor reload preserved the same UUID, name, location and item details.

All seven live app checks passed. Twenty-one audited v2 PUT/PATCH requests carried `If-Match`; none used v3 for conditional mutations. No non-Google authorization, CSP violations or unhandled page errors were observed. Both app sessions and the original probe session signed out; the owned diagnostic browser was closed to clear private tokens. A test navigation timing issue was corrected before selecting the requested library; creation was not replayed or duplicated.

## Automated evidence and limits

291 frontend tests passed, including 14 new creation-service checks against an independent Drive emulator. Final transport/UI changes passed 59 relevant tests. 114 Python tests and 116 contract subtests passed, with the existing Starlette/httpx deprecation warning. TypeScript, lint, formatting, contract archive reproducibility and production container build passed. The final deployed main browser workflow passed again after the small transport/UI cleanup. Both localhost and the configured host IP returned healthy responses. All 12 deployed browser regression workflows passed; one Firefox workflow timed out under concurrent test load and passed an isolated rerun.

The new service tests cover racing initialization/creation, invalid and populated roots, weak validators, extensions, stale proposals, retained partial state, ambiguous responses, generation changes, owned-lock release and rejected initial photo references. Fault cases remain emulator evidence; live normal creation and stale/racing primitives do not prove automatic interrupted-operation recovery.

Existing-box editing, photo/NFC mutations and recovery index publication remain gated. No unrelated Drive records were modified; synthetic test records are retained for inspection. Browser audits record only endpoint versions and presence of conditions, never token/header values.

## Drive folder QR extension — 5 October 2026

New box creation saves `box-folder-qr.png` in the new folder. Six live checks passed in a fresh disposable library: completed coordinated creation; independent decoding of the actual Drive PNG to the exact Google folder URL; fresh box/item reads; exclusion from item photo references and owned-photo recovery; recursive review with no pending/duplicate records; and verified v2 conditions with no credential boundary, CSP or unhandled page errors. The saved PNG was 360 × 360 pixels.

Live testing exposed asynchronous Drive post-processing: upload-response versions can advance while file contents remain unchanged. Creation now obtains fresh exact inventory JSON before conditional publication and checks PNG bytes using a download bracketed by matching fresh metadata versions. Changed content and changes during a read still fail. Regression tests cover both unchanged version advancement and corrupt or unstable reads.

An earlier completed synthetic operation failed the original strict PNG-version comparison; its published inventory/index/folder and independently decoded QR were reviewed before conditionally releasing its owned claim. A separate interrupted test library was moved to recoverable Drive trash after verifying every contained ID and its owner. These are test cleanup actions, not an automatic resume implementation. Final live creation completed through the normal app UI without manual publication or owner removal.

314 frontend tests, 123 backend/contract tests and 116 contract subtests passed. All 12 deployed desktop/mobile browser regressions passed. TypeScript, ESLint, Ruff, mypy, formatting, OpenAPI export checks and the production build passed. The deployment is healthy on localhost and the configured host IP. Live evidence contains synthetic data only; no tokens or account-specific IDs are distributed in the contract archive.
