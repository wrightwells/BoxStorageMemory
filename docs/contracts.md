# Box Storage shared contracts — version 1.0.0

These contracts implement Stage 2 and the identity/data decisions in [ADR 003](decisions/003-data-and-identity.md). They apply to the web/server repository and any independently developed client. No native application code is included.

Registration clarification, 4 October 2026: [ADR 006](decisions/006-application-oauth-registration.md) and technical v1.1 use application-level registration managed by the operator/publisher, with separate platform clients and per-user Google consent. Users need no Cloud project/payment setup. No schema, fixture, UUID/number/NFC/QR rule or contract release changes are required. OAuth registration, credentials and billing configuration shall not be added to inventory/index records or QR payloads. The public web ID belongs in deployment configuration; native identity belongs in the separate signed Android application.

## Published artifacts

| Artifact | Purpose |
| --- | --- |
| `schemas/v1/inventory.schema.json` | Released inventory schema; `$id` = `urn:box-storage-memory:schema:inventory:1` |
| `schemas/v1/box-index.schema.json` | Released root index schema; `$id` = `urn:box-storage-memory:schema:box-index:1` |
| `schemas/v1/manifest.json` | Contract release and schema SHA-256 hashes |
| `schemas/*.schema.json` | Current aliases, byte-identical to v1 for this release |
| `examples/library/` | Valid index and two readable inventories, including an empty box |
| `fixtures/contracts/cases.json` | Language-independent structural/domain/identifier vectors with expected results |
| `fixtures/contracts/library-cases.json` | Cross-record consistency vectors |
| `shared/python/contracts.py` | Framework-independent Python validation/identifier/edit helpers |
| `shared/typescript/contracts.ts`, `models.ts` | Browser-compatible validation/identifier helpers and record types |

Both schemas use JSON Schema Draft 2020-12 and self-contained `$defs`; no network schema resolution is needed. Schema identifiers are stable URNs, not URLs that need hosting. Use a validator supporting this dialect and enforce date-time formats. This repository uses Python `jsonschema` and TypeScript Ajv 2020 with full date-time formats. JSON input must be ordinary finite JSON, not arbitrary language objects, NaN/infinity or documents with ambiguous duplicate object keys; HTTP parsing enforcement belongs to Stage 4.

Stage 4 publishes [versioned OpenAPI](../api/v1/openapi.json) and the root `openapi.json` alias. API validation wraps these rules with public messages and HTTP status semantics; the shared helpers return deterministic `{valid, errors: [{path, code}]}`.

## Inventory

The single authoritative file is named exactly `inventory.json`, beside image files in its box's Drive folder.

| Field | Rules |
| --- | --- |
| `schemaVersion` | Required numeric value `1` |
| `box` | Required object |
| `box.id` | Required immutable UUID, lowercase canonical 8-4-4-4-12 form, version nibble 1–8 and RFC variant 8/9/a/b; generate new IDs with UUID v4 |
| `box.number` | Required immutable human/business number, canonical `BOX-0001` through `BOX-999999999`; at least four decimal digits, no excess leading zeroes beyond four-digit padding, nonzero |
| `box.name` | Required nonblank meaningful item/box wording; normal text and Unicode are allowed |
| `box.created`, `box.modified` | Required actual Gregorian UTC dates `YYYY-MM-DDTHH:mm:ss[.sss]Z`, year 0001–9999, optional 1–3 fractional digits, no timezone offsets or leap seconds; modified cannot precede created |
| `box.nfcIds` | Required array of canonical unique hex UIDs; `[]` means no tag |
| `box.description`, `box.location` | Optional strings |
| `box.tags` | Optional array of distinct nonblank strings |
| `items` | Required array; `[]` is a valid empty box |
| `items[].id` | Required immutable canonical UUID, unique in this inventory |
| `items[].name` | Required nonblank meaningful wording, satisfies the minimum item-description requirement |
| `items[].quantity` | Required integer 0–9007199254740991, safely representable by browser numbers; zero is permitted |
| `items[].description`, `notes` | Optional strings |
| `items[].tags` | Optional array of distinct nonblank strings |
| `items[].images` | Optional array of distinct filenames; one image belongs to exactly one item within a box |

