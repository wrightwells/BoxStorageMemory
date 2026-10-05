# Photo management verification

4 October 2026. Verification for [decision 009](decisions/009-coordinated-photos.md). The tests use a newly created synthetic box in a retained test library. Account addresses, tokens, private records and Drive IDs are excluded from this distributable evidence.

## Automated results

306 frontend tests passed. Eight new coordinated-photo checks verify ordinary JPEG byte preservation before reference publication, replacement followed by owned-file cleanup, invalid shared ownership rejection, retention of currently referenced files, ambiguous upload handling with predetermined IDs in a durable marker, cleanup racing with reassociation, item deletion with later owned cleanup, and rejection of duplicate filenames appearing after recovered-upload discovery.

After the final normal-upload validation change, all 61 targeted creation/edit/photo service and photo-screen tests passed. TypeScript, ESLint, formatting and container build passed. All 12 deployed browser regression workflows passed across Chromium, Firefox and mobile layout. File/device selection, JPEG preparation, resource release, interrupted-operation behavior and unavailable camera fallback also retain their existing automated coverage.

## Live scope

The deployed app creates a dedicated synthetic photo test box and uses the normal photo-management UI to select a JPEG, review the preview, upload, view, replace, remove references, explicitly recover/associate an owned orphan and delete its test item. Confirmed cleanup must trash only the owned unreferenced originals and replacement. Fresh navigation and final recursive recovery check persistent authority and absence of pending records.

Conditional mutation audits record only endpoint versions and presence of If-Match, never credentials. Images and Google credentials are not sent to the application backend. Live physical camera/orientation, two-account lifecycle and fault injection at every network phase remain separate acceptance work.

## Confirmed live results

The initial JPEG uploaded successfully and its stored bytes were verified before reference publication. It rendered under the deployed CSP and its filename reference survived fresh navigation.

NFC mutation, rebuilt-index publication and automatic interrupted-operation recovery remain gated. Pending coordinated operations retain their durable owner/marker and cannot be blindly retried.

All eight live workflow checks passed: upload/byte verification, viewing and fresh persistence, replacement, confirmed original cleanup, removal and recovered association, item deletion and replacement cleanup, final recursive recovery, and conditional/token/CSP audit. Only the two owned synthetic JPEGs were trashed; no unrelated records or user photographs were altered. The test selector initially chose a dropdown placeholder; continuation preserved the existing upload and prepared replacement rather than repeating an upload. Test sessions signed out afterward. Final duplicate-file hardening passed the full 306-test suite and was deployed after this normal workflow verification.
