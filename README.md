# BoxStorageMemory

An online box inventory library backed by ordinary Google Drive folders, JSON inventories and item photographs. Google access belongs to the client; the Docker service will not receive Google OAuth tokens or maintain a central inventory database.

Development follows [plan.md](plan.md) and the [technical specification v1.1](docs/Technical%20Specification.md). Stages 1–2 provide architecture decisions, an isolated Google integration prototype, v1 schemas, cross-client identifier rules and executable Python/TypeScript contract checks. Stage 3 adds the runnable FastAPI/React skeleton, container deployment and CI. Stage 4 delivers token-free public configuration, schemas, validation and PNG QR generation, with versioned OpenAPI. Stage 5 implements browser authorization and account/root setup. Stage 6 adds read-only library, box/item/photo views and index recovery previews. Stage 7 adds in-memory creation/edit forms, validation, and gated mutation/reconciliation services verified with an atomic simulator. Stage 8 adds file/camera selection, JPEG previews and gated photograph mutation/recovery controls. Stage 9 adds progressive global search, item navigation and derived Drive descriptions. Stages 10–12 add labels/scanning, optional NFC workflows, HTTPS/security packaging and the independent-client handoff. This candidate supports live box creation through verified index initialization and coordinated Drive v2 writes. Ordinary box/item saving uses coordinated v2 writes; photo management uses coordinated writes; NFC mutation and recovery publication remain gated. Native Android development is a separate project.

Operators can start the application locally with `docker compose up --build --wait`, then open `http://localhost:8080`. See [development instructions](docs/development.md) for local setup, configuration and required checks. Sign-in requires one operator-configured public web OAuth client ID and registered trusted origin; ordinary users need only their Google account, with no Cloud project or payment-card setup. See [Google setup](docs/google-setup.md#stage-5-application-setup-and-live-checks). See [browsing and recovery instructions](docs/library.md). [Creation/editing drafts](docs/editing.md) support verified new-box creation; ordinary box/item saves are available; rebuilt-index replacement remains gated; list thumbnails remain pending a compatible client-only implementation.

- [Architecture decisions](docs/decisions/README.md)
- [Application registration: no per-user Cloud/payment setup](docs/decisions/006-application-oauth-registration.md)
- [Integration findings and pending live gates](docs/stage-1-findings.md)
- [Shared data contracts and test commands](docs/contracts.md)
- [Google setup and live prototype instructions](docs/google-setup.md)
- [Stage 4 verification](docs/stage-4-findings.md)
- [Stage 5 verification](docs/stage-5-findings.md)
- [Stage 6 verification and remaining gates](docs/stage-6-findings.md)
- [Stage 7 verification and remaining gates](docs/stage-7-findings.md)
- [Stage 8 verification and remaining gates](docs/stage-8-findings.md)
- [Release acceptance and remaining limits](docs/release-acceptance.md)
- [Production deployment and recovery runbook](docs/deployment.md)
- [Independent-client integration](docs/client-integration.md)
- [Release notes and compatibility](docs/release-notes-1.0.0.md)
- [QR/NFC usage](docs/qr-nfc.md)
- [Stage 10 verification](docs/stage-10-findings.md)
- [Stage 11 verification](docs/stage-11-findings.md)
- [Stage 12 handoff](docs/stage-12-findings.md)
- [Stage 9 verification and remaining gates](docs/stage-9-findings.md)
- [Search and independent Drive context](docs/search.md)
- [Photograph management and recovery](docs/photos.md)
- [Creation/editing and interrupted-operation review](docs/editing.md)
- [Browse libraries and preview index recovery](docs/library.md)
- [Modern UI/UX development prompt](docs/modern-ui-ux-prompt.md)
- [Reference-based box workspace](docs/reference-box-experiment.md)
- [Photo recognition experiment](docs/photo-recognition-experiment.md)
- [Search-context experiment](docs/search-context-experiment.md)
- [UX experiments, runtime controls and study workflow](docs/ux-experiments.md)
- [Stateless API integration guide](docs/api.md)
- [Versioned OpenAPI](api/v1/openapi.json)
- [Versioned schemas](schemas/v1/manifest.json)
- [Sample library](examples/library/box-storage-index.json)

To open the disposable Stage 1 prototype:

```bash
python3 tools/serve_stage1.py
```

Then open `http://localhost:8765/prototypes/stage1/index.html`. Google setup and live concurrency verification are still required; automated simulations do not prove Drive's atomic write support.


Existing-box save follow-up (4 October 2026): ordinary box/item additions, updates and removals now use the coordinated v2 protocol in [decision 008](docs/decisions/008-coordinated-editing.md). Photo management now uses the same owner and conditional writes. NFC mutation, recovery publication and automatic interrupted-operation recovery remain gated. This supersedes the earlier existing-box-save limitation above.
