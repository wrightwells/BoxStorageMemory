# Progressive UX experiments

The supplied instructions are preserved verbatim in [modern-ui-ux-prompt.md](modern-ui-ux-prompt.md). This document records the first implementation and the remaining evidence needed before promotion.

## Approved baseline — 5 October 2026

The user explicitly approved NAV-001 Variant B and requested the next experiment. **PROMOTE**: persistent desktop navigation and the phone/tablet bottom bar are now the baseline (new Control A). `baselineVariant: "persistent-navigation"` migrates existing control assignments as well as new sessions; `?ui=control` retains the previous navigation for rollback. A forced `control` or disabling the navigation flag returns to that previous version without deployment. Measurement remains off. This approval does not imply collected participant data or a complete WCAG audit.

The next independent experiment is [CTX-001 — return to search results](search-context-experiment.md), initially 0% rollout with an opt-in preview. Disabling CTX-001 preserves the approved navigation. [IMG-001 — photo recognition](photo-recognition-experiment.md) is the next independently selectable preview; CTX-001 has not been promoted. [REF-001](reference-box-experiment.md) uses the supplied image and has now been explicitly approved as the primary baseline. CTX-001 and IMG-001 remain separate previews.

The sections below retain NAV-001's original experiment design and pre-approval results as a historical record; their former default/ITERATE statements are superseded by this approval.

## Original UX and analysis

Users identify a box by Library, Search, QR or NFC, open its details, inspect photographs and inventory, then edit or add an item. Global navigation is at the top; contextual actions remain beside the record. Tables support comparison and expandable item metadata avoids overwhelming the editor. The current deployed interface is Control A, including existing photo, QR, save verification and recovery behaviour.

Observed structural problem: the global navigation scrolls away on long detail pages. A user moving from a photograph or item notes to Search must return to the top before selecting Search. This is a hypothesis about interaction cost, not a claim based on observed participant behaviour. On a long page, the control requires scrolling back plus selecting Search; the variant should require selecting Search alone. Search and result selection remain identical.

Proposed improvement: keep global destinations visible. On desktop the header sticks to the top; on phones and tablets up to 900 CSS pixels, the same four destinations appear in a bottom bar. Contextual actions retain their current positions. Principles: predictable navigation, recognition over recall, touch-first interaction and preserving content context.

Implementation impact: shared Layout adds only a conditional header class and experiment lifecycle hook; routes, forms, Drive writes, photo management, scanning, print labels and unsaved-change protection stay shared. The Outlet is never replaced when flags change, preserving draft state. The new stylesheet scopes every visual rule to Variant B. Existing control styles are unchanged.

## NAV-001 metadata

| Field | Definition |
| --- | --- |
| Hypothesis | Persistent navigation reduces time and scrolling to locate the next record after inspecting a long item detail page. |
| Control A | Current header, scrolling naturally with the page. |
| Variant B | Sticky desktop header; bottom navigation on phone/tablet. |
| Population | Initially invited testers opting into preview; production default remains A. |
| Primary metric | Median time from study task start to opening the correct next record. |
| Secondary metrics | Task completion, failed tasks, global navigation activations and scroll interaction episodes. |
| Guardrails | Incorrect record selections, abandonment, obscured controls, accidental navigation, keyboard access and save/data integrity. Observer records qualitative problems and abandonment separately. |
| Start condition | Functional comparison passes; testers consent to local measurement; facilitator starts the fixed task. |
| End condition | At least 10 participants complete counterbalanced A/B tasks on their usual devices. This is exploratory evidence, not a statistically powered production trial. |
| Rollback condition | Obscured controls/focus, navigation regression, draft loss, increased errors or operator request. |
| Result | Engineering verification recorded below. Real-user data has not been collected. |
| Decision | **ITERATE**: retain Control A while gathering usability and accessibility evidence. |

Proposed acceptance threshold before study: at least 15% lower median task time, fewer scroll episodes, completion no lower than A, no additional wrong-record selections or critical accessibility issues. Report participant counts, per-device results, distribution and limitations; do not treat synthetic browser timing as user preference evidence.

## Runtime selection and rollback

`GET /api/v1/ui-experiments` returns an allowlisted, credential-free configuration with `Cache-Control: no-store`. The backend reads `config/ui-experiments.json` on every request. Missing, malformed or invalid configuration disables the experiment. Both Compose deployment files mount the entire configuration directory read-only, allowing atomic replacement of the file to take effect without rebuilding or restarting. `UI_EXPERIMENT_CONFIG` can override the path in non-Compose installations.

Default configuration enables opt-in previews with **0% automatic rollout** and measurements disabled. No account identifier is involved. A random percentage bucket and assignment live in sessionStorage under experiment-specific keys. Route navigation and reloads retain the assignment in the same browser tab. Blocked storage uses a stable assignment in memory until reload. Assignment is experimental, not a permanent presentation preference.

Preview B: open `/?ui=persistent-navigation`. Return to A: open `/?ui=control`. Selection applies once when the app starts and persists through ordinary navigation. A global forced variant takes precedence over previews and saved assignments. To kill the experiment, set `enabled` to `false`; alternatively set `forceVariant` to `"control"`. Open pages poll every 15 seconds, with a 5-second fetch timeout; a failed request falls back to A. Thus rollback is bounded by the polling interval/request timeout, not instantaneous network delivery. Flag changes do not remount the current route.

