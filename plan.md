# Box Storage Memory — staged development plan

Date: 4 October 2026  
Status: Stages 1–6 local deliverables implemented; Stage 7 draft UI, validation and mutation/reconciliation simulator checks delivered. Stage 7 initialization and new-box creation now use live-tested Drive v2 CAS and fixed generated IDs; ordinary box/item saves now use the same lock and v2 conditions; interrupted-operation recovery remains outstanding. Stage 6 recovery saving and list thumbnails remain gated/deferred. Live single-account Google reads, recovery previews and draft validation have passed; v3 browser ETag probes found no strong validators; subsequent v2 body ETags passed stale/racing-write checks for creation. Two-account/lifecycle acceptance and general editing/photo/NFC write acceptance remain outstanding. Stage 8 local photo controls, JPEG processing and gated recovery orchestration are delivered; production photo acceptance remains blocked by live write/cleanup coordination gates. Stage 9 local progressive search and derived Drive descriptions are delivered; live metadata publication/native Drive search acceptance remains pending the write gates. Stages 10–12 local labels/scanning/tag orchestration, HTTPS/security packaging and versioned release handoff are delivered. Physical/device, final-policy real Google and writable release acceptance remain explicitly limited in docs/release-acceptance.md. Inventory/photo mutations remain gated on Stage 1 concurrency verification.

## Sources and scope

This plan is based on the functional specification v1.0 and revised technical specification v1.1:

- [Functional specification](docs/Box_Storage_Functional_Specification.docx), referred to below by `FR-*`, `FQ-*` and `AC-*` identifiers.
- [Technical specification](docs/Technical%20Specification.md), referred to below by section number.

Technical v1.1 incorporates application-level registration and the browser token-flow decision. The changes below are tracked against the original technical v1.0 examples where they remain unresolved; updating the specification does not imply live Google acceptance or a new schema/API release.

Implement the Docker-hosted FastAPI service, React/TypeScript web application, direct browser-to-Google Drive integration, deployment assets, and shared contracts needed by the separate Android project.

Android application development is excluded: no Kotlin project, Android UI, native authentication, native Drive client, camera/NFC implementation, Android SDK, or device testing. This repository must nevertheless publish stable JSON schemas, OpenAPI, identifier rules, compatibility information, and examples so that the Android project can implement its own client independently. Android accesses Drive directly; the Box Storage API is not an inventory or image CRUD proxy.

Baseline constraints:

- Google Drive is the authoritative persistent store. No central inventory database or server-side Drive cache.
- Google access/refresh tokens never go to the Box Storage server and are never persisted by the application. Web access tokens remain in browser memory.
- Account/root changes and sign-out clear runtime inventory, search, photo and authentication state.
- Online operation only; no offline editing, queued synchronisation, or persistent inventory cache.
- OAuth registration belongs to the application operator/publisher, with separate web/Android clients in a managed project. Ordinary users need no Cloud project, billing account or payment-card setup; independent deployments still need trusted origins/client identities registered. See [decision 006](docs/decisions/006-application-oauth-registration.md).
- Support browsing, manual box-number lookup, search, creation, editing, deletion of items, photograph management, QR labels/scanning, and optional Web NFC.
- Preserve unknown JSON fields during supported-version edits and prevent writes to unsupported newer schemas.
- Keep ordinary folders, readable JSON and normal image files useful outside the application.

## Specification reconciliation and design gates

Resolve these in Stage 1 and record decisions before dependent implementation. The proposed resolutions below are additions to the technical examples, not claims that those examples already contain the required fields.

