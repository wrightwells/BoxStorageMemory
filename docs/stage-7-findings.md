# Stage 7 verification

Date: 4 October 2026. Local creation/edit draft screens, validation and gated mutation/reconciliation orchestration are delivered. **Stage 7 production acceptance is not complete.** No real Google account was used in the original local-only run. Subsequent live draft-service results are appended below; at the original run OAuth was unconfigured; real atomic JSON/metadata writes, bootstrap/uniqueness, creation/recovery coordination and pending-operation resumption after restart remain unresolved.

Delivered:

- Creation proposal and editable box/item drafts with stable UUIDs, protected permanent numbers/creation time/NFC/image associations, safe-integer quantities, descriptions, tags and notes.
- Source-preserving transforms, including unknown document/box/item/index fields and unrelated index entries. Confirmed item removal leaves ordinary photo files in Drive as disclosed.
- Shared local and existing stateless API validation with explicit errors and retry. API failure does not discard the draft or report it as saved.
- Router navigation/Back/Forward and unload guards, user-initiated account/root discard prompts, capability-based read-only forms and guarded invalid/newer documents. Context changes cancel/clear drafts and late responses.
- Fail-closed mutation adapter preflight. Production Save/Create/Reconcile controls are disabled; no environment/caller override was added. Conditional metadata publication/rename has its own explicit unverified-primitive refusal.
- Edit orchestration with conditional inventory/index updates, verified document reads, descriptive folder naming, confirmed/uncertain operation steps, conflict review, retained failed drafts and no automatic ambiguous retry.
- Explicit fresh-authority index/folder reconciliation that never replays the old draft or overwrites the current inventory.
- Candidate pending-folder/marker/draft creation protocol with conditional number claims before publication and marker cleanup last. Recursive recovery reports pending state and retains unavailable claimed entries, blocking creation/rebuild rather than dropping records or auto-completing a pending operation.

Executed local verification:

- **123 frontend tests passed**: 30 new service/simulator tests and 13 new screen tests plus the 80 existing tests. Coverage includes extension/identity/photo preservation, validation/permissions, closed production gates, stale documents, explicit deletion, partial/ambiguous saves, metadata reconciliation, late responses, creation interruptions and durable pending state.
- Independent clients in the atomic simulator race the same inventory, different inventories sharing an index, and the same next number. One stale writer/claimant loses; accepted inventory changes remain, and a reviewed reconciliation preserves both separate-box edits. This demonstrates the required orchestration against simulated primitives, not Drive's capabilities.
- UI tests cover validation retry, disabled production Save/Create, truthful success/partial outcomes, dirty-draft retention, navigation return, blocked browser Back, page-unload prevention and immediate sign-out clearing.
- Frontend TypeScript, ESLint, Prettier and production build passed. Vite reports a nonfatal chunk-size warning for the approximately 530 kB minified main bundle (161 kB gzip); further splitting is deployment/performance work.
- **105 Python tests passed**; backend Ruff lint/format, strict mypy and OpenAPI freshness passed. Shared Python/TypeScript fixture parity and Stage 1 prototype assertions passed. The existing Starlette/httpx test transport deprecation warning remains.
- An isolated Compose deployment passed frontend assets, creation/edit/item deep-route and API smoke checks, became healthy, ran as UID 10001 with a read-only filesystem, and was removed afterward. No existing deployment was changed.
- Local Markdown links were checked.
- Stage 7 Docker image built successfully. No schema/API/dependency version or backend endpoint changed. Google access still uses the existing shared application registration; no per-user Cloud/billing setup was introduced.

See [editing instructions and live gates](editing.md) for the candidate marker format, safe review options and acceptance checklist. The [Drive update reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) and [file metadata reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) do not supply executed evidence of the required atomic primitive. Real browser probes remain necessary. A local mutex or metadata/version comparison is not a cross-device overwrite guarantee.

Pending records can be discovered after restarting, but safe automatic continuation/cleanup is deliberately unavailable. Unknown folder-creation results require locating the operation marker/name in Drive before another attempt. Claimed numbers are retained in the index; never silently release/reuse a number or turn a missing published inventory into a normal empty box. There is no offline queue or server operation store.

## Live single-account follow-up — 4 October 2026

Live browser-service draft edits and a BOX-0003 creation proposal validated locally and through the stateless API, preserved item identity/extensions and left the Drive inventory unchanged. Production Save/Create remain disabled. The first editor UI attempt encountered an unresponsive browser tab; a fresh-tab reconnection restored service testing, so full live editor/navigation acceptance remains outstanding. No Google persistence/concurrency acceptance is claimed. See the [account test record](stages-1-7-account-test.md).

## Coordinated creation follow-up — 4 October 2026

New-box creation and empty-library initialization now use live-tested Drive v2 conditional writes, fixed generated IDs and a durable root owner. Independent sessions demonstrated one successful number claimant and explicit rejection of the competitor; a fresh proposal then created the next number. See [decision 007](decisions/007-coordinated-creation.md) for endpoints, interoperability and retained interruption limits. Existing-box editing, photo/NFC mutations and index recovery publication remain gated.

## Existing-box save follow-up

Ordinary box/item saving is now enabled through [decision 008](decisions/008-coordinated-editing.md). It shares the creation owner and live-tested v2 conditional endpoints, retains operation markers on partial/ambiguous failures, and verifies source JSON before refreshing conditional validators. 298 frontend tests passed. See [item save verification](live-item-save-test.md). Photo/NFC writes, recovery publication and automatic interruption recovery remain outstanding.
