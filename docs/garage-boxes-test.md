# Garage Boxes library creation test

4 October 2026. The user confirmed a **new library folder**, named exactly
`Garage Boxes`, using the connected `boxstoragememory@gmail.com` account.

Created folder: [Garage Boxes in Google Drive](https://drive.google.com/drive/folders/1o_K89s9e1alo98foyVZ5OUQr4MRoBPAs).
It was created through the deployed application at `http://localhost:8080`, using
the existing registered Google origin. The folder is retained for the user;
no unrelated folder was edited, deleted or trashed.

## Live checks — eight passed

1. Verified the requested account and checked that no same-name folder already
   existed in the My Drive folder listing before creation.
2. Created `Garage Boxes` exactly once, verified its folder MIME type and selected
   it as the library root.
3. Loaded the new library. It has no subfolders and correctly reports a missing
   derived index; creating a library folder does not initialize inventories.
4. Previewed recovery: zero valid inventories across one folder, with no duplicate
   or unavailable records. Index publication remained disabled.
5. Opened the new-box route. It refused the uninitialized index and did not offer
   a creation submission or write any inventory.
6. Changed the root, rediscovered exactly one `Garage Boxes` folder, reselected
   it and checked the account-scoped saved root-ID preference.
7. Audited browser requests: exactly one Drive mutation, a POST creating only the
   requested folder. No box/index/photo mutation, authorization to a non-Google
   destination or CSP violation was observed. Token/header values were not collected.
8. Signed out locally. Only root preferences remained in local storage and
   session storage was empty. The new folder and selected-root preference were retained.

## Automated checks — 158 passed

```bash
npm run test --workspace frontend -- \
  tests/storage.test.ts tests/connection.test.tsx \
  tests/editing.test.ts tests/editing-views.test.tsx \
  tests/library.test.ts tests/validation.test.ts
```

These six suites cover connection/root creation, ambiguous creation without
automatic retries, account/root changes, inventory creation and editing,
item addition/removal, validation and unknown-field preservation, read-only and
invalid/newer records, competing writers/number claims, partial operations,
recovery and fail-closed production writes. Box/item create/update/delete and
concurrency coverage uses local simulated Drive behavior, not live mutation
acceptance.

## Original result and limitation

The requested library folder exists and passed the available creation/read/setup
tests. It remains empty. Actual box/item/photo mutation and root-index bootstrap
are still disabled by the earlier concurrency-verification gates. No index or
inventory was injected to bypass those controls. See [release acceptance](release-acceptance.md)
for the remaining writable-release requirements.

## Completed live box creation follow-up

Safe index initialization and coordinated v2 writes were implemented and verified; the earlier empty-library result is superseded. Using the same authorized account, the deployed app created **BOX-0001 · Garage Tools** in Garage Boxes with location **Garage Boxes**, description **Created by the verified live box creation test.**, and item **10 mm socket**, quantity **2**.

Box UUID: `9e93e5c7-1b01-4666-a58a-b0af811bff07`. [Open the box locally](http://localhost:8080/box/9e93e5c7-1b01-4666-a58a-b0af811bff07) after signing in and selecting Garage Boxes. Fresh Drive reads, number lookup and editor reload verified the saved identity and details. Seven live checks passed, including competing creations in a separate test root and owner removal. No unrelated records were changed. Test sessions signed out afterward.

See [deidentified creation evidence](live-box-creation-test.md) and [protocol decision](decisions/007-coordinated-creation.md). Existing-box editing, photo/NFC writes and automatic interrupted-operation recovery remain separate outstanding work.