| Topic | Difference or missing detail | Planned resolution / required evidence |
| --- | --- | --- |
| Permanent identity | Functional §§4, 7 require a visible permanent number such as `BOX-0001`; technical §§13, 18 use only a UUID. | Keep immutable UUID `box.id` for routes and machine identity; add immutable `box.number` and index `boxNumber` for the human/business identity. Make numbers unique within a root and visible in folders, labels, library and search. Define normalisation, allocation and duplicate detection. |
| Item wording | FR-INV-005 requires a meaningful description; technical §19 makes `description` optional and `name` mandatory. | Require a nonblank meaningful `name` as the minimum item description and retain optional extended `description`; document this interpretation in the contract and UI. |
| API responsibility | Functional §14 speaks broadly about Android service interfaces; technical §§2, 30–37, 79 forbid a Drive proxy. | Publish stateless utility endpoints and document that both clients implement Drive operations directly with their own Google-authorised context. No server box/item/image persistence endpoints. |
| Browser OAuth | Original technical v1.0 §8 preferred browser-only code + PKCE; revised v1.1 §8 incorporates the selected GIS token model. | Keep the supported browser token flow, in-memory access tokens and user-gesture renewal. Live popup/CORS/expiry checks remain pending; never introduce a server exchange. |
| Application registration | Technical v1.1 §7 and ADR 006 distinguish operator/publisher setup from user consent. | One managed project with platform-specific clients supports many users. Document trusted origins/native identities and applicable operator quotas/verification. Ordinary users need no Cloud project, IAM membership or payment-card setup. |
| Drive permissions | Technical §10 asks for least privilege while users can select existing hierarchies. | Verify that the chosen scope and selection mechanism allow the required existing folders/files, nested discovery and edits. Document exact scope, consent and any verification prerequisites. Do not claim a selected root itself enforces an OAuth folder permission boundary. |
| Concurrent writes | Technical §25 specifies a version check but does not define an atomic write mechanism. | Verify Drive's applicable concurrency controls for JSON replacement, root-index changes and number allocation. A read-before-write check alone must not be represented as race-free. Establish and test the supported conflict strategy; unresolved silent-overwrite risk blocks multi-client write acceptance. |
| Recoverable NFC mappings | Technical §§12, 57, 73 make the root index rebuildable, but the examples store NFC IDs only in that index. | Add authoritative NFC mappings to box inventory metadata (proposed `box.nfcIds`) and treat index `nfcIds` as a derived lookup copy. Define update order, reconciliation and cross-box reassignment recovery. Rebuilding must preserve tag associations. |
| Drive discoverability | FR-DRV-007 and FR-GSR-* require meaningful information where Drive indexing supports it. | Use box-number/name folder names, readable inventory and descriptive item image names/Drive descriptions. Validate actual behaviour; do not promise JSON indexing, image recognition or ranking. Any generated text companion must be derived and rebuildable, never a second authoritative inventory. |

## Delivery approach

Implement stages in order. Each stage ends with a demonstrable result and its acceptance checks; do not defer all verification to the final stage. A stage is complete when its deliverables exist, checks pass, documentation is updated, and unresolved limitations are recorded. Use small changes within each stage rather than one change spanning the entire application.

| Stage | Deliverable | Depends on |
| --- | --- | --- |
| 1 | Architecture decisions and integration prototypes | Specifications |
| 2 | Versioned schemas, identifier rules and fixtures | 1 |
| 3 | Runnable backend/frontend skeleton and development tooling | 1 |
| 4 | Stateless API and published OpenAPI | 2, 3 |
| 5 | Browser authentication, root selection and Drive adapter | 1, 3, 4 |
| 6 | Read-only library, box/item/photo views and recovery | 2, 5 |
| 7 | Safe box creation and inventory editing | 4, 6 |
| 8 | Photograph creation, replacement and deletion | 7 |
| 9 | Global search and Drive discoverability | 6–8 |
| 10 | QR labels, scanning and optional Web NFC | 4, 7, 8 |
| 11 | Production Docker deployment and security verification | 4–10 |
| 12 | Release acceptance and separate-project contract handoff | 11 |

### Stage 1 — Resolve architecture and prove external integrations

**Status:** Architecture decisions, runnable isolated prototype, simulated concurrency experiments and setup instructions delivered. The user confirmed Google is not configured and requested preparation of the prototype/instructions. Live Google acceptance remains pending; production writes stay gated on verified atomic updates and library coordination. See [findings](docs/stage-1-findings.md) and [decisions](docs/decisions/README.md).

**Work**

