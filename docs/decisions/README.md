# Architecture decisions

Initially recorded: 3 October 2026. These decisions supplement the functional specification v1.0. The [technical specification v1.1](../Technical%20Specification.md), revised 4 October 2026, incorporates the application-registration clarification and selected browser token flow; other recorded implementation/data decisions remain applicable.

Decision 006 was added on 4 October 2026 to clarify application registration and ordinary-user onboarding.

| Decision | Status |
| --- | --- |
| [001 — Privacy and service boundaries](001-privacy-and-services.md) | Accepted implementation boundary |
| [002 — Google authorization and Drive access](002-google-authorization.md) | Documented flow selected; live verification pending Google configuration |
| [003 — Identity, ownership and rebuildable data](003-data-and-identity.md) | Accepted v1 contract |
| [004 — Concurrency and interrupted operations](004-writes-and-recovery.md) | Recovery rules accepted; creation primitives verified in decision 007; other mutation gates open |
| [005 — Browser capabilities and deployment URLs](005-browser-and-urls.md) | Capability-based design accepted; real hardware checks pending |
| [006 — Application registration and user onboarding](006-application-oauth-registration.md) | Accepted: shared app project, platform-specific clients, no per-user Cloud/payment setup |
| [007 — Verified coordinated box creation](007-coordinated-creation.md) | Accepted for initialization and creation using live-tested v2 CAS |
| [008 — Coordinated existing-box editing](008-coordinated-editing.md) | Ordinary box/item saves use the shared owner and conditional v2 writes |
| [009 — Coordinated photo management](009-coordinated-photos.md) | Photo operations share the root owner and verified conditional writes |

An accepted contract is not evidence that an external integration has passed. See [Stage 1 findings](../stage-1-findings.md) for executed checks and remaining gates.
