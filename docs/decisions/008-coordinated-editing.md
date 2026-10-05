# 008 — Coordinated existing-box editing

4 October 2026. Extends [decision 007](007-coordinated-creation.md) to ordinary box/item edits. Photo reference changes, NFC reassignment and recovery publication keep their own gates.

Validation checks the draft's structure; it does not persist it. The previous deployment intentionally disabled existing-box Save even though new-box creation had passed live verification. The editor now uses a separate coordinated save capability.

Ordinary saves acquire the same PUBLIC `bsmCreateOwner` root property as creation, using the verified v2 metadata CAS. They register/adopt the sole index, check coherent source snapshots and identities, rescan all authorities, and reject pending operations or stale drafts before publishing anything. UUID, number, creation timestamp, NFC assignments and surviving photo references are protected; removing items retains their photo files.

A generated-ID `box-storage-edit-pending.json` marker records operation UUID, folder/index/inventory IDs and versions plus intended documents. Conditional v2 media PUT updates the inventory, then the derived index while preserving extensions and unrelated entries. Conditional v2 metadata PATCH updates folder name/description. Fresh reads must confirm the inventory, index and folder before the verified owned marker is trashed and root owner is conditionally removed.

Conflicts or uncertain responses never cause blind retries or automatic lock expiry. Failures after marker creation retain that marker and owner for review. Recovery scans report the marker and prohibit publication. This is a coordinated sequence, not a Drive transaction; safe automatic restart recovery remains outstanding. Unrelated external editors can ignore the protocol, so conditional checks and fresh authority scans remain necessary.

The generic Drive write gate stays closed. Photos, NFC reassignment and metadata reconciliation cannot gain mutation access merely because ordinary editing is available. Existing schema and API versions are unchanged.

Live testing found metadata-only version advancement after a completed save while inventory JSON and folder names remained unchanged. Preflight therefore compares the current inventory exactly with the original document, pairs that coherent snapshot with a fresh v2 ETag, and checks folder name/description. It does not silently rebase a draft onto changed contents. A version mismatch between that fresh JSON snapshot and ETag still rejects the operation; CAS protects all later writes.