- Record the decisions above in `docs/decisions/`, including the privacy boundary and which data is authoritative versus derived.
- Register the prototype once at application level and reuse its web client ID across ordinary consent test accounts. Document operator setup separately from user authorization, including trusted web origins/native identities and billing/verification qualifications.
- Define browser/service boundaries: `GoogleAuthService`, `DriveStorageService`, shared validation/identifier utilities and API client. Keep business rules separate from FastAPI routes and React components.
- Prototype browser login, renewal, account selection, sign-out, root selection/creation and direct read/write of a test Drive JSON file without sending credentials to this server.
- Prototype concurrent writes from two independent sessions to inventory and index files. Include simultaneous new-box-number allocation, not just sequential saves.
- Specify interrupted multi-file operation recovery for folder creation, inventory/index updates, image edits and NFC reassignment.
- Define supported browser/camera/Web NFC capability checks and document deployment URL behaviour, including old QR labels after a host/domain change.

**Deliverables:** architecture decisions, prototype findings, final data/write rules, browser support matrix and Google setup requirements. Prototypes use disposable test Drive data and do not become an unreviewed production implementation.

**Acceptance:** authentication and Drive access work within the token boundary using application-level registration; ordinary consent test accounts require no project membership or billing setup; scope assumptions and concurrency limitations are demonstrated rather than guessed; dependent design gates are resolved or explicitly remain blocking.

**Coverage:** FR-AUTH-*, FR-API-001–003, FR-SEC-*; technical §§2, 7–10, 24–25, 73, 79–82.

### Stage 2 — Define shared schemas and interoperability contracts

**Status:** Complete. Versioned schemas, release manifest, sample library, Python/TypeScript validators, 110 shared document/identifier/library fixtures and edit-preservation checks implemented. See [contracts](docs/contracts.md). This does not close Stage 1's live integration gates.

**Work**

- Create `schemas/inventory.schema.json` and `schemas/box-index.schema.json`, with an explicit JSON Schema dialect, stable schema identifiers and `schemaVersion` rules.
- Define UUIDs, permanent human box numbers, item IDs, required/optional fields, UTC timestamps, quantity constraints, image filename references, NFC metadata and index folder references. Empty item lists are valid.
- Define NFC hex normalisation, malformed/empty identifier rejection, uniqueness within a root, replacement tags and multiple tags per box. One tag cannot actively identify two boxes.
- Define `/box/{boxId}` URLs, allowed deployment origin/scheme/path and UUID validation. QR contents are references, never credentials or embedded inventory.
- Define structural validation separately from library-wide checks: duplicate box numbers/UUIDs/NFC IDs and index/inventory agreement require library context.
- Add supported-version edit rules that preserve unknown fields at document, box and item levels; specify read-only behaviour for newer versions and explicit future migration rules.
- Add shared valid/invalid fixtures and expected validation, QR parsing and NFC normalisation results for Python, TypeScript and future clients.
- Keep application-registration and user-billing configuration out of persisted inventory/index records and QR payloads. Document that ADR 006 changes deployment/onboarding rules, not the released schema or identifier contract.

**Deliverables:** schemas, `docs/contracts.md`, sample library/index/inventory files and reusable test vectors.

**Acceptance:** backend and browser validation agree on fixtures; invalid IDs, quantities, timestamps, unsafe image references and duplicates are handled; unknown fields survive a round trip; both visible box numbers and machine UUIDs are covered.

**Coverage:** FR-DRV-003–006, FR-LIB-006–008, FR-INV-005, FR-NFC-002–005, FR-PORT-*; technical §§12–20, 59–61, 76.

### Stage 3 — Establish the runnable repository

**Status:** Complete. FastAPI/React skeleton, health/static routing, configuration, safe logging, dependency locks, formatting/lint/type tooling, CI, Docker/Compose and development instructions delivered. Native and Compose startup, non-root/read-only execution and HTTP smoke checks passed. See [verification](docs/stage-3-findings.md) and [development instructions](docs/development.md).

**Work**

- Create `backend/app/{api,models,schemas,services}`, `backend/tests`, `frontend/src`, `frontend/tests`, `schemas`, and `docker` following technical §77.
- Set up Python/FastAPI/Pydantic/Uvicorn and React/TypeScript/Vite with reproducible dependency locks, formatting, linting and type checking.
- Add backend application configuration and frontend routing for login, library, search, box, box editing, item details and settings.
- Implement a minimal health endpoint and serve a compiled frontend; distinguish API 404s from SPA route fallback.
- Add an initial multi-stage Dockerfile, Compose service, `.env.example` and local development instructions. Introduce token/payload-safe logging from the start.
- Treat `GOOGLE_WEB_CLIENT_ID` as one operator-managed public web registration for all users of the deployment; do not add per-user Cloud/billing settings. Independent deployments need their exact trusted origins registered.
- Add CI for backend tests, frontend checks/build, contract checks and image build; keep credentials out of fixtures and CI logs.

