# Independent client integration — release 1.0.0

The server/web and native client are separate projects. The server never authenticates a user's Google account, proxies Drive images or stores an inventory database. Any compatible client can use the public utilities without Google tokens; the client directly authenticates to Google and reads/writes the selected Drive root. Ordinary users need only their account and consent. Operators/publishers register their own platform application identities; do not embed a web client secret or reuse the web registration as native identity.

## Token-free HTTP

Use an HTTPS deployment origin (localhost HTTP is permitted for development). Never send Google tokens, authorization headers, OAuth codes or client secrets to this API. Credential-shaped submissions are rejected. API version `v1` and schemaVersion `1` are different version axes.

```bash
curl https://boxes.example.com/api/v1/health
curl https://boxes.example.com/api/v1/config
curl https://boxes.example.com/api/v1/schema/inventory
curl https://boxes.example.com/api/v1/schema/index
curl -X POST https://boxes.example.com/api/v1/validate/inventory \
  -H 'Content-Type: application/json' --data-binary @inventory.json
curl -X POST https://boxes.example.com/api/v1/validate/index \
  -H 'Content-Type: application/json' --data-binary @box-storage-index.json
curl -X POST https://boxes.example.com/api/v1/qr/generate \
  -H 'Content-Type: application/json' \
  --data '{"boxId":"9a46f128-1b5a-42ad-a240-b9015cff9ca6"}' --output label.png
```

Validation uses finite UTF-8 JSON with unique keys and bounded request size/depth. A structurally/domain-invalid document returns HTTP 200 with `valid:false` and `errors` containing JSON Pointer paths, machine codes and public messages. Transport errors use `{ "error": { "code": "...", "message": "...", "details": [] } }`: 400 malformed/credential input, 413 too large, 415 wrong content type, 422 request shape, 429 rate limited (honor Retry-After), 404 missing, 405 wrong method, 500 failure. Keep an unsaved draft on failure; an API validation result does not write Drive or prove cross-record integrity. Use the released OpenAPI for exact request/response definitions.

Run the stdlib-only smoke checks without building an Android application:

```bash
python3 tools/smoke_api.py https://boxes.example.com
python3 tools/check_running_openapi.py https://boxes.example.com
```

The configured Google web ID is public registration metadata, not a credential. `features.webNfc` concerns optional browser capability; native hardware capability is independent. Neither configuration nor a successful validation enables production writes.

## Direct Drive layout and identity

The root contains `box-storage-index.json`; nested ordinary box folders each contain exactly one authoritative `inventory.json` and ordinary item-linked photos. Resolve opaque folder IDs within the selected root, paginate listings and reject duplicate filenames. Drive permissions still apply. File versions belong to runtime snapshots, not inventory JSON. Item images refer to exact filenames, not Drive IDs, URLs, blobs or credentials. Download them directly from Google in the client; there is no server image endpoint.

Generate new canonical lowercase UUID v4 identities; permanent box numbers normalize to `BOX-0001` through `BOX-999999999`. Renaming/moving folders, changing items/photos and replacing labels/tags preserve the box UUID, number, creation timestamp and Drive folder ID. Allocate new numbers only with verified cross-client coordination, never from a local counter alone.

QR data is the exact canonical absolute `PUBLIC_URL/box/{uuid}` URL. Accept only the configured origin/scheme and lowercase UUID path, with no query, fragment, trailing slash, encoded path tricks or unrelated URL. Preserve the requested UUID through login/root selection, then resolve the actual authorized record. A QR gives no permission; do not substitute a similarly named/numbered box. Old-origin labels require the operator to retain that domain or explicitly regenerate labels.

NFC identity is a reader-supplied serial/UID, not writable NDEF text/URL. Normalize 1–32 ordered bytes to uppercase separator-free hex. Consistent colon, hyphen or single-space byte separators and outer ASCII whitespace may be removed; malformed/mixed separators, odd digits, nonhex and empty values fail. Preserve byte order as delivered; do not heuristically reverse it.

