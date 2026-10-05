# CTX-001 — Return to search results

NAV-001 Variant B was explicitly approved by the user on 5 October 2026 and is now the baseline. The former navigation remains available through `?ui=control` and runtime rollback. No real-user study statistics are inferred from that approval.

## Analysis before implementation

Current UX: Search encodes the query in its URL; selecting a result opens its box/item. The global Search destination points to `/search`, losing the query when used to return. Browser Back can preserve the URL, but does not explicitly restore focus to the selected result. Users may repeat their search and scan the results again.

Improvement: preserve the query, scroll position and selected result in memory for the current account/library session. Returning through Search restores the query and focuses the selected result without changing contextual Back to box links. Principle: predictable navigation and preserving context, reducing recall and repeated input.

Control A: approved persistent navigation with the existing search workflow. Variant B for CTX-001: identical navigation and shared search/storage services, with context restoration. Only the search interaction changes; no card/table/photo/editor redesign is included.

Implementation impact: search context provider in Layout, SearchView result/query handlers, the global Search destination, and an independent runtime flag. Context remains in browser memory, never sessionStorage, localStorage or telemetry. Account/root transitions, sign-out, disabling restoration and reload clear it. Query changes reset the remembered result/scroll. Focus/scroll restoration waits for completed results and skips restoration if the selected record is no longer available. The current query remains in its existing URL; this experiment adds no query persistence beyond the existing URL behaviour.

Rollback: disable `searchContext.enabled` or force its variant to `control` in `config/ui-experiments.json`. Open tabs update on the 15-second poll. The approved persistent navigation and an open search query remain intact; subsequent Search navigation uses the ordinary empty search destination. An invalid/missing global flag file retains the original safe-navigation fallback.

## Metadata

| Field | Definition |
| --- | --- |
| Experiment | CTX-001 |
| Hypothesis | Restoring search context reduces repeat query entry and time to inspect a second result. |
| Population | Invited preview testers; default automatic rollout 0%. |
| Primary metric | Time from first record inspection to correctly opening a second search result. |
| Secondary metrics | Query-change count, result openings, context restorations, task completion/failure. |
| Guardrails | Wrong result selection, stale results, focus/scroll surprises, account/library isolation, draft integrity. |
| Start | Functional checks pass; testers consent to optional local measurements. |
| End | Counterbalanced A/B sessions with at least 10 testers on their usual devices; exploratory evidence only. |
| Success threshold | At least 15% lower median task time and fewer repeated queries, no reduced completion or added critical regressions. |
| Rollback condition | Context leaks between account/library scopes, obscured focus, wrong restoration, or operator request. |
| Result | Engineering checks listed below; no participant results collected. |
| Decision | ITERATE — preview available; separate explicit approval required for baseline promotion. |

## Preview, assignment and measurement

Preview: <https://dell-linux-mint.bandicoot-pumpkinseed.ts.net/?context=restore-search>. Control: `?context=control`. NAV-001 `ui` selection and CTX-001 `context` selection are independent. The experiment stores only its variant assignment in sessionStorage and remains stable during the session; blocked storage falls back to memory. Percentage allocation uses a separate offset bucket, with 0% default rollout. `searchContext.forceVariant` accepts `control` or `restore-search` and takes precedence over session previews.

Opt-in measurement requires operator `measurementEnabled: true` plus `&ux_measure=1`. `window.boxStorageSearchUx` exposes `startTask()`, `finishTask(true/false)`, `summary()` and `clear()`, using the same fixed-counter, in-memory methodology as NAV-001. No queries, record IDs, account data, DOM text or URLs enter measurements; nothing is sent to the server. Counters clear on condition/scope changes or consent withdrawal. A facilitator verifies correct task completion; opening any result alone is not claimed as successful completion.

Use equivalent tasks and counterbalance variant order. Inspect one result, then return and inspect a second matching record. Record errors, abandonment and perceived confidence separately; browser timings are engineering checks rather than real-user evidence.

## Engineering checks

Verified on 5 October 2026:

- Frontend full suite: 329 tests pass. After final instrumentation/restoration changes, all 10 targeted search/assignment tests pass; TypeScript, ESLint, formatting and production build pass.
- Backend: 119 tests pass, including promoted baseline parsing, independent context flags and fail-closed invalid configuration. Python lint/format/types and exported OpenAPI checks pass.
- Final deployment: 12 checks pass across Chrome desktop, Firefox desktop and Chromium mobile layout: legacy-assignment promotion, previous-navigation rollback preview, control comparison, query/scroll/focused-result restoration, independent context rollback, sign-out/reconnect and library-change isolation. Six existing complete-workflow/dirty-editor browser checks also passed before the final unavailable-result guard.
- Live operator configuration was changed to disable CTX-001, verified through the API, and restored. The navigation baseline remained persistent throughout. Measurement is off and automatic CTX-001 rollout is 0%.
- HTTPS and host-IP smoke checks pass; running OpenAPI matches the export; contract release manifest/package checks pass.

Deployed image: `sha256:6f6e4e3f8bfbdf64241fcb7a55e712d58a65a7a90bfd0df6f8865c242dc12688`. No real-user study results or full assistive-technology audit are claimed. CTX-001 remains **ITERATE**, available only through explicit preview/assignment until separately approved. Synthetic Google/Drive fixtures perform no live account writes.
