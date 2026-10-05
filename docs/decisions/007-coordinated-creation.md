# 007 — Verified coordinated box creation

4 October 2026. Accepted for new-box creation; ordinary existing-box saves are extended by decision 008; photo mutations, NFC reassignment and recovery index replacement retain their separate gates.

## Observed Drive behavior

Independent browser authorizations tested disposable files. Drive v3 media and metadata PATCH accepted stale `If-Match` conditions and overwrote the accepted result. These endpoints must not implement compare-and-swap.

Drive v2 metadata returns a strong `etag` in its JSON body. The exact v2 media PUT and metadata PATCH endpoints rejected previously valid stale ETags with HTTP 412 and preserved the winning content. Five independent-client media races each produced one HTTP 200 and one HTTP 412. Root-property registration also produced one winner. Generated file IDs yielded one successful creation and HTTP 409 for duplicate or simultaneous requests using the same ID.

These are observations from live tests, not an inference that all Drive endpoints honor the condition. The official references describe [v2 file metadata including ETag and properties](https://developers.google.com/workspace/drive/api/reference/rest/v2/files), [generated IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds), and [file creation](https://developers.google.com/workspace/drive/api/guides/create-file).

## Protocol `drive-v2-cas-1`

Three PUBLIC properties on the selected root coordinate compatible clients:

- `bsmIndexId`: the canonical derived index file ID.
- `bsmCreateProtocol`: `drive-v2-cas-1`.
- `bsmCreateOwner`: the operation UUID while creation is in progress.

Initialization validates a sole existing index before adopting it, or registers a generated ID using root metadata CAS before creating an empty index with that fixed ID. Competing initializers adopt the winner's ID; HTTP 409 reads the existing file without replacing it. A populated library with no index, duplicate indexes, unsupported protocol or interrupted creation is refused. Empty-index initialization never overwrites existing inventories.

Creation validates coherent source records, acquires the root owner with v2 CAS, then rescans authoritative inventories and checks the proposed next number. It generates folder, marker and inventory IDs before creating a pending folder, operation marker and draft inventory. A conditional v2 media PUT claims UUID, permanent number and folder in the index. Conditional v2 metadata PATCH publishes the inventory and folder description, then trashes only the verified owned marker. Success requires fresh index, inventory and folder verification, followed by conditional owner removal and verification.

Properties merge by key/visibility in v2. Clearing `bsmCreateOwner` requires an explicit null value, not omission. Unrelated PUBLIC/PRIVATE properties and index extensions are preserved. Tokens remain private browser memory, and all Drive traffic goes directly to Google.

## Failure and interoperability boundaries

5 October 2026 extension: creation reserves a fourth file ID for `box-folder-qr.png`. The stateless `/api/v1/qr/drive-folder` utility accepts a validated folder ID and encodes the fixed Google Drive folder URL. PNG generation and signature checks happen before folder creation. The pending marker records the QR ID, filename and URL. The browser uploads the PNG to the pending box folder and verifies a byte-for-byte download before claiming the index number. Final verification checks a sole QR filename, the expected ID/MIME type and a fresh byte-identical PNG download bracketed by matching metadata versions. Drive may advance the upload-response version during post-processing; an unchanged file with a stable fresh read remains valid. QR failures cannot report completed creation; ambiguous uploads retain the owner and marker for review. No item photo references are introduced. Existing application box QR routes and inventory/index schemas remain unchanged.

The files do not form a transaction. An interrupted or ambiguous operation retains its owner and pending records; a lock has no expiry and is never stolen. No mutation is blindly retried. A rejected preflight releases only an unused owned claim. Review the reported phase and IDs before any manual recovery; automatic resume or cleanup after restart remains unimplemented.

Every independent client that creates or replaces the index must honor these public properties, use the same conditional endpoints, and refuse an active owner. Drive permissions cannot stop an unrelated external editor from ignoring this convention; later scans and conditional checks detect inconsistent or changed records. Restore into a separate root requires reviewing copied property IDs before adopting a new index.

The v1 inventory/index schemas and stateless API remain unchanged. Creation capability is separate from general editing capability; verified initialization and creation do not enable generic writes; decision 008 separately enables ordinary Save. Upload, NFC writes and recovery publication remain gated.
