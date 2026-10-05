# 003 — Permanent identities and recoverable records

Status: Accepted v1 contract. Supplements technical §§12–20, 57, 73 to fulfil functional §§4, 7, 11 and 18.

Every committed box has both an immutable UUID (`box.id`) and immutable human number (`box.number`, for example `BOX-0001`). UUIDs identify routes and joins; numbers identify the physical box to people. Both are unique within a selected library. Item UUIDs are unique within their box. New UUIDs use UUID v4; the contract accepts canonical UUID versions 1–8 for interoperability.

Human input is normalised to uppercase `BOX-` plus an integer of at least four digits. Stored numbers are canonical and nonzero; numbering is not globally unique across Google accounts or independent roots. A suggested sequential number is only a candidate until a verified atomic library claim succeeds. Never print a label for a tentative/failed creation.

Each box folder is named with its number and meaningful name, such as `BOX-0001 Electrical Box`, but its Drive folder ID is the lookup identity. Rename/move within the selected root does not change UUID/number. A move out of the root makes the record unavailable to that library; importing it elsewhere must check for duplicates.

## Authority and derived data

| Data | Authority |
| --- | --- |
| UUID, number, name, location, timestamps, tags and items | Box folder's `inventory.json` |
| Active NFC IDs | `inventory.json` → `box.nfcIds` |
| Photographs | Ordinary image files beside `inventory.json`, associated by filenames in item `images` |
| UUID/number/NFC/folder lookup | Root `box-storage-index.json`, derived from box inventories and Drive folder IDs |
| Search, thumbnails and runtime versions | Temporary client state |
| Interrupted-operation markers | Temporary Drive recovery information, never a second inventory authority |

NFC associations must be in inventories so losing/rebuilding the root index does not lose tag assignments. Multiple NFC IDs may belong to one box; one active UID cannot belong to two boxes in a root. The index contains copies for fast resolution. Duplicate mappings found on refresh/rebuild are reported as ambiguous and cannot open an arbitrary box.

Rebuilding recursively discovers exact `inventory.json` files, validates records, preserves inventory authority and identifies duplicate UUIDs/numbers/tags, corrupt files, missing images and pending operations. It never silently assigns new permanent numbers or discards conflicts. Preview and confirm a replacement index, then use the verified write policy. Duplicate files with the authoritative name are errors, not "take the first" cases.

An item's required nonblank `name` is its minimum meaningful description for FR-INV-005; optional `description` and `notes` provide more detail. A zero quantity is allowed for a recorded item; negative/fractional quantities are not. Every image filename belongs to one item within a box. External files not referenced by inventory are not automatically deleted.

The v1 examples add required number and NFC fields absent from the original technical examples. Those examples are not deployed legacy data. Existing files missing these fields are invalid for writes; a future explicit import/upgrade tool must assign/check numbers with user review, not infer silently from folder names.

See [contracts](../contracts.md) for exact constraints, error semantics and version preservation.
