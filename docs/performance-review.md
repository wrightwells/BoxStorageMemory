# Performance Review Report

Review date: 5 October 2026. Baseline: commit `27af5e5` (`web ux revision 1`). Final deployed candidate image: `sha256:075cd77dddcc3f5d1dd5e0c191000ffa25fd99b2329c96aad18fb94dbd30bc1e`. Scope and requested working method are preserved in [the supplied prompt](performance-review-prompt.md).

## Subsequent Box Table Photo Change

After this performance review, the user requested photographs directly in box tables. Both table layouts now progressively show all attached item photos, including large/unknown-size originals; visible downloads still use the bounded queue and release URLs on exit. The 256 KiB deferral measured below is historical behavior of the reviewed candidate, rather than the current box-table policy. This functional choice increases photo transfer for large originals until Drive-hosted resized derivatives exist. Search/read/script measurements below describe the original review candidate and were not rerun for this later UI change.

## Executive Summary

The largest avoidable read bottleneck was search rebuilding data already validated by the current library/box reader. The deployed browser comparison reduced search requests from 31 to 10 and median readiness from 1,013.35 ms to 486.84 ms (52.0%). A separate nested-folder service fixture reduced fresh box requests from 16 to 13 and duplicate simultaneous opens from 24 to 10. Search queries against loaded records already used no Drive calls; that behavior is preserved.

Startup JavaScript unnecessarily included the schema compiler and photograph/scanner route code. Removing the compiler from browser imports, splitting secondary routes, and precompressing static build assets reduced entry-script response bytes from 652,605 to 145,903 (77.6%). The decoded entry script decreased to 507,747 bytes (22.2%). This did **not** improve measured shell visibility: median 320.11 ms before, 352.81 ms after. The browser's box-with-photo timing likewise did not improve, despite two fewer calls. The evidence supports request/transfer reductions and faster search, rather than a claim that every screen became faster.

Large or unknown-size originals are now deferred in table previews. The synthetic 3 MiB photo case transferred zero photo bytes in the table, versus 3,145,728 previously; the item details page still automatically loads the image. This is a transfer guard with a link to the item, not a new derivative-thumbnail system.

Creation, saves and photo writes retain the coordinated write protocol. Parallel independent final read proofs were implemented, but simulator measurements showed no meaningful write speedup. Real Google latency, real-account write performance, phone image encoding, and native Android/hardware NFC were not measured. Google Drive remains authoritative, browser credentials remain memory-only, and the server receives no Google tokens.

## Measurement Method and Baseline

Instrumentation was introduced before behavioral changes. The same workload definitions were run against the original implementation and final candidate. Raw numeric results are in [performance/](performance/). These files contain operation categories, elapsed times, counts and sizes; no tokens, account details, folder identifiers, query text or inventory contents.

There are three distinct measurement models:

1. **Deployed Chromium UI, five fresh browser contexts:** real application assets over Tailscale HTTPS, synthetic OAuth, two indexed boxes, small JPEG, and 20 ms delay per intercepted Drive request. Timing includes browser automation waits, rendering and transport; OAuth timings do not represent Google's interactive sign-in. This fixture uses directly nested box folders.
2. **Actual read services, five repetitions:** Google transport, Drive storage, library and search services with synthetic 20 ms HTTP responses and a two-box fixture containing a deeper garage folder. Known response byte counts are JSON body sizes, excluding HTTP/TLS overhead. Cached reads and matching measure service work, not UI paint.
3. **Write coordinator simulator, three repetitions:** 20 ms per v2 transport call, in-memory storage helpers, synthetic 1 MiB typed JPEG upload. Counts cover coordinator transport calls only, not all real Drive storage/helper calls. This does not measure image encoding, upload bandwidth, Google's server processing, or full live persistence latency.

Token-free deployed HTTP probes use five sequential samples and real response bytes. Backend processing is measured separately after changes with in-process TestClient. All tables use medians, except the explicitly labeled mean Drive-attempt spans. Five samples are a small controlled comparison, not a statistical significance study or a production percentile/SLA. Negative reductions indicate a slower measured result; they are not hidden.

### Deployed browser before/after