**Deliverables:** runnable application skeleton, initial container and documented development commands.

**Acceptance:** clean checkout can start locally and in Compose; health responds; refreshing a nested browser route loads the app; invalid API paths return API errors; lint/type/build checks pass.

**Coverage:** FR-WEB-001–002; technical §§4–5, 40–43, 69, 71–72, 77.

### Stage 4 — Implement stateless shared API services

**Status:** Complete. All seven operations, transport/privacy limits, PNG QR generation, versioned OpenAPI, integration examples and HTTP smoke checks are implemented. Fixture parity, independent QR decoding, native HTTP and non-root/read-only Compose checks passed. See [verification](docs/stage-4-findings.md) and [API instructions](docs/api.md). No Google configuration is required for these stateless services.

**Work**

- Implement the API contract below, with typed request/response models, common error envelopes and documented status codes.
- Return only public configuration: application/API versions, public URL, the deployment's shared public web OAuth client ID, feature flags and supported/minimum client compatibility information. Configuration remains account-independent and introduces no user credential/billing provisioning or arbitrary native-client registration.
- Validate inventory and index JSON against published schemas and domain rules supported by the supplied document. Return stable field paths and useful errors without retaining request bodies.
- Generate QR images from configured `PUBLIC_URL` plus validated Box UUID; support a documented image format suitable for display, save and print.
- Expose `/api/docs` in development and `/api/openapi.json`; export a versioned `openapi.json` matching the implemented API.
- Apply explicit CORS configuration, request-size limits and abuse/rate controls appropriate for a public stateless API. Never request or forward Google credentials; omit incoming authorization headers and query contents from logs.
- Keep full search in the browser for version 1. The optional `/api/v1/search` endpoint is deferred and must not be advertised in OpenAPI/configuration as implemented.

| Endpoint | Contract |
| --- | --- |
| `GET /api/v1/health` | Safe status, application version and API version |
| `GET /api/v1/config` | Public client configuration and compatibility |
| `GET /api/v1/schema/inventory` | Published inventory schema |
| `GET /api/v1/schema/index` | Published root-index schema |
| `POST /api/v1/validate/inventory` | Inventory document → `{ valid, errors }` |
| `POST /api/v1/validate/index` | Index document → `{ valid, errors }` |
| `POST /api/v1/qr/generate` | `{ boxId }` → documented QR image response |

**Deliverables:** working services, API integration tests, OpenAPI export and request/response examples. Define how invalid-document results differ from malformed HTTP requests and transport errors.

**Acceptance:** each published operation matches OpenAPI; valid/invalid documents match fixtures; QR decodes to the configured box route; config/logs/errors expose no private configuration or submitted inventory; no endpoint connects to Drive or needs Google credentials.

**Coverage:** FR-API-001–003, FR-ERR-007, FR-SEC-*; technical §§30–36, 47, 50, 60–62, 79.

### Stage 5 — Implement browser login and direct Drive access

**Status:** Local implementation complete. Browser token lifecycle, typed API client, account/root setup, root-scoped Drive adapter, cancellation/generation fences, bounded read retries and connection UI delivered with automated tests. Live single-account login/root selection and Drive reads are verified; two-account/expiry/revocation acceptance remains pending. Inventory/photo adapter mutations fail closed behind Stage 1's unverified write gate; empty library-folder creation is explicit and never blindly retried. See [verification and limitations](docs/stage-5-findings.md) and [application setup](docs/google-setup.md#stage-5-application-setup-and-live-checks).

**Work**

