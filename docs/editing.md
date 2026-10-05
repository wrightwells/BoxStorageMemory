# Creation and editing drafts

Stage 7 provides `/library/new` and `/box/<boxUuid>/edit`. Choose **Draft a new box** in Library or **Edit box and items** from a box view. A configured shared application registration and selected existing library are required; ordinary users need no Cloud project or payment-card setup.

**New-box creation and empty-library initialization use verified coordinated Drive writes.** Select an empty library, choose **Initialize empty library**, then **Draft a new box**, enter box and item details, validate, and choose **Create box**. A populated library without an index requires recovery review. Existing-box **Save changes** supports ordinary box/item edits through [decision 008](decisions/008-coordinated-editing.md). Photo/NFC mutations and rebuilt-index publication remain disabled. See [creation protocol](decisions/007-coordinated-creation.md).

## Draft controls

Inventory items appear in a table with editable name and quantity columns. Expand **Description, tags, notes and photos** to edit the additional fields or choose **Add photo**. New items start expanded. The table scrolls horizontally on narrow screens.

**Add photo** saves the current box draft before opening that item's photo manager, so new items exist in the saved inventory before photographs are associated. A validation error or incomplete save keeps the editor and draft open. For an unchanged saved item, the action opens its photo manager directly. The photo manager supports selecting files, camera capture, preview and coordinated upload. Returning to the editor loads fresh saved records, including current photo references.

Creating a new box also saves **`box-folder-qr.png`** inside its Google Drive folder. Scanning this image opens `https://drive.google.com/drive/folders/<folderId>` directly. The image is generated from the reserved folder ID and uploaded with a reserved file ID before the index claim. Creation verifies the uploaded bytes and final file metadata before reporting **Save verified**. It is a folder label, separate from item photographs; it never adds an item image reference. Drive permissions still control who can open the folder. Existing app box labels continue to open `/box/<boxUuid>`.

Edit the box name, description, location and tags. Add/edit inventory items with names, nonnegative safe-integer quantities, descriptions, tags and notes. Tags are entered one per line. Box UUID/number/creation time/NFC assignments and existing item UUIDs/photo references are protected. Source JSON extension fields survive edits, including document, box, item and index-entry extensions. New items receive stable UUIDs.

**Delete item** requires confirmation. On a successful save, its inventory entry/photo references will be removed, while all ordinary photo files remain in Drive. This retains shared/unrelated images and avoids unsafe cleanup. Explicit photo management and cleanup are Stage 8 work.

**Validate draft** uses the shared local inventory/index validators and existing stateless API validation endpoints. Validation sends JSON to the application API without Google tokens, credentials or custom authorization headers. The server does not persist it. Invalid drafts show paths/error codes; API failures keep the draft and offer validation retry. Passing validation does not mean a save occurred.

Only one active draft is held in account/library memory. It survives navigation to read-only pages and return to its editor. Opening another editor replaces it after the navigation prompt. Router navigation, browser Back/Forward and page unload have unsaved-change guards; user-initiated account/root changes also ask before discarding a dirty draft. Browser unload prompts remain subject to browser policy. Expiry/revocation clears drafts immediately. No browser storage, offline queue or server operation database holds drafts. A reload loses them; **Review draft JSON** is available before discarding.

Explicit insufficient Drive capabilities make forms read-only. Damaged/newer inventories, inconsistent identity, duplicate files and missing indexes block loading/creation. **Reload current records** asks before discarding a dirty draft and obtains fresh snapshots. Failed or uncertain operations retain the intended draft, lock editing/replay when side effects may exist, and display their result for review.

## Existing-box save workflow

Change box/item fields, add items and enter their quantities/details, then choose **Save changes**. Validation alone does not save. After a completed save, **Reload current records** opens a fresh draft for further changes.

An edit validates both documents, checks the root/index/inventory/folder context, then performs a conditional inventory update, verifies it, conditionally updates derived index metadata, verifies it, and conditionally renames the folder when needed. Folder names use the permanent number plus descriptive name. Unknown fields and unrelated index entries are preserved. Saves use the coordinated v2 service and the same durable root owner as creation. A Drive edit marker retains the intended documents if a sequence is interrupted. Generic adapter writes remain closed for photo/NFC/recovery operations. Version prechecks alone do not make a write atomic.