| Operation | Before (ms) | After (ms) | Elapsed reduction | Calls before → after |
|---|---:|---:|---:|---:|
| Shell visible | 320.11 | 352.81 | -10.2% | 0 → 0 |
| Synthetic sign-in + account/root selection | 350.00 | 272.75 | 22.1% | 3 → 3 |
| Fresh library usable | 381.15 | 380.03 | 0.3% | 7 → 7 |
| Open box, including small photograph | 962.04 | 991.94 | -3.1% | 19 → 17 |
| Search ready after viewing one box | 1013.35 | 486.84 | 52.0% | 31 → 10 |

### Nested read-service before/after

| Operation | Before (ms) | After (ms) | Elapsed reduction | Calls before → after |
|---|---:|---:|---:|---:|
| Fresh library | 148.43 | 152.81 | -3.0% | 7 → 7 |
| Fresh nested box | 346.52 | 279.98 | 19.2% | 16 → 13 |
| Cached box | 0.13 | 0.07 | 41.3% | 0 → 0 |
| Search ready after viewing one box | 497.12 | 218.50 | 56.0% | 35 → 10 |
| Warm text query | 1.10 | 0.78 | 29.4% | 0 → 0 |
| Two simultaneous opens of one box | 257.95 | 214.16 | 17.0% | 24 → 10 |
| Explicit box refresh (including index) | 493.64 | 427.69 | 13.4% | 23 → 20 |

Known read response bytes: fresh nested box 2,498 → 2,151; search after a viewed box 5,429 → 1,372; simultaneous opens 3,232 → 1,372; refresh 3,813 → 3,466. Fresh library remains 1,315 bytes and seven calls. Cached box/query remain zero bytes and zero requests. The added photo `size` field modestly increases individual listings while the removed duplicate reads decrease total bytes.

### Write coordinator before/after

| Operation | Before (ms) | After (ms) | Elapsed reduction | Calls before → after |
|---|---:|---:|---:|---:|
| Create box | 650.42 | 651.78 | -0.2% | 31 → 31 |
| Save normal edit | 477.45 | 483.31 | -1.2% | 23 → 23 |
| Add photograph | 596.92 | 631.28 | -5.8% | 27 → 27 |

No write-performance gain is claimed. The write fixture deliberately retains safety fences and does not impose RTT on storage helpers, where the final parallel verification may matter on a real network. The slower photo result is a measured result, not evidence of a changed codec or upload strategy. Full write-path live timing remains required.

### Deployed HTTP before/after

| Operation | Before (ms) | After (ms) | Elapsed reduction |
|---|---:|---:|---:|
| health | 17.62 | 21.23 | -20.5% |
| config | 20.80 | 18.68 | 10.2% |
| schema | 17.27 | 17.53 | -1.5% |
| html | 18.71 | 20.59 | -10.1% |
| entryJavaScript | 21.59 | 21.08 | 2.4% |

Entry JavaScript is now gzip encoded with 145,903 response body bytes rather than 652,605 identity bytes. CSS body encoding is also negotiated. Browser resource timing includes its resource overhead, so its 146,203-byte script transfer is not the same measure as HTTP body bytes. HTML increased from 610 to 697 bytes due to Vite chunk hints. API/schema responses retain identity transfer and `no-store`.

### Backend processing, after only

| Operation | TestClient total median (ms) | App to response headers median (ms) | Response bytes |
|---|---:|---:|---:|
| Health | 3.99 | 1.21 | 51 |
| Config | 7.07 | 1.92 | 368 |
| Validate inventory | 6.52 | 3.31 | 26 |
| Generate QR | 24.59 | 21.55 | 591 |

App construction measured 82.09 ms. TestClient total includes harness overhead; header timing excludes body transmission/socket/Google latency. No comparable baseline of isolated backend CPU was captured, so these are diagnostic measurements, not before/after CPU gains. Backend config bytes differ from deployed config because the test uses a localhost public URL.

## Architecture Review

Drive requests originate in the browser; the backend is not on the inventory read/write path. Google client/session setup therefore cannot be accelerated by a server-side authenticated connection pool. The browser's fetch transport retains origin restrictions, cancellation, a bounded queue, and normal browser connection management. Root containment, before/after file coherence, and the v2 conditional write coordinator account for intentional serial round trips; removing them would change the consistency model.

FastAPI constructs its utility service and schema mappings during application setup rather than per validation request. Synchronous validation/QR handlers use FastAPI's normal worker-thread execution; stateless public configuration/validation/QR work does not wait on Google. Middleware enforces the existing origin/body/rate/security rules and logs only safe request categories. Current measured backend header times do not justify an architecture rewrite. Static file compression was the demonstrated delivery opportunity. Memory usage, production concurrent throughput, frontend main-thread CPU breakdown, and real Google connection latency were not separately profiled and remain evidence gaps.

