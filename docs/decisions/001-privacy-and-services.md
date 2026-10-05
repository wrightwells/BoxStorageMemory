# 001 — Privacy boundary and service responsibilities

Status: Accepted. Implements technical §§2, 40, 79–82 and FR-AUTH/SEC/PORT requirements.

Google authorization and Drive requests run in the user's browser. The FastAPI application serves static content and token-free configuration, schema validation, QR generation and health endpoints. Version 1 search runs in browser memory. The separate native client uses the same published records and utility API but implements its own Google access.

OAuth registration is managed once for the application, with platform-specific clients. Each user authorizes their own Drive; users do not configure Cloud projects or billing. Shared application registration does not grant the Docker operator access to user tokens or libraries. See [decision 006](006-application-oauth-registration.md).

The server has no Google callback/token-exchange endpoint, Drive proxy, user credential store, inventory database or persistent search index. Voluntarily submitted validation documents may be processed temporarily; neither payloads nor images are logged or retained. A stateless validation API cannot establish whether a user owns a Drive record or whether another device has changed it.

## Interfaces

| Component | Responsibility and boundary |
| --- | --- |
| `GoogleAuthService` | User-gesture authorization, in-memory token lifetime, renewed consent/account selection, sign-out/revocation, generation-based cancellation. Tokens are private to this service and its Google transport. |
| `DriveStorageService` | Select/create root; paginate folder discovery; load index/inventory/images; compare snapshots; mutate files only under verified concurrency rules. No React dependencies. |
| Contract utilities | Pure validation, UUID/number rules, NFC normalisation, QR parsing, schema compatibility, source-preserving edits and library consistency checks. No network or token access. |
| `BoxStorageApiClient` | Configuration, schemas, validation, QR and health. Never attaches a Google bearer token; accepts no Google transport/interceptor. |
| Browser state | Account/root-scoped runtime index, records, drafts, search and photo URLs. Replaced or cleared on context change. |
| FastAPI routes | HTTP parsing and response/error mapping only; call framework-independent contract/utility services. |

Drive reads return a document plus file ID, Drive version and any verified conditional-write validator. The version belongs to the runtime snapshot, not inventory JSON. UI components invoke services instead of raw authenticated HTTP calls.

Account/root switches increment a context generation, abort pending reads where possible and ignore old responses. Sign-out clears tokens, drafts, index/search caches, previews and camera/NFC streams. Cancellation cannot undo an already accepted Drive write; an interrupted operation is re-read before retrying. Tokens, inventories and images are not put in cookies, local/session storage, IndexedDB or service-worker caches. An account-scoped root ID preference may be stored without a token.

The browser necessarily trusts the code supplied by its deployment. The no-token-server architecture removes the designed credential transport/persistence path; it cannot guarantee privacy against a malicious host that replaces that code. Deployments must serve reviewed code over HTTPS and avoid third-party scripts other than the required Google libraries.