Rollout: change `rolloutPercentage` from 0 to an approved percentage for **new sessions**. Existing assignments remain stable. `forceVariant` can select a global variant for operator testing. A forced assignment does not overwrite the session's original assignment. A rollback disables measurement and removes diagnostic access.

Future independent experiments should use their own ID, storage keys, config model, hook and scoped CSS; share the generic `selectAssignment` A/B/n allocation and measurement utilities without branching storage workflows. Weighted multiple alternatives and invalid allocations are covered by unit tests. NAV-001 currently has two rendered variants. To add C/D to this navigation experiment, extend the validated variant enums and supply their allocation weights and give each alternative its own metadata and tests before rollout. No unimplemented variants are advertised as available.

## Local measurement workflow

Measurement requires both operator `measurementEnabled: true` and tester `?ux_measure=1`. No analytics requests or persistence occur. The optional `window.boxStorageUx` diagnostic exposes only fixed event counters and task durations in milliseconds. It never records DOM text, input, inventory, URLs, box IDs, photos, Google account data or credentials. It disappears when consent/config disables measurement and clears on reload or a change of variant, avoiding mixed-condition task results. This is a facilitated local study tool, not an unattended production analytics system.

1. Obtain consent, enable measurement in the runtime JSON and open a fresh tab for the assigned A or B URL, adding `&ux_measure=1`.
2. Give equivalent tasks: inspect a long item's details/photo, then find and open another specified record using Search. Counterbalance which variant each participant sees first; use different equivalent target records to reduce learning effects.
3. In developer tools run `window.boxStorageUx.startTask()` immediately before the task. On verified correct record opening run `window.boxStorageUx.finishTask(true)`; for an incorrect/failed task use `finishTask(false)`. Completion is deliberately facilitator-confirmed, not inferred from a URL change.
4. Read `window.boxStorageUx.summary()`. Manually record anonymous study condition/device category and aggregate results only with consent. Scroll counts are throttled episodes, not physical gestures. Backtracking, errors, abandonment and confidence require observer notes; no claim is made that these are automatically captured.
5. Run `clear()` between tasks. Disable measurement after the study. No participant data is committed to the repository.

## Design system and next steps

Variant B introduces semantic roles for navigation surface, border, elevation, text, action/status colours, spacing, radius, typography, icon size, motion and touch targets. Tokens are scoped to B and should be expanded by future accepted component experiments; they do not restyle A. The 900px breakpoint remains a documented CSS media query because CSS variables cannot be used directly in media conditions. Shared navigation markup keeps labels, active-route indication, keyboard semantics and icons consistent. No new decorative animation is introduced.

The next focused experiments, only after NAV-001 review, are restoring search/filter/scroll context on return, photo-first recognition where appropriate, and clearer contextual Add item actions. Preserve structured tables where comparison is useful. Each needs its own hypothesis, consent-aware measurement, loading/empty/error review, independent flag and promotion decision.

Promotion requires functional and regression checks, real assistive-technology review toward WCAG 2.2 AA, usability results supporting the threshold, no degraded guardrails and **explicit approval**. Automated keyboard/viewport checks alone do not establish full WCAG conformance. Only after approval may B become the baseline; keep A temporarily available for rollback.

## Pre-approval engineering validation

Verified on 5 October 2026:

- Frontend: 328 tests pass; TypeScript, ESLint and Prettier pass. Backend/contract: 124 tests plus 116 subtests pass with explicit isolated HTTP test origins. Python lint, formatting, types and OpenAPI export checks pass.
- Control A: all 36 existing browser acceptance checks pass across Chrome desktop, Firefox desktop and Chromium mobile layout, including login, library, search, edit/photo navigation, QR print options, scanner fallback, revocation, responsive layout and moving progress indicators.
- Experiment: 24 checks pass across those three browser projects. At 320, 390, 768, 1024 and 1440 CSS pixels, control navigation scrolls out of view while B remains reachable; targets remain at least 44px tall. Keyboard activation, assignment across route changes/reloads, unchanged control screenshots on reload, slow/error fallback, blocked storage and local measurement withdrawal pass.
- Variant B: 15 shared workflow/dirty-editor checks pass across all three projects. An additional Chrome run passes all five responsive widths and the complete workflow. Phone/tablet/desktop screenshots were reviewed. Rolling back to A preserves unsaved box-name edits and the enabled Save action; no Drive writes are performed by the rollback test.
- The host configuration was atomically replaced with disabled and invalid configurations, then restored. The live API reflected each change without a container restart. HTTPS and host-IP smoke checks pass; the deployed OpenAPI matches the export.

Final deployment: `sha256:d12f19762df10bcb3e57e74bbc4bf2b7bf9f0f5441411236cf83ddf4b4560823`. Production automatic rollout remains 0%, no forced variant, and measurement is off. Preview: <https://dell-linux-mint.bandicoot-pumpkinseed.ts.net/?ui=persistent-navigation>; control: <https://dell-linux-mint.bandicoot-pumpkinseed.ts.net/?ui=control>.

These engineering results support proceeding to the local usability study, **not promotion**. No participant statistics or user preference claims are available. Screen-reader, real assistive-technology, text zoom and hardware acceptance still need a dedicated accessibility review. Browser Drive fixtures are synthetic and do not write to a real Google account. Decision remains **ITERATE** pending the study and explicit baseline approval.