- Implement the verified Stage 1 Google flow with in-memory tokens, renewal prompts, revoked-access handling, sign-out and explicit account switching.
- Reuse the operator-configured web client ID when authorizing different Google accounts. Keep end-user connection/root setup free of Cloud Console, client-ID creation and payment-card steps; missing registration is an operator setup error.
- Build the Drive adapter for root selection/creation, folder enumeration, file lookup/download, metadata/version reads, JSON writes and image operations.
- Handle pagination, minimal requested fields, bounded parallel requests, transient errors and exponential backoff. Do not retry destructive writes blindly after an ambiguous result.
- Store only permitted noncredential preferences, such as selected root IDs, scoped by account. Changing account or root clears runtime state and cancels or invalidates in-flight responses.
- Add settings for root change and sign-out, and accessible loading, consent-denied, expired-session and network-failure states.
- Integrate public API configuration and a typed web API client. Keep Google-authorised requests separate from Box Storage API requests so token headers cannot cross the boundary.

**Deliverables:** authentication UI, tested Drive service, root setup/settings screens and integration instructions.

**Acceptance:** two ordinary test accounts without project membership or Cloud billing setup authorize the same configured application and expose separate libraries; switching during an active fetch never displays the previous account's response; expiry/revocation stops access until reauthorised; browser storage and requests to Box Storage contain no Google token.

**Coverage:** FR-AUTH-*, FR-DRV-001, FR-WEB-003, FR-ERR-001/003; technical §§8, 10–11, 40, 52–56, 63.

### Stage 6 — Deliver browsing, box views and index recovery

**Status:** Read-only library, manual number lookup, nested folder browsing, UUID box/item links, on-demand photos, refresh and recursive recovery previews implemented and locally verified. Recovery preserves authoritative NFC/number associations and reports ambiguous/unavailable records. Replacement remains disabled behind the Stage 1 atomic-update/bootstrap gate; pre-write rechecks alone do not establish atomicity. List thumbnails remain deferred: private Drive thumbnail links are not suitable for direct browser use and the architecture excludes a server image proxy. Live single-account browsing/photo/recovery checks are recorded in the account test report; full browser/account acceptance remains pending. See [Stage 6 findings](docs/stage-6-findings.md) and [usage instructions](docs/library.md).

**Work**

- Load the root index and present box number, name and location; support manual number lookup, folder hierarchy browsing and empty-library/empty-box states.
- Resolve UUIDs to Drive folder IDs and verify loaded inventory matches the selected record. Renaming or moving folders must not change box identity.
- Show item lists, item details and linked photos; fetch thumbnails for lists and full images only on demand. Manage browser object URLs and runtime caches.
- Add explicit refresh of library/box state and detect external Drive edits, missing folders/images, duplicate records and invalid JSON without overwriting data.
- Rebuild a missing/damaged index by recursively discovering inventories within the selected root; collect UUIDs, box numbers, folder IDs and authoritative NFC mappings.
- Present a recovery report with duplicates/invalid inventories/unavailable records; require confirmation and a concurrent-change check before writing a replacement index. Do not silently drop missing entries.
- Route unsupported newer schemas to safe read-only/error handling rather than a writable form.

**Deliverables:** useful read-only library, box/item/photo screens and index rebuild workflow.

**Acceptance:** nested boxes and deep links resolve correctly; manual lookup works without scanning; external folder rename/move within the root is recoverable; corrupt data stays unchanged; rebuilding retains number and NFC associations and reports ambiguous records.

**Coverage:** FR-DRV-001/006/008, FR-LIB-001–003/007–008, FR-INV-001/008/010, FR-PHO-003, FR-ERR-002/007; technical §§11–13, 29, 54–59, 64.

### Stage 7 — Implement box creation and inventory editing safely

**Status:** Local creation/edit forms, source-preserving item/box drafts, local/API validation, permission guards, navigation/unload prompts and gated mutation/reconciliation services delivered. Atomic-simulator tests cover competing inventory writers, competing number claims, separate-box index races and interrupted operations. Production initialization and new-box creation are enabled using live-tested v2 CAS, fixed-ID bootstrap and a durable root owner. Ordinary existing-box saving is enabled through decision 008; recovery publication remains gated. See [decision 007](docs/decisions/007-coordinated-creation.md). Pending creations are discovered and block creation/rebuild; automatic pending publication/cleanup after restart is not implemented. This stage is not fully accepted until the live gates and reviewed pending-operation recovery are completed. See [Stage 7 findings](docs/stage-7-findings.md) and [editing instructions](docs/editing.md).

**Work**