## Bottlenecks Ranked P0–P3

| Priority | Finding and baseline evidence | Expected benefit before implementation | Result / decision |
|---|---|---|---|
| P0 for photograph-heavy boxes | A 3 MiB original downloaded for one small table preview | Avoid the entire original transfer when size exceeds a safe preview budget | Zero preview image GETs/bytes for the same case; full item image preserved |
| P1 | Search's separate reader reread the index and previously opened inventories: 35 calls in nested service fixture / 31 in browser | Reuse session read data; approximately ten calls for only the remaining box | Ten calls in both fixtures; search readiness 52% faster in browser |
| P1 | Browser entry shipped runtime schema compilation and secondary route functionality; 653 KB uncompressed transfer | Remove compiler, split infrequent routes, compress static assets | 507,747 bytes decoded; 145,903 gzip body bytes; shell timing did not improve |
| P2 | Box open independently retrieved folder metadata and listed children, repeating ancestry; two concurrent opens doubled work | One fresh folder validation/list sequence and one in-flight box load | Nested box 16 → 13 calls; concurrent pair 24 → 10 |
| P2 | Independent final write verification reads ran serially | Overlap final read proofs without altering writes or ownership checks | Implemented; no measurable simulator write gain |
| P3 | No safe operation-level timing available to explain loading states | Expose opt-in numeric diagnostics without collecting content | Bounded browser samples and optional server timing; defaults off |

The initial library already reads its root index rather than every inventory/photo. No measured justification exists for replacing it, adding a database, or putting authenticated Drive caching on the server.

## Google Drive API Analysis

The read service sequence consists of the seven workloads above, repeated five times. Counts below are per complete sequence; average latency is the mean instrumented attempt span in the 20 ms synthetic model, not observed Google latency. Queue spans are excluded. Attempts include parsing and, when applicable, retry handling; overlapping spans must not be summed into UI elapsed time.

| Interaction | Calls per sequence, before → after | Mean span ms, before → after | Known response bytes per sequence, before → after |
|---|---:|---:|---:|
| drive.metadata | 87 → 48 | 21.16 → 21.12 | 10371 → 5704 |
| drive.list | 9 → 6 | 21.33 → 21.15 | 2319 → 1574 |
| drive.media | 9 → 6 | 21.14 → 21.26 | 3597 → 2398 |

| Interaction | Endpoint | Required / reuse / concurrency policy |
|---|---|---|
| Account identity | v3 `GET /about?fields=user(...)` | Once during synthetic connect/root flow; account/root flow totals three calls. Not repeatedly performed for each box/query. No production OAuth RTT claim. |
| Folder/file metadata | v3 `GET /files/{id}?fields=...` | Fresh for root containment and JSON before/after coherence. Never metadata-cached/coalesced across these safety checks. Parent chains remain serial because each parent is learned from the preceding response. |
| Folder listing | v3 `GET /files?q=parent...&fields=...` | Necessary to discover index/inventory/photo names and duplicates. Paginated at 100 files; repeated/cyclic page tokens and incomplete searches rejected. Independent box loads can overlap within the bounded queue. |
| Inventory/index/media read | v3 `GET /files/{id}?alt=media` | Fresh JSON reads validate ancestry and version before/after. Read-only validated box/index snapshots may be reused in session; photo URLs released when reset/unmounted. |
| Creation/photo upload | v3 upload `POST /files?uploadType=multipart` plus coordination transport | Required ownership-marked disposable/pending resources; no automatic ambiguous-write retries. Coordinator fixture counts do not enumerate all live storage-helper calls. |
| Conditional publication/locks | v2 metadata/media endpoints with ETag conditions | Required CAS/ownership and coherent inventory/index publication; cannot replace with cached metadata. Independent final proof reads now overlap and all settle before release. |

Partial fields retain ID/name/type/parents/version/modified time/description/ownership properties needed by reads and writes, with `size` added to avoid large originals. No wildcard metadata response, account-wide inventory traversal on normal opening, repeated query-driven authentication, or background polling was added. Transport remains bounded at four active requests, search inventory workers at three, and table image workers at three. Read attempts retain at most two retries after the initial request for eligible network/429/transient errors, exponential delay/jitter and bounded Retry-After. Mutation ambiguity is surfaced rather than blindly replayed.

## Changes Implemented

