# Stage 1 integration findings

Date: 3 October 2026.

Stage 1's local design, executable prototype, mock experiments and setup instructions are delivered. At the original local-only run, live Google acceptance was deferred because application OAuth registration was not configured. Subsequent single-account live results are appended below. These results do not claim a successful live login or a Google Drive concurrency guarantee.

Design revision: 4 October 2026. [ADR 006](decisions/006-application-oauth-registration.md) and technical specification v1.1 assign registration to the operator/publisher. One managed project with separate platform clients supports many ordinary accounts; test users need no project membership or payment-card setup. The prototype's client-ID field is operator/test-harness input, reused across accounts. Original executed checks below remain historical evidence.

## Evidence and gate status

| Question | Evidence available now | Outcome / next gate |
| --- | --- | --- |
| Can the web code use Google without a server token exchange? | Official GIS token/code model documentation; mock transport asserts bearer headers only on the Google Drive origin. | Browser token model selected; live popup/CORS/renewal checks pending. |
| Does each user need a Cloud project or payment-card setup? | Google cross-client project model; application-level client configuration and ADR 006. | No ordinary-user Cloud/billing setup in the design. Live same-registration testing with non-project-member accounts remains pending. Operator quotas/publishing requirements are separate. |
| Does root selection imply folder-scoped OAuth access? | Official scope definitions; prototype permits comparison of `drive` and `drive.file`. | No folder permission-boundary claim. Full Drive scope selected for baseline existing-library behaviour; live hierarchy/second-deployment checks pending. |
| Does reading a version before uploading prevent races? | Executable simulated two-writer experiment. Both readers pass and the later unconditional write loses the first update. | No. Read-before-write alone is rejected. |
| Can a conditional primitive reject stale inventory/index writes? | Model and transport mock demonstrate one accepted change and one precondition failure. | Required behaviour defined, not established for real Drive. Candidate live ETag probe prepared. |
| Can two clients allocate the same next box number? | Both simulated clients propose `BOX-0001`; only one conditional claim succeeds; reloaded loser allocates `BOX-0002`. | Proven in the model only. Live index conditional writes, bootstrap and multi-file coordination remain gates. |
| Are NFC assignments recoverable after index loss? | Inventories now require authoritative `box.nfcIds`; index mirrors are checked against inventories by both language validators. | Contract resolved. Production recursive rebuild/reassignment UI belongs to later stages. |
| Do interrupted operations have defined outcomes? | ADR 004 records incomplete creation, photo orphan cleanup, inventory/index reconciliation and NFC transfer rules. | Recovery policy delivered. Production implementation and fault-injection checks remain later work. |
| Are unknown fields preserved and newer schemas protected? | Real Python/TypeScript source-preserving edit checks and version fixtures. | Local contract acceptance passed. |
| Can all browser NFC tags provide an identifier? | Official Chrome documentation distinguishes NDEF capability and possibly empty serial numbers. | Optional capability only; real hardware/byte-order interoperability checks pending. |
| Are QR deployment/route boundaries defined? | Shared origin/UUID/QR vectors reject unrelated origins, paths, malformed IDs and encoded/whitespace tricks. | Parsing contract passed; actual camera/deep-link UI belongs to later stages. |
| Will Drive independently index every item description? | Ordinary readable examples, folder/image naming and metadata policy defined. | No indexing/ranking promise; actual Google search observation pending live data. |

## Executed local verification

- Compiled the TypeScript contract modules under strict TypeScript checking.
- Validated 104 document/identifier/version fixtures and six library consistency fixtures using independent Python and TypeScript validators; compared complete results across implementations.
- Checked source-preserving item edits at document/box/item extension levels, immutable item IDs, read-only newer versions, published schema aliases and manifest hashes.
- Exercised 11 prototype tests: token destination, late callbacks, account-switch responses, expiry/denied scopes, Google 401, popup errors, aborts, fail-closed scratch writes, simulated stale conditional writes, inventory/index races and number allocation.
- Checked the local server's read-only asset allow-list, including blocked `.git`, environment and traversal paths.

All Google behaviours above were tested against mocks or researched in official documentation, not against a live account. No OAuth credentials or real inventories were needed or stored.

## Live acceptance still required

Use [Google setup and live verification](google-setup.md). Record a result for each item below before closing the corresponding gate:

- [ ] Operator configures one public web client ID and registered localhost origin, enables Drive API and adds ordinary consent test users without granting project/IAM roles.
- [ ] Verify popup login/consent, token-memory boundary and direct browser Drive requests.
- [ ] Verify denial, token expiry/renewal, local sign-out and external/in-app revocation.
- [ ] Verify separate-account isolation using the same web client ID and at least two accounts without Cloud billing/project membership, including switching during an active request.
- [ ] Verify existing nested folders, external edits and a second compatible deployment with the selected scope.
- [ ] Verify conditional media/metadata writes from independent sessions; missing strong ETag or ignored preconditions fails the candidate.
- [ ] Verify index number claims after conflict/reload and final data preservation.
- [ ] Resolve safe root-index bootstrap, duplicate authoritative filenames and cross-file number/NFC coordination before production mutations.
- [ ] Check camera/Web NFC availability and real tag serial byte order on supported hardware.
- [ ] Observe Drive search/discoverability without claiming universal JSON indexing.

Stages 3–5 have since delivered their local implementation/checks against the shared contracts. Stage 5 live authentication/scope and same-registration account acceptance and Stage 7 production write/uniqueness acceptance remain gated. If the Drive primitive is unavailable, choose and verify another design rather than silently weakening conflict protection.

## Sources consulted

- [Google GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google GIS code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google authorization JavaScript API](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [Google application/cross-client registration](https://developers.google.com/identity/protocols/oauth2/cross-client-identity)
- [Drive API limits and pricing](https://developers.google.com/workspace/drive/api/guides/limits)
- [Google Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive file metadata/version](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [Drive update method](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
- [Drive file listing](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [Drive file search](https://developers.google.com/workspace/drive/api/guides/search-files)
- [Chrome Web NFC](https://developer.chrome.com/docs/capabilities/nfc)

## Live single-account follow-up — 4 October 2026

Live login, consent, account lookup and direct Drive root/file operations succeeded for the requested account. Inventory and index metadata/media exposed no strong browser-visible ETag. The candidate write experiment stops at this failed prerequisite; no atomic update, stale-write rejection or independent-session race is claimed. See the [Stages 1–7 account test record](stages-1-7-account-test.md).

## Coordinated creation follow-up — 4 October 2026

New-box creation and empty-library initialization now use live-tested Drive v2 conditional writes, fixed generated IDs and a durable root owner. Independent sessions demonstrated one successful number claimant and explicit rejection of the competitor; a fresh proposal then created the next number. See [decision 007](decisions/007-coordinated-creation.md) for endpoints, interoperability and retained interruption limits. Existing-box editing, photo/NFC mutations and index recovery publication remain gated.
