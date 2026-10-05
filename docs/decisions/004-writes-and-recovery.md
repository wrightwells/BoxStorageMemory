# 004 — Concurrent writes and interrupted-operation recovery

Status: Recovery policy accepted. [Decision 007](007-coordinated-creation.md) supersedes the creation/bootstrap primitive gate with live-tested v2 CAS. Existing-box edits, photos, NFC and recovery publication remain gated. Historical candidate details below describe the original proposal.

Drive exposes an output-only increasing file `version`, useful for observing changes. The current `files.update` reference does not document an input expected-version field. This is insufficient to establish atomic compare-and-swap. Sources: [Drive file metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [update method](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update).

A read/version-check followed by an unconditional upload can lose updates if two devices pass the check before either uploads. A local mutex or browser lock cannot coordinate a different device. The executable model in `prototypes/stage1/concurrency.mjs` demonstrates this race, then demonstrates the required behaviour using a simulated atomic primitive. It does not establish Drive support.

## Write gate

The live prototype tests a candidate strong-ETag `If-Match` condition on disposable Drive v3 JSON files. Do not infer support from older Drive versions, another Google API, a response `version`, or generic HTTP documentation. Missing/weak/browser-inaccessible ETag means the experiment fails closed. One accepted writer plus one stale-writer HTTP 412, with the expected final file, is required. Repeat sequential stale writes and concurrent writes from independent sessions for inventory and index documents.

If unsupported, production writes stay disabled until an independently verified alternative or explicit architectural/specification change is adopted. An unconditional fallback is forbidden. A successful local model never unlocks production writes. Root-index bootstrap and duplicate-name handling need live verification too: Drive filename identity alone is not a proven unique-create primitive.

With a verified primitive: load a coherent snapshot (metadata → content → metadata, retry/report if versions differ), retain its validator, validate edits, conditionally write, then refresh. HTTP 412/conflict opens reload/review; it never automatically overwrites with a new validator. Ambiguous network failures require re-reading before retrying and comparing the operation's intended result.

## Creation and number allocation design

After the atomic/index-bootstrap gates close, stage 7 must implement and test this sequence:

1. Re-read a valid root index and inspect valid committed inventories/pending creations for conflicting identities. Duplicate authoritative/index files disable creation until repaired.
2. Generate UUID and operation ID, choose an unused number candidate, and create a disposable pending folder/marker plus a draft inventory under a non-authoritative filename.
3. Claim UUID/number/folder together by a conditional root-index update. A concurrent claimant must lose the precondition race, reload and choose another number; it has no committed inventory or printable label yet.
4. Publish exactly one `inventory.json` for the successful claim, using the verified mutation controls, then reconcile the index and remove the pending marker after verification.
5. Report partial success separately from completion. Keep recovery information in Drive, not a server database. Pending markers are discovered on restart/rebuild and are never auto-committed or deleted.

The proposal deliberately has an incomplete-creation state; these steps are not a multi-file transaction. The marker format, safe bootstrap and claim/publication behaviour must be finalised and exercised in Stage 7 after live primitive verification. Rebuild/creation must not run concurrently until their coordination policy is proven. External edits can introduce duplicates, which are detected and block affected operations rather than silently renumbering records.

Stage 7 local implementation (4 October 2026): [editing instructions](../editing.md) define a candidate operation marker/draft naming format and document the gated workflow. Atomic-simulator tests exercise competing writers/claims, interrupted creation, retained pending state and fresh-authority metadata reconciliation. Production Save/Create/Reconcile remain disabled; metadata publication/rename explicitly lacks a verified primitive. Pending scans block creation/rebuild and never auto-publish or delete. These local checks do not close this decision's live gates or implement safe resumption/cleanup after restart. See [Stage 7 findings](../stage-7-findings.md).

## Recovery rules

| Operation / interruption | Required behaviour |
| --- | --- |
| Folder creation request times out | Re-read by operation marker/known ID before retrying. Do not create a second folder blindly. |
| Pending creation loses number claim | Keep it uncommitted; reload and review/retry with a new number. Cleanup only confirmed app-created pending files. |
| Claim succeeds but inventory publication fails | Mark box incomplete/unavailable; recover from draft/marker and index after confirmation. Do not show a normal empty box. |
| Inventory save succeeds, index refresh fails | Inventory remains authoritative; show that save succeeded but lookup refresh failed. Offer reconciliation/rebuild. |
| Photo upload succeeds, inventory save fails | Uploaded image remains an unreferenced candidate; retry association or offer confirmed cleanup. Never claim it is already associated. |
| Photo replacement/deletion | Upload replacement first; conditionally change inventory references; re-read ownership; trash obsolete image only after references are committed. |
| Item deletion | Confirm associated-image consequences; commit removal first; remove only images known to be owned by the removed item and no longer referenced. Failed cleanup is reported. |
| NFC reassignment between boxes | Require confirmation; remove from old authoritative inventory and reconcile old lookup before adding to the new one. A temporary unassigned tag is preferable to ambiguous automatic lookup. |
| NFC reassignment interrupted | Re-read both inventories and index. Resume only after review; do not infer assignment from a stale index. Any duplicate blocks lookup. Cross-file atomicity is not promised. |
| Index replacement interrupted | Re-read and compare; preserve original/corrupt data for deliberate recovery. Write replacement only after preview/confirmation and concurrency checks. |

Prefer Drive trash over permanent deletion where the authenticated user's permissions allow it. All cleanup requires current references, relevant permissions and an intentional user action. No offline queue or server operation store is introduced.