- Create a box with a unique permanent number, UUID, descriptive folder name, inventory and root-index entry. Follow Stage 1 allocation/conflict rules across concurrent clients.
- Edit descriptive box metadata without changing its number/UUID; update derived index fields and folder naming consistently.
- Add/edit/delete inventory items, including IDs, meaningful wording, quantities, descriptions, tags and notes. Confirm destructive actions and describe associated-photo consequences.
- Preserve original JSON extension fields rather than rebuilding documents only from known form fields. Validate locally and integrate shared API validation with clear API-unavailable errors.
- Use the verified concurrency strategy for every inventory/index write. Show reload/review options on conflict; never silently overwrite another session's changes.
- Track partial operations and ambiguous network results. If inventory succeeds but index update fails, report the exact state and offer reconciliation; keep number conflicts visible until resolved.
- Provide unsaved-change prompts and read-only handling for insufficient Drive permissions. Keep failed edits in current runtime context without presenting them as saved or queuing offline writes.

**Deliverables:** create/edit forms, inventory mutation services, conflict/recovery UI and multi-session integration tests.

**Acceptance:** creation produces one identifiable folder and valid inventory/index references; numbers stay unique; item changes persist in Drive; unknown fields survive; two clients cannot silently overwrite inventory/index changes; failed saves never show success.

**Coverage:** FR-LIB-004–006, FR-INV-002–009, FR-ERR-004–008; technical §§19, 24–26, 55, 59, 63.

### Stage 8 — Implement complete item photograph management

**Status:** Local file/device-camera selection, multiple JPEG previews with optional 2560-pixel resizing, item-linked descriptive filenames, replacement/removal/item-deletion controls and gated mutation/recovery services delivered. Simulator and UI checks cover publication order, conflicts, missing images, ambiguous operations, ownership/reference-safe cleanup and resource release. Production upload/reference/owned-trash operations now use the shared root owner and verified conditional writes in [decision 009](docs/decisions/009-coordinated-photos.md), including exclusion of compatible concurrent reassociation during cleanup. Read-only owned-upload discovery and explicit confirmed association/cleanup support lost-upload IDs and recovery after restart, including deleted-item cleanup routes; operations are never resumed automatically. Live Google/browser-device acceptance remains pending. See [Stage 8 findings](docs/stage-8-findings.md) and [photo instructions](docs/photos.md).

**Work**

- Select or capture photos through supported browser capabilities, preview before upload, default to JPEG and optionally resize to a 2560-pixel maximum dimension while preserving aspect ratio.
- Generate descriptive, collision-safe filenames and retain photos beside `inventory.json`. Associate images with stable item IDs through the inventory references.
- Implement multiple-photo upload, viewing, replacement and confirmed deletion. Deleting an item explains and deliberately handles its photos.
- Follow Stage 1 recovery rules for nontransactional Drive operations: upload before referencing a new photo, commit reference changes before removing obsolete photos, and never delete a still-referenced/shared file blindly.
- Report partial success precisely and provide retry/orphan cleanup actions after re-reading current references. Do not delete unrelated files in a box folder.
- Release camera streams, temporary previews and image object URLs on navigation, root/account change and sign-out.

**Deliverables:** photo controls, camera/file selection, image processing and recoverable Drive mutation services.

**Acceptance:** add/view/replace/delete persist ordinary images in the correct folder; item identity is stable; item deletion handles photos as disclosed; denied camera access and interrupted upload/delete leave understandable, recoverable state; no Base64 images enter inventory JSON.

**Coverage:** FR-PHO-001–008, FR-INV-010, FR-WEB-005, FR-ERR-004/008; technical §§20–21, 24–25, 63–64.

### Stage 9 — Implement global search and meaningful Drive records

**Status:** local deliverables implemented and verified; see [verification](docs/stage-9-findings.md) and [search/Drive guidance](docs/search.md). Search covers current indexed inventories and exposes incomplete reads; unindexed discovery uses library recovery. Live Drive descriptions and native-search acceptance remain pending earlier write gates.

**Work**

- Build an in-memory index across accessible inventories with progressive loading and visible incomplete/error states for unreadable boxes.
- Support case-insensitive partial matching of box number/name/location/tags and item name/description/tags/notes.
- Show item wording and containing box number/location in results; open/focus the matched item and provide a path to editing.
- Update/invalidate search after edits, image context changes, refresh, root change and account switch. Do not return old-account results or claim partial data is a complete current search.
- Maintain descriptive folder/image names and suitable Drive descriptions/metadata so records retain box context outside the app. Document observed native Drive search behaviour and its limitations.