Image references are filenames, never Drive tokens, file IDs, URLs or Base64. Allowed suffixes in v1 are lowercase `.jpg`, `.jpeg`, `.png`, `.webp`; JPEG is the recommended upload default. Maximum filename length is 255 characters. Reject leading dots, `/`, `\`, `:`, control characters, DEL, `%`, `?` and `#`. Names may contain normal spaces/Unicode, but generated names should include box number, item wording and an ID suffix for collision resistance. Resolve by an exact filename among current folder children; ambiguous duplicate filenames are errors. Filename validation does not replace content/MIME validation at upload time.

## Root index and library checks

The root's single `box-storage-index.json` is a rebuildable lookup file. Required fields are `schemaVersion`, UTC `updated`, and `boxes` (possibly empty).

Each entry requires `boxId`, `boxNumber`, `name`, `driveFolderId` and `nfcIds`. `location` is optional. `boxId`/`boxNumber`/`name`/`location`/`nfcIds` mirror the inventory; `driveFolderId` is the opaque stable Google folder ID, using 1–256 ASCII letters/digits/underscores/hyphens. NFC array order is not significant. Root-folder ID, OAuth material and Drive file versions do not belong in this index.

Structural JSON Schema validation cannot prove uniqueness of a property across objects or consistency with other files. Apply the domain validator after structure passes:

- Index UUIDs, human numbers and Drive folder IDs must each be unique within that index.
- One UID must not be associated with multiple boxes; multiple distinct tags on one box are permitted.
- Item UUIDs must be unique within an inventory; image filenames must not have multiple item owners.
- Inventory timestamps must have a valid order.

For a complete library snapshot, apply `validateLibrary` / `validate_library` with a map of folder IDs to loaded inventories. Every index entry must match a valid authoritative inventory, including identities, display metadata and NFC IDs. Missing/invalid inventories, stale fields and unindexed inventories make this snapshot inconsistent. Loading progress may be shown before all records arrive, but a partial snapshot is not evidence that the complete library is consistent. These pure checks do not authenticate, enforce Google permissions or prevent concurrent writes.

### Error conventions

Paths are JSON Pointers; the document root is `""`. Escape `~` as `~0` and `/` as `~1`. Missing-property structural errors identify the containing object so Python/Ajv results agree. Deduplicate and sort errors by path then code. Do not include inventory values in diagnostics.

| Code | Meaning |
| --- | --- |
| `SCHEMA_VIOLATION` | Wrong structure/type/required field/format/pattern/array uniqueness |
| `DUPLICATE_ITEM_ID` | Later item repeats an earlier item ID |
| `INVALID_TIMESTAMP_ORDER` | Modification precedes creation |
| `IMAGE_HAS_MULTIPLE_OWNERS` | Later item's image repeats another item's filename |
| `DUPLICATE_BOX_ID`, `DUPLICATE_BOX_NUMBER`, `DUPLICATE_FOLDER_ID` | Later index entry repeats a unique identity |
| `DUPLICATE_NFC_ID` | Later index entry repeats another box's tag |
| `MISSING_INVENTORY`, `INVALID_INVENTORY` | Indexed folder does not have a usable loaded inventory |
| `INDEX_MISMATCH` | Derived entry disagrees with its inventory |
| `UNINDEXED_INVENTORY` | Supplied authoritative inventory has no index entry |

Invalid structure prevents semantic checks on that document. The future HTTP utility cannot establish library-wide uniqueness from one inventory alone; clients must supply/load library context and apply the shared checks locally.

## Identifier normalisation

`normalizeBoxNumber` / `normalize_box_number` accept surrounding ASCII whitespace, case-insensitive `BOX-`, and 1–9 decimal digits; parse and pad to four digits. For example ` box-1 ` and `BOX-00001` become `BOX-0001`. Reject zero, negatives, bare numbers and values beyond the supported range. Normalise user input before querying/creating; do not silently repair malformed stored records.