An inventory save can succeed before its index/folder update fails. The result records confirmed versus uncertain steps, the last phase, error, UUID/number and any known folder/file IDs. **Save verified** appears only after the expected steps finish. No ambiguous request is retried automatically. A conflict requires reload/review, rather than silently applying the old draft to a new validator.

**Review current Drive state** re-reads the known folder, index and published inventory while retaining the intended draft. A valid, matching, non-pending inventory can supply an explicit metadata-reconciliation proposal. **Reconcile reviewed metadata** requires confirmation, revalidates the index with the API, and conditionally updates index/folder metadata from that fresh authoritative inventory. It does not replay the failed draft or overwrite the current inventory. Concurrent changes invalidate the proposal. Reviewed metadata reconciliation remains disabled by the generic write gate.

## Creation proposal and pending records

Creation requires a consistent existing valid index and a complete scan without unresolved pending records. The proposed next number is the maximum retained index number plus one; it is not reserved by opening the form. The client generates a box UUID and operation UUID. No folder/marker is created while preparing or validating a draft.

The live creation service performs this coordinated sequence:

1. Register/adopt a unique index ID, acquire the root operation owner using v2 metadata CAS, then recheck the index, committed inventories, permissions, duplicates and pending creations.
2. Create a pending folder named `.box-storage-pending-<operationUuid>` with operation provenance in Drive metadata.
3. Create `box-storage-pending.json` and validated `inventory.pending.json` under that folder.
4. Conditionally claim the UUID/number/folder together in the root index. Only one simultaneous claimant may succeed. A rejected preflight creates no folder; after reload it receives a fresh proposal. An interrupted claimant retains pending records and cannot publish a committed box label.
5. Conditionally publish the draft as exactly one `inventory.json`, verify its content, rename the folder, then trash only the verified owned marker. Verify all committed records, conditionally remove the root owner, and verify removal before reporting success.

The candidate marker is a separate internal recovery record, not an inventory/index schema change:

```json
{
  "formatVersion": 1,
  "operationId": "<operationUuid>",
  "boxId": "<boxUuid>",
  "boxNumber": "BOX-0003",
  "folderId": "<pendingDriveFolderId>",
  "indexId": "<rootIndexFileId>",
  "inventoryId": "<generatedInventoryFileId>",
  "protocol": "drive-v2-cas-1"
}
```

These operations are not a multi-file transaction. A timeout creating a folder may leave an unknown ID; locate the operation UUID in Drive before attempting anything else. A claimed but unpublished box is unavailable, not an empty box. Recovery scans report pending folder names, markers and draft inventories, retain unavailable claimed index entries, and block creation/rebuild. They never auto-publish or delete pending records. Automatic safe resumption/cleanup after restart remains unimplemented. The durable root owner never expires or gets stolen. Preserve the reported IDs and pending files for deliberate review. Normal creation uses the live-tested protocol in decision 007.

## Live acceptance gates

Configure the operator's web OAuth client and test origin using [Google setup](google-setup.md#stage-5-application-setup-and-live-checks). Run the [Stage 1 concurrency probes](google-setup.md#concurrency-checks) and record credential-free observations. Do not unlock production code from a successful mock or a read/version-check experiment.

- Prove atomic JSON inventory/index replacement in independent browser sessions: stale writes must fail, with final contents preserving the accepted writer.
- Independently prove conditional metadata publication/renaming and identity-safe marker cleanup. The production `renameFile` method explicitly refuses an unverified metadata primitive even beyond the main gate.
- Prove index bootstrap uniqueness and coordination between creation, recovery and allocation. Empty-library bootstrap is verified; populated-library recovery publication remains disabled.
- Repeat simultaneous same-box edits, different-box index races and number claims. Reject duplicate identifiers/numbers; reconcile successful inventories without losing the other client's index entries.
- Inject permission loss, request timeouts and interruptions at each creation/edit phase. Verify durable marker/draft/claim state, no blind retries, truthful outcomes, and deliberate pending-operation recovery after restart.
- Verify real unknown-field preservation, ordinary Drive persistence, external edits, account/root isolation, browser navigation/unload behaviour and photo-retention disclosure.

Stage 7 is fully accepted only after these prerequisites and pending-operation recovery pass. Current local evidence is recorded in [Stage 7 findings](stage-7-findings.md).
