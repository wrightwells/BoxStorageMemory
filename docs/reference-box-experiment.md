# REF-001 — Box workspace based on the supplied reference

## Design and scope

The user's image is the visual basis for this iteration: blue cube branding, a prominent search field, breadcrumb, cardboard box symbol, box title and summary, Edit Box/Add Item actions, underlined section tabs, and a structured table with an early photograph column and compact row actions. The user approved this layout as the primary baseline on 2026-10-05. Persistent navigation remains enabled; CTX-001 and IMG-001 remain separate experiments.

Current UX: box identity, metadata and actions precede an inventory table. Adding an item requires entering the editor and finding its Add item button; photographs are reached through item details or IMG-001's separate preview. Proposed improvement: group identity/actions in a workspace header, place Photo immediately after Item, and expose a direct Add Item intent into the existing draft editor.

Hypothesis: this hierarchy reduces time and decisions to understand a box and start recording a new item. The requested coherent image-based layout is evaluated as one workspace treatment; individual effects cannot be attributed solely to colour, table position or the Add Item shortcut.

## Functional mapping

- Global destinations retain the application's real Boxes, Search, and Settings destinations. Add is a primary action on the library page opening `/library/new`; Add Item remains on box details. The Scan route remains directly available, but is absent from menus. The search bar submits an actual query to the existing search service. No account initials or sample records are invented.
- Breadcrumb returns to the library. Header displays actual box name, permanent number, item count and modified date. Internal box UUIDs remain absent from visible content.
- Edit Box opens the existing editor. Add Item opens that editor and creates/focuses one new **in-memory draft item** after loading and permission checks. It performs no automatic save. The intent is consumed on clean/reverted/saved state so a later reload does not add another item after saving.
- Items tab retains a table: Item, Photo, Description, Quantity, Location and Actions. Existing item-location extensions are used when present; otherwise the real box location is shown. First photographs use the existing bounded, viewport-aware thumbnail reader and link to item details. Image-free records have a real Add photo link.
- Row edit and red removal-review icons open the existing editor at the selected item. Removal is reviewed and confirmed there, then saved through the existing coordinated-write workflow. The table does not immediately delete inventory or Drive files.
- The box header has a QR label button alongside Edit Box and Add Item, opening both existing print layouts. Details displays actual metadata and the separate NFC button. Files provides a working link to this box's Google Drive folder. History, bulk selection and global Items navigation from the reference are deferred until their corresponding workflows exist; the layout has no inert controls or fabricated history.

The approved layout changes the box workspace and applies the reference's blue shell/search treatment. Control markup/styles remain available. Item detail photo management, QR printing, scanners, draft confirmation, write verification and data contracts remain shared.

## Metadata

| Field | Definition |
| --- | --- |
| Experiment | REF-001 |
| Control A | Approved persistent navigation and current box details screen. |
| Variant B | Reference-based blue shell and box workspace with contextual Add Item. |
| Population | All users by default following explicit user approval. |
| Primary metric | Time to identify a specified item and start a correctly named new item draft. |
| Secondary metrics | Task completion, tab changes, Add Item starts, row-editor visits and unnecessary navigation. |
| Guardrails | Incorrect selections, duplicate draft items, save integrity, photo memory/network cost, keyboard/focus access and touch readability. |
| Start | Functional/responsive checks pass and testers consent to local measurement. |
| End | At least 10 counterbalanced A/B sessions with equivalent tasks on representative devices; exploratory evidence. |
| Proposed threshold | At least 15% lower median task time without lower completion or material guardrail regressions. |
| Rollback condition | Draft loss/duplication, obscured actions, excessive image requests, inaccessible tabs or operator request. |
| Result | Engineering checks below; no real-user data collected. |
| Decision | PROMOTE — explicitly approved by the user as the primary baseline. |

## Runtime selection and privacy

Primary site: <https://dell-linux-mint.bandicoot-pumpkinseed.ts.net>. Control: `?layout=control`. `referenceLayout.baselineVariant` is `reference-box`, overriding old saved control assignments while preserving an explicit `?layout=control`. `referenceLayout.enabled`, `rolloutPercentage` and `forceVariant` (`control`, `reference-box` or null) live in `config/ui-experiments.json`. REF-001 uses its own session assignment and allocation offset. Disable this flag or force `control` to roll back without deployment; open pages poll every 15 seconds with a 5-second timeout. Navigation, search and photo experiment flags remain independent. A current editor draft is not remounted or discarded by rollout changes.