`normalizeNfc` / `normalize_nfc` accept 1–32 bytes as raw hex, or 2–32 pairs separated consistently by `:`, `-` or one space; surrounding ASCII whitespace is accepted. Store uppercase hex without separators. Reject empty values, nonstrings, odd hex counts, `0x` prefixes, mixed/doubled separators and nonhex data. Preserve leading zeroes and byte order. For example `04:A1:34:ca:92:71:80` becomes `04A134CA927180`; the same bytes expressed as `04-a1-34-ca-92-71-80` match. Native readers must convert signed bytes to unsigned two-digit hex in the order returned, without reversing the UID. UID mapping is a lookup convenience, not an authorization credential or a guarantee of unclonable hardware.

## QR and URL rules

`PUBLIC_URL` identifies the deployment origin, with HTTPS required except local loopback HTTP. A trailing root slash/default port may be normalised in configuration. Application subpaths, userinfo, query, fragment, backslashes and malformed ports are invalid. Use ASCII DNS names (punycode if needed); noncanonical numeric-IP spellings are unsupported.

`qrUrl` / `qr_url` generate `{canonicalOrigin}/box/{canonicalUuid}`. `parseQr` / `parse_qr` accept only this exact canonical form for the configured deployment: no external origins, altered schemes/ports, encoded path segments, dot-segment tricks, query, fragment, whitespace, trailing slash or uppercase UUIDs. Unknown but syntactically valid UUIDs must subsequently be resolved inside the authorised selected library; parser success is not permission or existence validation.

Printed QR labels also display the permanent human number. Routes use UUIDs so replacing a label, changing editable names or moving a folder does not change its link. Deployment-origin changes require explicit old-domain redirects or regenerated labels, as described in [ADR 005](decisions/005-browser-and-urls.md).

## Versions, edits and release policy

`schemaMode` / `schema_mode` return `supported` for version 1, `read-only` for an integer version greater than 1, and `invalid` otherwise. Read-only means safe display where practical, never an older client's write permission. Boolean `true` and string `"1"` are not version numbers. Numeric JSON `1.0` is equivalent to `1`.

Unknown properties are accepted at document, box, item and index-entry levels. Supported-version edits must clone the complete loaded source and change only selected known mutable fields, preserving extension objects/arrays. Never serialise a form/model that drops unknown keys. `editItem` / `edit_item` demonstrate this rule, reject ID mutation and return a validated copy without mutating the source. They do not save, update timestamps or provide a concurrency guard; the later save service performs those steps explicitly.

Immutable box UUID/number and item UUID are enforced by mutation services against the loaded source, not by a stateless JSON Schema. No automatic migration exists yet. Importing legacy examples without the newly required number/NFC fields needs an explicit, reviewed upgrade. Future migrations must preserve a recoverable original and unknown fields and pass the same concurrent-write gate.

Versioned schema snapshots are immutable once released. Breaking required fields, identifier meanings or edit semantics require a new schema version, and breaking API changes require `/api/v2/`. The v1 HTTP API is now published in [versioned OpenAPI](../api/v1/openapi.json); see [API instructions](api.md) for token-free requests and transport restrictions. Publish the contract release, schemas, test vectors, compatibility notes and OpenAPI together. The current root schemas are convenience aliases, not replacements for versioned artifacts.

## Running the checks

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-contracts.txt
npm ci --ignore-scripts
.venv/bin/python -m unittest discover -s tests/contracts -p 'test_*.py' -v
PYTHON=.venv/bin/python npm run test:contracts
npm run test:prototypes
```

The TypeScript test executes the independent Python validator and compares all shared results, including unknown-field-preserving edits. `npm run build:contracts` creates browser-importable JavaScript and declarations in ignored `.build/contracts/`. Nothing in these tests accesses a real Google account.

## Browser runtime and release packaging

`shared/typescript/contract-core.ts` contains pure helpers and the validator using precompiled functions. The public `contracts.ts` adapter retains the existing `ContractValidator` constructor and Node schema compilation. Browser code imports the core to avoid shipping AJV compilation. Contract releases include both files; API/schema v1 and shared validation behavior are unchanged. See [the performance review](performance-review.md).
