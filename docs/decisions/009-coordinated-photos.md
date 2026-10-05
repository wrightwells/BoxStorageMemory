# 009 — Coordinated photo management

4 October 2026. Extends [coordinated editing](008-coordinated-editing.md) to JPEG upload, reference addition/replacement/removal, item removal, owned-file cleanup and explicit recovered-upload association. NFC and rebuilt-index publication retain their own gates.

All photo mutations acquire the same PUBLIC root owner as creation and ordinary editing. Fresh authority scans reject invalid inventory, pending operations and changed source JSON. This excludes compatible clients from adding a reference while another client is cleaning up files. Every client that writes the library must honor the owner; arbitrary external JSON editors can ignore it. The sequence is not a Drive transaction.

Selection remains browser-only. The client prepares JPEG bytes and validates the intended inventory locally and through the stateless API before normal upload. Generated IDs and a durable edit marker record intended photo filenames/IDs before any upload. Each ordinary JPEG receives box/item/operation provenance, descriptive metadata and a UUID filename. Direct Google download must match the prepared bytes before inventory references are published. Images never go to the application backend.

Conditional v2 media PUT publishes the inventory and derived index. Conditional v2 metadata PATCH updates the folder. Replacement/removal retains old files for a separate confirmed cleanup. Cleanup obtains a fresh owner, validates current authority, rechecks each reviewed file's ID/name/version, unique filename, MIME type, provenance, permissions and absence of references, then uses conditional v2 trash. Invalid shared ownership blocks mutation; referenced, ambiguous, changed or unverified files are retained. Permanent deletion is never used.

Confirmed recovered-upload association validates ownership and reviewed metadata under the same lock; it does not upload again or infer a lost replacement intent. A removed item can still use its photo-management route to clean up matching owned files, but association cannot recreate it.

Successful results require fresh authority/metadata checks and verified removal of the owned marker and owner. Partial/ambiguous sequences retain their marker and owner; neither expires or is stolen. Normal retry of a pending coordinated mutation is disabled. Read-only inspection and upload discovery remain available, but automatic interrupted-operation recovery is not implemented. Generated IDs in the marker make uncertain uploads inspectable without blind retries.

The generic Drive write gate remains closed, so NFC/recovery cannot inherit mutation capability from photo management. Inventory/index schema and stateless API versions are unchanged.