**Deliverables:** search screen, tested matching/index logic and Drive discoverability guidance.

**Acceptance:** full/partial box numbers and item descriptions locate the expected records; edits appear after successful save; results navigate to the correct item; inaccessible boxes are reported; Drive files expose useful box/item context independently of the app.

**Coverage:** FR-SRC-001–007, FR-GSR-001–004, FR-DRV-007, FQ-003–004; technical §§22–23, 52–55, 63–64.

### Stage 10 — Implement QR labels, QR scanning and optional Web NFC

**Status:** Local deliverables implemented and verified; [findings](docs/stage-10-findings.md). Physical camera/NFC and live tag mutations remain pending the earlier coordination gates.

**Work**

- Display/save/print QR labels generated by the API with the visible permanent box number. Regeneration retains UUID, number and Drive folder identity.
- Add camera QR scanning with start/stop controls, permission/error handling and strict origin/scheme/path/UUID validation. Never automatically follow unrelated or other-deployment QR URLs.
- Preserve a requested `/box/{boxId}` route through login/root selection; report unknown or inaccessible boxes clearly rather than selecting a similarly named record.
- Detect Web NFC and usable serial-number support at runtime, gated by `ENABLE_WEB_NFC`; provide browsing/QR/manual lookup when unavailable.
- On supported browsers implement registered-tag lookup, unknown-tag registration, replacement/removal and duplicate prevention using shared normalisation rules.
- Require explicit confirmation for a tag already assigned elsewhere; persist authoritative mappings and reconcile the derived index using the write/recovery rules.
- Document tag representation and UID byte-order test vectors for the separate client. No native Android scanning work belongs here.

**Deliverables:** printable labels, safe web scanner, optional Web NFC UI and cross-client identifier examples.

**Acceptance:** QR opens the right box before/after authentication; invalid/plain-text/unrelated/malformed QR data never redirects automatically; camera denial has a usable fallback; NFC replacement preserves box identity; known/unknown/duplicate/malformed tags behave clearly on supported web hardware. Unsupported browsers remain fully usable.

**Coverage:** FR-QR-001–003/005–007, FR-NFC-002–007, FR-WEB-006–007, FR-ERR-002/006; technical §§14–16, 26–29, 67–68. Native NFC acceptance remains owned by the separate Android project.

### Stage 11 — Complete production packaging and security verification

**Status:** Local image/HTTPS/security deliverables implemented and verified; [findings](docs/stage-11-findings.md). The existing localhost service is deployed and final-policy single-account read/draft workflows pass. Public-domain issuance, two-account/Google lifecycle and live restore acceptance remain pending.

**Work**

- Finalise one multi-stage image containing the static web build and Python runtime; run as non-root with only required dependencies and the application port.
- Add Compose health checks against `/api/v1/health`, restart behaviour and environment-based configuration with no inventory volume/database requirement.
- Provide a documented HTTPS reverse-proxy deployment example, localhost development exception and OAuth origin/redirect setup. No privileged mode, Docker socket mount or host filesystem dependency.
- Apply explicit CORS, HSTS in HTTPS deployments, content-type protection, referrer policy, CSP and capability-specific permissions policy. Verify Google login/Drive/photos/camera continue to work under the final policies.
- Keep logs limited to safe method/path/status/duration/error metadata; exclude request bodies, authorization headers, sensitive queries and image contents. Configure production browser diagnostics similarly.
- Document environment variables, public versus private configuration, update/rollback, health troubleshooting, Drive-based backup/restore, index recovery and moving to another compatible deployment.

**Deliverables:** release-ready image/Compose configuration, `.env.example`, security configuration and deployment/runbook documentation.

**Acceptance:** a fresh deployment serves web/API over HTTPS; direct routes work; container is healthy and non-root; normal use leaves no Google tokens or Drive content in server persistence/logs; another operator can configure their own Google application and accounts without provider credentials. Test backup/index recovery and deployment replacement with a test library.

**Coverage:** FR-SEC-001–007, FR-PORT-001–005, AC-02/11; technical §§42–51, 69–74, 82, 84.

