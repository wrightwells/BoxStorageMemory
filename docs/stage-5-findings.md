# Stage 5 verification

Date: 4 October 2026. Stage 5 implementation and local checks are complete. At the original local-only run, live Google acceptance was pending operator OAuth configuration and disposable accounts. See the live follow-up below for subsequent evidence. Mocked tests do not establish consent, real account isolation, CORS, scope reach or atomic-write support.

Registration design revision: [ADR 006](decisions/006-application-oauth-registration.md) and technical v1.1 assign setup to the operator/publisher. The same deployment web client ID is used across account switches; only account/root/token runtime contexts change. Ordinary-user login/root setup includes no Cloud project, client-ID creation, IAM membership or payment-card input. Missing registration is reported as an operator setup issue. The account-isolation test explicitly checks both accounts use the same configured client ID; it is mocked evidence, not live Google acceptance. Schema/API versions are unchanged.

Delivered:

- Google Identity Services browser token flow, loaded before the user gesture; required-scope checks, proactive expiry with a five-second margin, renewal/account chooser, consent/popup failures, local sign-out and separate revocation. Tokens never enter observable state or browser storage.
- Typed client for all seven Stage 4 operations using fixed same-origin routes, no credentials, no redirects, and public compatibility checks before enabling login.
- Direct Drive account identification, paginated folder browsing, manual folder-ID selection (including shared folders), and explicit empty-root creation. Creation does not bootstrap inventory/index files or blindly retry ambiguous results. Confirmed creation followed by selection failure is reported separately.
- Root-bound folder/file lookup, ancestry checks, coherent metadata/content/metadata JSON reads, image downloads and object URL cleanup. Duplicate filenames, incomplete listings and changing versions fail explicitly. Candidate ETags are observations, not proof of atomic writes.
- Four simultaneous Drive requests maximum; bounded read backoff for transient network, rate-limit 403/429 and 5xx failures; cancellation and timeouts. Writes are never blindly retried.
- Generation checks reject responses finishing after account/root changes, including delayed body parsing. Context changes clear folder/photo runtime state. Only the last successfully selected folder ID is saved under an account-specific preference key; storage denial does not prevent use.
- Accessible login/settings/root setup, loading/error states, connection retry and read-only root indication. Inventory/photo mutation adapter methods fail closed behind the Stage 1 write gate, with no caller or configuration override. Stage 7/8 must complete live write/bootstrap verification and recovery before enabling them.

Automated frontend tests cover connection workflows, token destination restrictions, denied/partial consent, invalid/proactive expiry, Google 401, late callbacks/responses, remote revocation failure, concurrency, backoff, pagination, ancestry, coherent reads, duplicate files, photo URL cleanup, ambiguous root creation, write gates, API compatibility, token-free API calls and account-scoped preferences.

Verification completed:

- Frontend: **44 tests passed** (existing route tests plus 33 service/connection tests); ESLint, repository Prettier check, TypeScript and production build passed.
- Backend: **105 tests passed**; Ruff lint/format, strict mypy and versioned OpenAPI freshness passed. The existing Starlette TestClient/httpx deprecation warning remains.
- Shared Python/TypeScript fixture parity and Stage 1 prototype tests passed. Node's test runner reports each test file as one top-level test; these files execute their existing document/identifier/library vectors and prototype assertions.
- Updated Docker image built successfully. An isolated Compose deployment on a temporary loopback port passed frontend/deep-route/assets/API smoke checks, became healthy, ran as UID 10001 with a read-only filesystem, and was removed afterward. No existing deployment was changed.
- Source inspection confirmed the only browser storage access is the account-scoped folder preference service and the only Google bearer-header attachment is in the destination-restricted Google transport. Client services contain no console logging.

No real Google account or library was used. Live browser/account acceptance has not been performed.

Registration revision checks, 4 October 2026: all **44 frontend tests** passed after the operator-facing setup message and explicit same-client-ID account assertion were updated; frontend lint/format/types/build, backend lint/format, OpenAPI freshness, prototype checks and shared contract parity passed. Documentation links, the technical v1.1 configuration example against the implemented public response model, and `.env.example` syntax were checked. The previously recorded Docker/Python results above remain historical; no new live Google test is claimed by this revision.

Remaining acceptance: run [the application live checklist](google-setup.md#stage-5-application-setup-and-live-checks) with two ordinary disposable accounts without project membership or Cloud billing setup, authorizing the same configured application, and record observations without credentials. Existing Stage 1 scope/CORS and atomic-write gates remain open. Box views belong to Stage 6. Production Google publishing and CSP/proxy verification remain later deployment work. The chooser browses My Drive; shared folders/Shared Drives can be selected by ID but are not separately catalogued. The selected root is an application traversal boundary, not an OAuth permission boundary.


Login diagnostics update, 4 October 2026: the operator supplied a public web OAuth client ID, which was configured in ignored local `.env`; the running Docker API exposes that configured ID. The user reported granting the full Drive scope followed by a 403 displayed as folder-permission denial. The actual Google response reason has not been observed, so a disabled API remains a hypothesis rather than a verified cause. The transport now distinguishes legacy/modern API-disabled and insufficient-scope reasons plus Workspace domain policy from ordinary file/account permission failures. It displays only fixed allow-listed messages, never raw Google response contents. A connection regression test covers API-disabled `about` lookup before any folder request. **130 frontend tests**, types, lint, formatting, production build and Docker image build passed. Historical live atomic-write/bootstrap gates remain open. See [login troubleshooting](google-setup.md#consent-succeeds-but-drive-login-is-denied).

## Live single-account follow-up — 4 October 2026

Operator OAuth is now configured. Live login/consent, account identification, folder listing, disposable-root creation/selection and same-account root preference restoration succeeded. The audited stateless API requests had no authorization header; authorization was observed only on Google Drive requests. Browser storage contained one account-scoped root preference and no session-storage entries. Two-account isolation, real expiry/revocation and broader browser acceptance remain unverified. See the [account test record](stages-1-7-account-test.md).