Local measurement requires `measurementEnabled: true` plus tester `&ux_measure=1`. `window.boxStorageReferenceUx` offers `startTask()`, `finishTask(true/false)`, `summary()` and `clear()`. It records fixed counts for tab changes, Add Item entry and row editing, plus facilitator-confirmed task timing/completion. It records no inventory content, names, IDs, dates, queries, account data, URLs or image bytes, persists no study data and sends no analytics requests. Condition/account/library changes and withdrawal clear counters. A facilitator verifies correct task outcomes; opening a draft is not automatically a successful save.

## Accessibility and responsive behaviour

Real headings, table headers, accessible icon names and a keyboard-operated tablist preserve semantics. Arrow keys, Home and End select/focus tabs. Buttons and image links retain touch targets of at least 44 CSS pixels. On phones, primary actions wrap to a full-width row, tabs fit the available width, and the inventory table scrolls within its container. Phone/tablet bottom navigation remains available. Focus and selected tabs use outlines/underlines as well as colour. The global search input remains 16px on phones. No new animation is introduced; existing progress and reduced-motion behaviour remain shared.

## Engineering verification before promotion

Verified on 2026-10-05 against the deployed Tailscale HTTPS site:

- 21 browser checks passed across Chromium desktop, Firefox desktop and Chromium mobile layout: reference/control isolation, keyboard tabs, Drive folder link, real global search, a single focused unsaved draft item, runtime rollback preserving that draft, reload discarding it without another automatic addition, and existing login/browse/search/edit/label/recovery/sign-out workflows.
- Responsive checks passed at 320, 390, 768 and 1440 CSS pixels with no document overflow and 44px action/tab targets. Desktop and phone screenshots were visually reviewed; the table scrolls internally on phones.
- Frontend suite: 330 tests passed; the final editor/experiment follow-up passed 37 targeted tests. Backend suite: 121 tests passed. TypeScript, ESLint, Ruff, mypy, formatting and production build checks passed.
- OpenAPI contracts were regenerated; the versioned release manifest and release-package test passed. LAN and Tailscale health, preview and runtime configuration endpoints returned HTTP 200; REF-001 remains at 0% automatic rollout independently of approved navigation.
- Deployed image: `sha256:bfee3848273c3201486b09a5238fa92202d3fb34f58c01c53250941921fe90af`.

Synthetic Drive fixtures perform no live-account writes. These checks establish functional behaviour, not user preference or faster task completion. No real-user study data has been collected; The user approved REF-001 as the primary baseline; no measured improvement is claimed.

## Corrected library actions

The user rejected the Add menu proposal. Scan and Add are absent from desktop and mobile menus. Box Library now has a primary Add button alongside its heading. Refresh library and Index recovery are grouped in the Tools section below the boxes. Box cards and box details use a cardboard box icon. Add Item remains a primary action on box details. Existing save, permission and unsaved-change guards remain in effect. Contextual Add and baseline promotion are checked with synthetic Drive fixtures at phone, tablet and desktop widths.

Promotion validation: 15 deployed browser checks passed across Chromium, Firefox and mobile layout, including contextual Add at 320, 768 and 1440 pixels, promotion over a saved control assignment, exactly one focused item draft, reload without duplication, runtime rollback and prior control workflows. The frontend suite passed 332 tests; backend flag tests passed 5 tests. Type checking, lint, production build, regenerated contracts and release-package verification passed. Both LAN and Tailscale serve the approved baseline. Initial promotion image: `sha256:0c48e11868160637f216a6980138425e8fbb857569c88cce72717d2ed0424f98`.

Correction verification: all 15 deployed browser checks passed across Chromium, Firefox and mobile layout. Page-level Add, absence of Scan/Add in menus, working Refresh and recovery preview inside Tools, box icons, draft focus and existing control workflows passed at 320, 768 and 1440 pixels. Eighteen targeted frontend tests, type checking, lint, formatting and production build passed. LAN and Tailscale health/library responses returned HTTP 200. Current deployed image: `sha256:0b46f42de6965c1f6e981255adaf5ecd0af417888dd921fd7a26c1352db5a586`. Synthetic fixtures performed no live-account writes.

QR printing access: the box header now exposes QR label directly on every tab, alongside Edit Box and Add Item. Actions wrap on narrow screens. All 24 deployed Chromium/Firefox/mobile checks passed, including opening both real QR previews, invoking each print option and selecting the matching print target, plus responsive widths and retained draft behaviour. Type checking, lint, formatting and production build passed. Deployed image: `sha256:cb823ba072000ce13cae88c9b2bff9c98b93e9291f4f4e1a911536cd0151dbdb`.