| Reader representation | Canonical UID | Interpretation |
| --- | --- | --- |
| `04:aa:bb:cc:dd:ee:11` | `04AABBCCDDEE11` | seven bytes, forward order retained |
| `04-aa-bb-cc` | `04AABBCC` | four bytes |
| `11 EE DD CC BB AA 04` | `11EEDDCCBBAA04` | reversed input is a different identifier |
| `04:aa-bb` / `4AB` / empty | rejected | unusable serial |

Web NFC may provide an empty serial and does not expose every native tag technology. Check actual shared hardware reference tags before claiming native/web UID interoperability. Native Android implementation and hardware acceptance remain external-project work.

## Validation, preservation and recovery

Released self-contained Draft 2020-12 schemas and synthetic valid/invalid fixtures are under `schemas/v1` and `fixtures/contracts`. Enforce formats plus domain uniqueness: item UUIDs/images, box UUIDs/numbers/folders and cross-box NFC IDs. Inventory is authoritative; index fields mirror it. Validate a complete library for stale mappings, missing/unindexed inventories and duplicate identities before derived lookup or replacement. Never claim incomplete reads are a complete current search.

Preserve unknown properties at root, box, item and index-entry levels using clone-and-change operations. Support schema 1; higher versions are read-only/uninterpretable until supported, and must never be rewritten as version 1. Keep independent clients' fields intact. See [compatibility policy](compatibility.md) and the contract fixtures.

**Initialization and new-box creation use the verified protocol in [decision 007](decisions/007-coordinated-creation.md).** Independent clients must honor the PUBLIC root properties `bsmIndexId`, `bsmCreateProtocol` and `bsmCreateOwner`, use fixed generated IDs for create-once initialization, and use the exact v2 conditional media/metadata endpoints. An active owner must never expire or be stolen. Drive v3 ignored stale `If-Match` in live experiments; do not use it for conditional writes. Ordinary box/item saves use [decision 008](decisions/008-coordinated-editing.md). Photo operations and confirmed owned cleanup follow [decision 009](decisions/009-coordinated-photos.md), using the same PUBLIC owner to exclude concurrent reference changes. NFC reassignment and recovery publication remain gated. A Drive version or pre-read alone is insufficient.

With a verified primitive, validate against a fresh coherent snapshot, conditionally publish authority first and then reconcile derived index metadata. On conflict reload/review, preserving drafts. On a lost response reread and compare the intended change; never blindly repeat an upload or create a second folder. Pending operation markers remain in Drive and are deliberately reviewed. Reassign NFC by confirmed removal from old authority/index before adding to the new box; interruption can leave the tag unassigned, and duplicate authority blocks lookup. Photo cleanup must exclude concurrent re-reference and verify current references/ownership; a pre-read alone is insufficient. Retain unrelated/unverified files, and prefer confirmed trash to permanent deletion.

Keep account/root generation fences on requests. Cancel and clear records, drafts, URLs, cameras and tag readers on sign-out/root/account change; reject late responses. Do not persist tokens, inventory caches or operation queues. The only web preference retained is the selected root scoped to the account's stable permission identity. Every other compatible client must enforce its own isolation and Google permissions.

## Contract package

`api/v1/contract-manifest.json` contains SHA-256 hashes for the released schemas, OpenAPI, synthetic examples/fixtures, identifier helpers and this guide. Build a deterministic handoff archive with `python3 tools/release_contracts.py --check --output /tmp/box-storage-contracts-1.0.0.zip`. Deployment/acceptance/usage guidance and the package generator are included alongside the client contracts. No Google account data or native application is included. Python helper consumers install `requirements-contracts.txt`; TypeScript helper consumers need Ajv 8, ajv-formats 3 and a TypeScript toolchain, or may implement the published vectors with their own compatible validator.


Existing-box save follow-up (4 October 2026): ordinary box/item additions, updates and removals now use the coordinated v2 protocol in [decision 008](decisions/008-coordinated-editing.md). Photo management now uses the same owner and conditional writes. NFC mutation, recovery publication and automatic interrupted-operation recovery remain gated. This supersedes the earlier existing-box-save limitation above.