### Session reuse and box request coalescing

**Problem/cause:** independent search loading discarded already validated read work; concurrent callers could open the same box twice. **Change/files:** `frontend/src/services/library.ts`, `search.ts`, and `drive.ts` copy read snapshots into a private search reader, coalesce one pending box load, and provide `folderContents()` returning the fresh checked folder together with its listing. **Before/after:** nested box 346.52 → 279.98 ms (16 → 13 calls); search 497.12 → 218.50 ms (35 → 10); concurrent opens 257.95 → 214.16 ms (24 → 10).

**Trade-off:** read views may reflect a session snapshot until explicit refresh, as before. Search seeding is allowed only for index/boxes read within 60 seconds; it checks the same auth generation and root, and transfers no controllers, drafts or image URLs. This age bound controls copying, not a blanket TTL on every existing screen. Independent search cancellation is retained. Failed or context-obsolete pending loads cannot populate a new session. Writes/edit preflight still read fresh evidence.

### Browser runtime split and static delivery

**Problem/cause:** pure helpers imported the runtime AJV compiler alongside schemas even though browser validators were precompiled; all routes were eagerly imported; static scripts lacked negotiated compression. **Change/files:** new `shared/typescript/contract-core.ts`; public Node-compatible adapter in `contracts.ts`; browser service imports/validation updated; `App.tsx` lazy-loads photo and QR/scanning/NFC views with `Layout.tsx` Suspense around the outlet; `tools/compress_web_assets.mjs`, frontend build script, Dockerfile and backend asset route serve build-time gzip.

**Before/after:** entry script 652,605 → 507,747 decoded bytes, transferred as 145,903 gzip bytes. **Trade-off:** secondary routes fetch their chunks on demand with a visible loading status. Providers/navigation and unsaved draft guard remain outside Suspense. A tested dynamic-compression attempt increased asset request latency to roughly 40 ms, so it was removed; final precompressed asset request median is 21.08 ms versus baseline 21.59 ms. Hashed assets are immutable, HTML remains `no-cache`, and private API responses remain `no-store`; correct `Vary: Accept-Encoding` and gzip quality negotiation are tested. The entry bundle still exceeds Vite's 500 KB warning threshold. Further splitting remains an opportunity rather than a claim of solved startup CPU.

The public `ContractValidator` constructor still supports existing Node consumers and the same shared vectors. The release includes its new core dependency; no v1 schema, identity, QR/NFC meaning or API contract is changed.

### Table image transfer budget

**Problem/cause:** lazy table loading limited when/how many photographs loaded, but not their byte size. **Change/files:** `PhotoRecognition.tsx`, `library.ts`, and `drive.ts` use a 256 KiB preview budget, check known size on fresh list/metadata, and verify Blob size before publishing an object URL. Oversize/unknown-size previews show “Open item to view photo”; the item link remains available. **Before/after:** three identical 3 MiB cases each fall from one original GET / 3,145,728 bytes to zero / zero. Full item image loading is separately verified.

**Trade-off:** this does not generate resized derivatives. Small originals within the budget can still be used as previews; oversized originals are no longer fetched merely for a table thumbnail. A 32 px JPEG padded to 3 MiB models transfer, not a phone decoder workload. Google documents that `thumbnailLink` is short-lived, unsuitable for direct web use due to CORS, and private thumbnails require credentialed fetching; see [the official Drive files reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files). A backend proxy would change the token trust boundary, so it was not introduced. Drive-hosted client-generated thumbnail sidecars require a separate coordinated resource/cleanup design.

Existing upload processing is preserved: optional resize caps the long dimension at 2,560 px, JPEG quality 0.9, input limit 25 MiB, decoded limit 40 million pixels, with original preview URLs released on replacement/leave. `photo.prepare` now measures the browser preparation phase. No before/after real photo encoding or mobile decode measurement was captured, and no upload-compression speedup is claimed.

### Parallel final proofs and write integrity

**Problem/cause:** final verification of independent index/inventory/QR evidence was serial. **Change/files:** `creation.ts` drains independent read checks with `Promise.allSettled`, preserving deterministic rejection and waiting for every check before releasing markers/ownership. **Before/after:** coordinator simulator timings/calls remain effectively unchanged in the table above.

