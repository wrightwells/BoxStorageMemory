# Existing-box item saving verification

4 October 2026. The previous release enabled creation but left existing-box Save gated. Validation could pass while saving remained unavailable. The fix adds a separate ordinary editing capability and coordinated save service, described in [decision 008](decisions/008-coordinated-editing.md).

## Automated verification

298 frontend tests passed. Seven new existing-box service checks cover item persistence and identity/extension preservation, competing writers, unchanged content with metadata-only version advancement, changed source rejection before publication, partial index failure with retained marker/owner, ambiguous media responses without retries, and refusal of NFC/photo-reference changes.

TypeScript, ESLint, Prettier and the production container build passed. All 12 browser regression workflows passed across Chromium desktop, Firefox and mobile layout. Three expectations were corrected to reflect that Save becomes enabled only when the draft differs from its original. The final deployed primary Chromium workflow passed again.

The backend and API/schema versions are unchanged. The contract handoff distinguishes ordinary editing from general photo/NFC/recovery mutation availability. Browser token handling remains private memory and direct Google traffic.

## Live test scope

Tests use only synthetic boxes in a retained test library. Competing editors add distinct item drafts. Successful writes must remain visible through fresh Drive reads; rejected editors reload before submitting another proposal. Folder/index metadata and owned marker/lock cleanup are checked. The requested Garage Boxes library is inspected to confirm changed drafts offer Save without publishing any test changes to the user box.

An initial live reload revealed metadata-only version advancement while JSON and folder names remained unchanged. The conflict was rejected before publication and the unused owner released. The final service accepts exact original contents with a fresh coherent ETag while continuing to reject changed content and stale conditions.

Interrupted operation recovery remains deliberate: no automatic resume, lock expiry or blind mutation retry. Photo/NFC mutation and rebuilt-index publication remain gated.

## Confirmed final-build live outcomes

Concurrent existing-box saves produced exactly one accepted writer and one explicit conflict. The accepted new item persisted through a fresh Drive read. The rejected editor reloaded accepted contents and successfully saved a further item without losing either addition. Tests use synthetic records; no test edit was published to the user’s Garage Tools box.

All six final-build live checks passed. Inventory, index and folder name/description agreed after a further metadata edit, owned temporary records were cleaned up, and the unrelated box remained indexed. A changed draft in Garage Boxes offered Save while its stored box was left unchanged. All audited update requests used v2 with If-Match; no token-boundary, CSP or page errors occurred. Test sessions signed out and the owned browser was closed afterward.
