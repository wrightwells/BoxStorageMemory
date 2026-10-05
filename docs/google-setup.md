# Google setup and live verification

The local deployment now has an operator-configured OAuth client. Live acceptance remains in progress; creating a client and granting its scope do not establish successful Drive API access. Automated mock checks are not substitutes for the procedure below. Setup uses application registration managed by the operator; an ordinary user's Google account is enough for sign-in once that registration is ready.

## Who configures Google Cloud?

These Cloud Console instructions are for the **application operator/publisher**, once per application/deployment registration. Web and Android users do not create Cloud projects, register OAuth clients, join the operator's project, or add payment cards. They authorize the configured application directly with Google and choose their own Drive library.

One project can contain separate web and Android OAuth clients and serve many Google users. The Docker operator configures one `GOOGLE_WEB_CLIENT_ID` for all users of that deployment. Native client registration belongs to the Android publisher. Independent web hosts need trusted, explicitly registered origins; a shared client ID does not automatically work at every Docker hostname. See [registration/security decision](decisions/006-application-oauth-registration.md) and [Google's cross-client model](https://developers.google.com/identity/protocols/oauth2/cross-client-identity).

Google [lists standard Drive API use as free](https://developers.google.com/workspace/drive/api/guides/limits), with planned above-quota charges later in 2026. Prefer an operator project with billing unlinked where Google permits it. Start with [project creation](https://console.cloud.google.com/projectcreate) and [Google Auth Platform](https://console.cloud.google.com/auth/overview), avoiding optional free-trial signup and unrelated paid services. This is not a guarantee that a particular account/project policy or production verification has no operator costs. A billing prompt should be investigated at the operator setup step; it never requires adding a payment card for each app user.

## Stage 5 application setup and live checks

1. As the operator, enable the Drive API in the application project, configure consent/testing users and create a **Web application** OAuth client as described below. Use an External audience for ordinary Gmail test accounts and add them as test users; they do not need project membership. The app uses the restricted `https://www.googleapis.com/auth/drive` scope for existing nested libraries; consent grants account-wide access.
2. Register exact application JavaScript origins: `http://localhost:5173` for Vite and `http://localhost:8080` for the compiled/default Compose app. For this host's Tailscale HTTPS deployment, also register `https://dell-linux-mint.bandicoot-pumpkinseed.ts.net` (no trailing slash) under **Authorized JavaScript origins** on the existing web OAuth client. The popup token flow needs no server exchange endpoint or client secret.
3. Set only the public `GOOGLE_WEB_CLIENT_ID` in your local `.env`, preserving existing configuration. Keep `PUBLIC_URL` and `ALLOWED_ORIGINS` appropriate for the deployment and include the Vite origin when developing. Restart the backend or recreate the Compose service. No rebuild is needed to change the public client ID.
4. Follow [development instructions](development.md), open **Account setup**, wait for the Google script to load, and click **Sign in with Google**. Complete consent, then browse My Drive folders, enter a folder ID, or create an empty library folder. The folder ID is the segment after `/folders/` in its Drive URL. Shared folders/Shared Drives can be selected by ID when the account has permission.
5. Reloading loses the in-memory token; reconnect through a user action. Only successfully selected folder IDs are saved as account-scoped preferences. No inventory/index file is created by root setup, and inventory/photo mutations remain gated on Stage 1 concurrency verification.

Live acceptance checklist (use disposable accounts/libraries):

- Connect A and select an existing nested folder. Close/deny the popup, deny the Drive scope, retry, and verify no Drive request occurs without required permission. Check external files/nested folders remain discoverable under the chosen scope.
- Use A and B as ordinary consent test users with no project/IAM membership or Cloud billing setup; authorize both through the same configured web client ID. Switch to B while a request is delayed. A's account/root/data must disappear before Google's chooser opens; late responses cannot restore them. An unshared A folder must be unavailable to B. Root preferences must restore only for the matching account.
- Change root during requests and sign out. Old-root data/photo object URLs must clear. Inspect browser storage for folder-ID preferences only, with no credentials, inventory, images or queued writes.
- Wait for real expiry and click **Reconnect Google Drive**. Revoke the grant externally and verify Google 401 clears access. Test **Revoke Google access** separately; local access ends even when remote confirmation fails.
- Check invalid/unavailable IDs, read-only/shared folders, pagination and network failure. After uncertain root creation, inspect My Drive before trying again. Duplicate folder names are legal; creation is never blindly retried.
- Inspect requests to the application API for absence of Google authorization headers, tokens, credential cookies and token query/body content. Never copy authorization headers into logs, screenshots, findings or chat.
- Repeat on supported desktop/mobile browsers and a second deployment. Record observations in [Stage 5 findings](stage-5-findings.md). Read adapters and Stage 6 browsing/recovery previews have automated coverage; mutations remain gated. See the [Stage 6 live checklist](library.md#live-acceptance-checklist) and [Stage 7 acceptance gates](editing.md#live-acceptance-gates).

References checked for this implementation: [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [JavaScript reference](https://developers.google.com/identity/oauth2/web/reference/js-reference), [Drive account metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/about), [file listing](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [downloads](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get), [uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads) and [backoff/error guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors).

## Configure a disposable Google project

1. As the operator, create/use the application's Google Cloud project, enable the Google Drive API, and configure Google Auth Platform consent/branding/audience. Reuse this project across test accounts; do not create a project per user.
2. In testing mode add disposable test Google accounts. Choose only Drive scopes required by the experiment; production existing-library use is planned with the restricted `drive` scope.
3. Create an OAuth client of type **Web application**. Register `http://localhost:8765` as an authorised JavaScript origin for this prototype. Use the exact host/port below; `127.0.0.1` is a different origin. Add the real HTTPS origin separately for production.
4. Copy the public client ID (`…apps.googleusercontent.com`) into the prototype. Do not put a secret, token or password in this repository or chat. The popup token model does not use an application token-exchange redirect endpoint.
5. Follow Google's applicable consent/publishing requirements before offering a production deployment. Separate native OAuth registration is work for the separate project.

Sources: [Google web setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [scope definitions and verification](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Start the prototype

```bash
python3 tools/serve_stage1.py
```

Open `http://localhost:8765/prototypes/stage1/index.html`. The local server serves only the explicit prototype assets, setup instructions and synthetic sample inventory; it has no OAuth callback, writable endpoint or token-processing code. It does not serve `.git`, environment files or the rest of the workspace. Stop it with Ctrl+C.

Use a disposable account because the selected `drive` consent is broader than the root that application code traverses. The UI exposes separate read-only inspection and explicit disposable file creation/write experiments. It does not delete or automatically clean up Drive data; remove the visibly named probe root through Drive after inspection.

## Authorization and root checks

- Authorize through Google's popup and grant the requested scope. Verify that the page makes bearer-authenticated requests directly to `https://www.googleapis.com/drive/v3/…` or its upload path. Requests to localhost carry no Google bearer token; token data is absent from URLs, cookies and browser storage.
- Close/deny the popup and deny requested scopes. Verify a clear failure and no subsequent Drive access. Reloading loses the in-memory token and requires authorization again.
- Select an existing test root by folder ID and list immediate children. Compare with Drive, then repeat for nested folder IDs. External inventories/images created directly in Drive must be discoverable under the chosen baseline scope.
- Create a **disposable probe root**, then create its probe JSON files. Record their IDs, read the inventory baseline and inspect the files directly in Drive. This checks root creation and direct JSON read/upload, not production box creation.
- Switch between two test accounts. Runtime root/file/baseline state clears. Selecting the first account's unshared root under the second must fail; shared content is visible only according to Google permissions.
- Renew through a user action, wait for real token expiry, sign out locally, and separately revoke the grant. Access stops until renewed authorization. Revoke outside the application too and confirm Google 401 handling. Do not record a bearer token in the evidence.
- Repeat read-only discovery using `drive.file`. Check pre-existing descendants and records created under another OAuth application; report what is omitted. This experiment cannot close the baseline permission gate merely because the selected folder itself is visible.

## Concurrency checks

The experimental writer is restricted to files named `probe-inventory.json` or `probe-index.json` in visibly named probe roots. It sends a candidate `If-Match` header only if a strong ETag is exposed. The UI checks this; it has no unconditional fallback.

1. Select the newly created probe inventory, load its baseline, and note version/ETag availability. If no usable ETag is exposed, record **not supported / gate remains open** and stop this candidate experiment.
2. Open another tab, authorize independently, paste the same probe file ID, confirm it is disposable and register it. Load the baseline in both tabs before either saves. Choose writer A in the first and B in the second.
3. Save A, then attempt B from the old baseline. B must receive HTTP 412; otherwise the required stale-write guard has failed. Inspect the final inventory in Drive; writer A must remain. Reload B and repeat with roles exchanged.
4. Run the two-writer race repeatedly. Exactly one accepted write and one HTTP 412 is necessary; two successes or unclassified failures do not count as a pass. Repeat cross-tab with nearly simultaneous saves, and if possible from a second device.
5. Repeat on the probe index. Both writers must initially propose the same next number; only one claim may be accepted. Reload the loser and verify its next proposed number differs, preserving both accepted entries. The probe index uses synthetic folder references and is not a real library.
6. Verify browser CORS/header visibility, not just an HTTP client result. A candidate must work for the actual upload/metadata endpoints and all fields Stage 7 needs to mutate.
7. Separately investigate root-index creation and duplicate authoritative filenames: ordinary `files.create` success does not prove unique-name creation. Do not enable production concurrent bootstrap until a tested coordination policy exists.

Passing a single run is not a universal guarantee. Record endpoint, scope, browser, independent-session setup, accepted/rejected outcomes and final file checks. Do not generalise Google Calendar/GData examples to Drive v3. If the candidate is unavailable or unreliable, record the failure and select an independently proven alternative before Stage 7.

## Record results

Update [Stage 1 findings](stage-1-findings.md) with date, browser/OS, test identifiers, expected/observed results and remaining gates. Include no credentials, personal inventory or account secrets. The schema/identifier tests can run immediately without these live checks.


## Consent succeeds but Drive login is denied

The application first reads Drive account information from `about` before selecting a folder. A 403 at that point does not establish a folder-permission problem. Google returns structured error reasons; the client maps a small allow-list to safe setup/consent/policy messages without displaying or logging the raw response.

- `accessNotConfigured` / `SERVICE_DISABLED`: enable **Google Drive API** in the project owning the configured OAuth client, wait a few minutes, then reconnect. Enabling another project's API does not configure this client.
- `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`: reconnect and grant the requested Drive scope.
- `domainPolicy`: the Workspace administrator must allow the app's Drive access.
- File-permission or unrecognized reasons retain a generic account/file-access error. Inspect the failing request's response reason to distinguish other restrictions; the app does not expose raw Google error bodies or headers.

Consent and API enablement are separate setup steps. See [Google's Drive error guide](https://developers.google.com/workspace/drive/api/guides/handle-errors). These classifications are regression-tested; they do not identify the current live failure until Google's actual structured reason is observed.