### Stage 12 — Verify release acceptance and publish the handoff

**Status:** Contract package, automated/browser checks and handoff delivered; [findings](docs/stage-12-findings.md) and [criterion acceptance record](docs/release-acceptance.md). Every criterion has evidence or an explicit limitation; writable production release is not approved.

**Work**

- Run automated schema/domain/API tests, frontend lint/type/build checks, mocked Drive/error scenarios and real Drive integration checks using disposable accounts/libraries.
- Run browser workflows on Chrome desktop, Chrome Android browser, Firefox and Edge, including responsive layout, keyboard navigation, accessible labels, photo controls and camera permission denial.
- Exercise empty/corrupt/missing data, unsupported schemas, permission denial, account switch during requests, revoked/expired login, pagination/rate limits, interrupted saves and concurrent edits.
- Complete end-to-end web workflows: first access, create/label box, add/edit/delete item with photos, search/edit from result, QR login/deep link, refresh external edits, optional Web NFC and index rebuild.
- Publish versioned `inventory.schema.json`, `box-index.schema.json` and `openapi.json` together with fixtures, compatibility policy and release notes. Check the OpenAPI export against the running API in CI.
- Write `docs/client-integration.md` describing token-free API calls, direct client Drive responsibilities, UUID/number/NFC/QR conventions, validation/errors, unknown-field preservation, concurrency/recovery rules and account isolation. Include examples usable by any independently developed client.
- Supply a repeatable HTTP contract smoke test that the Android project can run without building an Android application here. Document any remaining hardware-specific acceptance as external-project work.

**Deliverables:** release acceptance record, deployment documentation and complete versioned contract package for independent Android development.

**Acceptance:** every in-scope criterion below has evidence or an explicit justified limitation; contract consumers can validate fixtures and call a deployed service without Google tokens; no Android deliverables are required to release the server/web project.

## Final acceptance traceability

| Functional criterion | Evidence produced by this project |
| --- | --- |
| AC-01: clean deployment, own account, isolation | Stages 5, 11–12: first-run and two-account checks |
| AC-02: no persisted credentials | Stages 5, 11–12: browser/server persistence, network and log inspection |
| AC-03: permanent number, folder and inventory | Stages 2, 7: identity/uniqueness and Drive creation checks |
| AC-04: item add/edit/delete | Stages 7, 12: reload confirms authoritative Drive updates |
| AC-05: ordinary item-linked photos | Stages 8, 12: Drive files and inventory references inspected |
| AC-06: QR opens correct authorised record | Stages 10, 12: scanned and direct URL flows |
| AC-07: native Android NFC | Android implementation excluded; Stages 2, 4, 10, 12 deliver mapping, normalisation and API contracts only |
| AC-08: replace label/tag without identity change | Stages 7, 10: UUID/number/folder stability and mapping checks |
| AC-09: item search identifies box number | Stages 9, 12: full/partial search and result navigation |
| AC-10: independent Drive discoverability | Stages 8–9, 12: readable context and observed Drive search, subject to Google indexing |
| AC-11: independent user/deployment | Stages 5, 11–12: clean operator setup and isolated account test |
| AC-12: honest network/save failures | Stages 5–8, 12: fault injection and partial-operation recovery |

Technical §84 Android-specific acceptance belongs to the separate project. This project establishes the shared interfaces needed for it and verifies the web/server portions, including client-to-Drive access, immutable IDs, no server inventory database, reconstructable index and portable records.

## Deferred work

- The entire native Android application and its device acceptance testing.
- Optional stateless server search; browser search satisfies the baseline.
- Offline capture/synchronisation, image recognition, warehouse functions, movement history, batch labels, shared roles and reporting described as future enhancements in the functional specification.
- New schema migrations beyond the first released version; version handling and preservation rules are required now.

Do not add these to a stage implicitly. A later scope change must identify its contract and architecture impact.


Existing-box save follow-up (4 October 2026): ordinary box/item additions, updates and removals now use the coordinated v2 protocol in [decision 008](docs/decisions/008-coordinated-editing.md). Photo management now uses the same owner and conditional writes. NFC mutation, recovery publication and automatic interrupted-operation recovery remain gated. This supersedes the earlier existing-box-save limitation above.