Creation still validates locally, acquires/initializes a verified index, creates pending-owned folder/marker/draft inventory/Drive-folder QR, claims a number, conditionally publishes inventory/index and performs final proof before cleanup. Required writes are ordered. Editing still preserves unknown fields and IDs, sends the complete small inventory JSON, checks fresh snapshots, and reconciles both inventory/index. Debounced partial writes or optimistic “saved” state would weaken coherence and are not used. Busy/disabled actions prevent duplicates; failures retain drafts and partial outcomes. Upload writes retain ownership/cleanup/recovery checks. Ambiguous requests are never automatically repeated.

### Privacy-preserving diagnostics

**Change/files:** `services/performance.ts`, Google/API/library/search/photo processing, `main.tsx`, backend config/logging. Browser `?perf=1` exposes `window.boxStoragePerformance.summary()` containing at most 1,000 numeric/category samples in memory. It captures duration, status, retry index, known response bytes, list result count and library cache hit/miss; unknown byte sizes stay `null`. Clear/reset epochs suppress obsolete completion samples. No URL/identifier/query/header/content is recorded, and no analytics request or persistent diagnostics store exists. Token and root changes clear the samples.

Backend `PERFORMANCE_TIMING=true` optionally emits `Server-Timing: app;dur=...`; default is false. Existing safe route-template/method/status timing logs stay token-free. Compose does not automatically forward this setting: an operator must explicitly add it to the service environment using an override. App timing measures to response headers rather than total streamed transfer. Browser operation totals overlap transport spans, so their difference is not a reliable pure frontend CPU metric.

## Cache and Change Detection Strategy

| Layer | Stored / scope | Freshness and invalidation |
|---|---|---|
| Authentication | Browser memory only | Sign-out, expiration/account change clear token/generation; no server token store |
| Library/read cache | Validated index, box snapshots/file IDs/versions in session memory | Root/account changes abort and clear; explicit Refresh reloads; successful mutation invalidates readers; no persistent inventory cache |
| Search index | Derived searchable records and private reader in current session | Recent source snapshots seeded once; source revision changes reset; explicit Refresh rereads; incomplete failures stay visibly incomplete |
| Images | Browser object URLs, bounded preview/download queue | Fresh photo filename listing and containment checks; revoked when views/session release; large preview deferred |
| Static assets | Browser/proxy cache of public hashed JS/CSS | Immutable names; HTML revalidates; API stays no-store |
| Backend | Public configuration/schema validators | No authenticated Google client, inventory cache, credentials or external database |

The authoritative root index already provides IDs/names/locations without scanning every folder. Normal library opening does not download every inventory or any image. A known UUID from QR, direct URL, NFC mapping, library or search resolves through that index to its folder, avoiding recovery traversal; without the session index, a root index read is still required because a UUID is not a Drive folder ID. Recovery explicitly enumerates folders only when requested.

Search loads remaining indexed inventories progressively with bounded workers, builds searchable records once, and matches subsequent query changes in memory. Modification versions detect changes on fresh reads; explicit refresh checks external Drive edits. No Google Changes API cursor or automatic background refresh was introduced: it adds cursor/error/account-scoping complexity and has no measured benefit for this two-box baseline. Large-library performance is not established by these fixtures. Save invalidation still refreshes the index as part of the integrity protocol; targeted merging without verification is not substituted.

## Performance Targets

| Target | Current evidence / limitation |
|---|---|
| Shell <500 ms | Controlled median 352.81 ms; first cold sample 457.67 ms after; no slow-device guarantee |
| Cached library <1 s / box <500 ms | Existing read cache; measured box service 0.07 ms; full cached-library UI not separately benchmarked |
| Fresh library <2 s | Controlled browser 380.03 ms, seven calls; real Google RTT unavailable |
| Uncached box <1.5 s | Controlled box with small photo 991.94 ms; nested service 279.98 ms; real account/network may exceed target |
| Search query <200 ms | Warm service query 0.78 ms, zero calls; full search initial readiness 486.84 ms and visibly progressive |
| Normal save perceived <1 s / new box <2 s | Simulator 483.31 / 651.78 ms; these are not full live Drive writes. Never show unconfirmed persistence as saved |
| Input <100 ms | Existing local fields/loading feedback retained; no measured main-thread percentile/INP claim |

## Regression Testing

Final results and deployed endpoint checks are recorded below after completion. Tests use synthetic Google accounts/transport rather than performing writes to the user's real Drive. Coverage includes account/root switching and cancellation, token expiration/revocation, stale/duplicate/moved records, CAS conflicts and ambiguous writes, creation/editing, search, photo handling, QR/NFC mapping, direct routes, responsive/keyboard UI, strict CSP, token-free API, contract vectors and release compatibility. Native Android and hardware NFC acceptance remain external checks.

