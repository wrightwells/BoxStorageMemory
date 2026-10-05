# IMG-001 — Photo recognition in the inventory table

## Analysis and proposed change

Current UX: the box details table shows names, quantities, descriptions and a photo-management icon. Users open an item to see photographs. The approved persistent navigation remains Control A; CTX-001 search restoration stays a separately selectable preview.

Hypothesis: a small first-photo preview in the table lets users identify the correct item with fewer detail-page visits. The table remains appropriate for comparing structured inventory. Variant B adds photo recognition in the existing photograph column, without changing the editor, item-details photo management, QR/NFC actions or storage workflows.

Implementation: a reusable inventory thumbnail component, bounded photo-read queue, scoped CSS and independent runtime flag. Only the first listed photograph is previewed, using the existing authenticated client-only Drive adapter. Links open item details. Image-free rows retain their photo-management button and gain a “No photographs” cue. The normal control continues to show its existing icons and text.

Preview reads begin near the viewport (120px margin), with at most three concurrent reads per library service. Leaving that area cancels queued reads and releases owned blob URLs; a late in-flight result is released rather than displayed. Navigation, sign-out and rollback clean up previews. Failed reads or image decoding show a retry action while keeping the item link usable. Browsers without IntersectionObserver still use the bounded queue. These are display thumbnails of original images: full first-photo bytes are fetched, not newly generated small Drive files. Performance evidence is needed before promotion; no images are changed or written.

## Experiment metadata

| Field | Definition |
| --- | --- |
| Experiment | IMG-001 |
| Control A | Approved navigation and current inventory table with photo icons. |
| Variant B | Same table with first-photo previews linking to item details. |
| Population | Invited testers; 0% automatic rollout. |
| Primary metric | Time to correctly identify and open a specified item from box details. |
| Secondary metrics | Detail-page visits, thumbnail opens, successfully decoded previews, preview failures, task completion. |
| Guardrails | Wrong selections, readability, touch/keyboard access, network/memory cost, image cleanup, save integrity and account/library isolation. |
| Start | Functional checks pass; testers consent to local measurements. |
| End | At least 10 counterbalanced A/B usability sessions on representative devices; exploratory evidence. |
| Proposed success threshold | At least 15% lower median identification time, fewer unnecessary detail visits, no lower completion or material guardrail regression. |
| Rollback condition | Increased failures, excessive requests/memory, inaccessible actions, image/context leaks or operator request. |
| Result | Engineering verification below; no real-user results collected. |
| Decision | ITERATE — separate explicit approval required for promotion. |

## Runtime preview and rollback

Preview: <https://dell-linux-mint.bandicoot-pumpkinseed.ts.net/?photos=photo-recognition>. Control: `?photos=control`. This selection is independent of navigation `ui` and search `context`; previews can be combined explicitly. IMG-001 assignment uses its own sessionStorage key, with an independent allocation offset and an in-memory fallback when storage is blocked. Inventory/photo data is never stored in experiment assignment.

`config/ui-experiments.json` has `photoRecognition.enabled`, `rolloutPercentage` and `forceVariant` (`control`, `photo-recognition` or null). Disable the photo flag or force `control` for rollback without deployment. Open tabs poll every 15 seconds with a 5-second request timeout. Rollback restores photo icons and releases previews while retaining approved navigation and other independent settings. Invalid global configuration fails closed to the original safe interface.

## Local study and privacy

Measurement requires operator `measurementEnabled: true` and tester `&ux_measure=1`. `window.boxStoragePhotoUx` provides the same facilitated `startTask()`, `finishTask(true/false)`, `summary()` and `clear()` API as other experiments. Fixed counters record decoded previews, preview failures and thumbnail opens. No names, image bytes, filenames, record IDs, queries, account identifiers or URLs enter measurements. Counters stay in memory, clear on condition/account/library changes or consent withdrawal, and are never sent to the server.

Use equivalent target items and counterbalance variant order. A facilitator verifies correct identification; opening a thumbnail is not automatically a successful task. Observe mistaken selections, unrelated detail-page visits, confidence and loading delays. Measure network/memory cost in an isolated synthetic test session; do not export authorization headers or user records. Browser timings alone are not user preference evidence.

## Engineering verification

Verified on 5 October 2026:

- 330 frontend tests pass, including bounded concurrency, queued cancellation and draining after failure. TypeScript, ESLint, formatting and production build pass.
- 120 backend tests pass, including independent photo flag rollback and invalid configuration. Python lint/format/types, OpenAPI export and release package/manifest checks pass.
- 18 deployed browser checks pass across Chrome desktop, Firefox desktop and Chromium mobile layout: control icons, decoded preview, keyboard focus and touch size, failed-photo retry, item opening, blob URL release, viewport gating/re-entry, independent rollback, existing full workflow and CTX-001 restoration.
- Five complete responsive workflow checks pass at 320, 390, 768, 1024 and 1440 CSS pixels with photo recognition enabled. Phone/tablet screenshots were reviewed. The inventory table retains horizontal scrolling on narrow screens; testers should evaluate the cost of reaching the photograph column, rather than assuming thumbnails improve every device's workflow.
- Live IMG-001 flags were disabled through atomic file replacement, verified via the deployed API, then restored. Approved navigation and search flags remained unchanged. Final automatic rollout is 0%; measurement is off.
- HTTPS and host-IP smoke checks pass, and deployed OpenAPI matches its export.

Deployed image: `sha256:f84723e806edacadd4971686b9aff4160e2dfb4fa443bccba3b9b7048761e647`. These are engineering results, not real-user preference or full accessibility certification. IMG-001 remains **ITERATE** pending usability/performance evidence and separate explicit promotion approval. Synthetic fixtures perform no live Google Drive writes.