- Frontend unit/integration: **337 passed, 2 opt-in profiling tests skipped**.
- Backend: **123 passed**, including static gzip negotiation/header parity, default-off server timing, API security/transport and application workflows.
- Browser regression on the deployed candidate: **107 passed, 6 opt-in profiling tests skipped, one runtime-flags timeout** across Chromium desktop, Firefox desktop and Chromium mobile layout. The single context-restoration case subsequently **passed three consecutive isolated repeats** unchanged. This is recorded as an intermittent test timeout rather than claiming an entirely green full-suite run.
- Dedicated browser performance profiles: **2 passed**, including table transfer deferral and full item photograph loading.
- Contract vectors, release-package checks, frontend typecheck/lint/format and backend Ruff/mypy checks passed.
- LAN `http://10.10.1.8:8080` and Tailscale HTTPS health/page checks return 200; deployment remains available at both origins.


The first final unit run exposed view-fixture mocks bypassing the newly combined folder/list helper. Both fixture entry points now mock that helper using their existing containment/list implementations; actual Drive read/profile tests exercise the real transport. A prior responsive browser test assumed authorization survived a full reload; it now reauthorizes through Settings, matching the required memory-only token model.

## Reproduction and Live Follow-up

From the repository root, with dependencies installed:

```bash
BSM_PERF_OUTPUT=/tmp/read.json npm --prefix frontend test -- tests/performance-review.test.ts
BSM_WRITE_PERF_OUTPUT=/tmp/write.json npm --prefix frontend test -- tests/creation.test.ts
BSM_BASE_URL=https://dell-linux-mint.bandicoot-pumpkinseed.ts.net \
BSM_CHROME_PATH=/usr/bin/google-chrome PLAYWRIGHT_BROWSERS_PATH=/tmp/bsm-playwright \
BSM_BROWSER_PERF_OUTPUT=/tmp/browser.json BSM_THUMBNAIL_PERF_OUTPUT=/tmp/thumbnail.json \
npm run test:browser -- --grep 'PERF controlled browser|PERF large thumbnail' --project=chromium-desktop --workers=1
python3 tests/performance/http_profile.py --origin https://dell-linux-mint.bandicoot-pumpkinseed.ts.net --output /tmp/http.json
PUBLIC_URL=http://localhost:8080 .venv/bin/python -m tests.performance.backend_profile > /tmp/backend.json
```

Profiling tests are opt-in and skipped in normal regression runs. Run the read/browser profiles separately from other CPU-heavy work to reduce interference. Restore the baseline implementation in an isolated checkout for new comparisons; do not overwrite production data or private configuration. The saved baseline/final raw results provide the comparison for this review.

For real-account follow-up, use `?perf=1`, sign in normally without sending a token to this server, clear the in-memory samples, and time library, nested box, cold/warm search and explicit refresh. Inspect only numeric summaries. Time disposable box/item/photo writes while checking actual persistence and request count; never rerun a partial creation without reconciling its confirmed resources. Measure a real phone photo's selection/encode/upload/preview separately, repeat on mobile and a throttled connection, then remove diagnostics. Those measurements cannot be inferred from synthetic OAuth or 20 ms fixtures.

## Remaining Opportunities

- Real Google/account/network and larger-library baseline is the next evidence gap, especially creation/save/photo paths. In-process simulation cannot establish those targets.
- Generate Drive-hosted small thumbnail sidecars during authorized photo saves, with schema/ownership/cleanup/unknown-client behavior explicitly designed and verified. Current preview deferral reduces transfer but cannot display every large original as a tiny preview.
- Split more of the 507 KB entry bundle, profile actual main-thread startup/INP/large DOM behavior, and consider virtualization only when real item counts demonstrate a need. Existing accessibility/draft guards must survive splitting.
- Evaluate incremental version-aware search reloads or scoped Changes API cursors only after measuring a large library and defining cursor recovery/account reset behavior. Do not persist Google tokens or inventory on the server.
- Profile image encoding off the main thread and resumable uploads with real phone samples before changing the codec/protocol. Ownership verification, interruption behavior and uncertain outcome reconciliation remain necessary.
- Consider further write protocol round-trip reductions only with a separately reviewed coherence proof and real before/after measurements. Safe final verification and fresh ancestry are intentionally preserved.
