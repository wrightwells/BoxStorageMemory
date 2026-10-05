# 002 — Browser Google authorization and Drive permissions

Status: Browser token model selected from documented capabilities and implemented locally in Stage 5. Live authorization/scope testing remains pending. Technical v1.1 §8 incorporates this resolution of v1.0's preferred browser code + PKCE flow, preserving the no-server-token constraint.

Google's documented Identity Services code model exchanges authorization codes on a backend. We will use its documented browser token model (`initTokenClient`, user-gesture popup and callback) for direct REST requests instead. This conclusion concerns the supported GIS web integration, not a claim that PKCE is universally impossible. No client secret or refresh token is introduced. Sources: [GIS code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model), [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

The token is held in memory with an expiry deadline; denied consent, missing scopes, popup failure, Google 401 and expiry have explicit states. Renewal requires a user action. Account switching clears the old context before opening Google's chooser. Local sign-out ends application access without signing out of Google's website or revoking the grant; a separate revoke action requests grant revocation after clearing local state. [Google's JavaScript reference](https://developers.google.com/identity/oauth2/web/reference/js-reference) defines the prompt, scope and revocation APIs.

## Scope decision

The baseline must discover existing arbitrary nested folders, externally added inventories/photos, and libraries opened from a different deployment. Select `https://www.googleapis.com/auth/drive` for that baseline, subject to the live checks below. Traverse and mutate only the selected root in application code, but accurately explain that this consent scope is account-wide.

`drive.file` grants access to app-created or individually app-authorised files. Selecting a folder is not accepted as evidence that every pre-existing descendant is available. The prototype includes a `drive.file` experiment to compare accessible children; this mode is not advertised as satisfying portable existing-library requirements. Read-only scopes cannot fulfil editing, and the app-data folder scope would hide the ordinary records required by the functional spec. Source: [Google's scope definitions](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

The full Drive scope is restricted. Configure consent/testing users and follow Google's current publishing verification requirements. Whether an additional security assessment is required depends on the deployment and processing of restricted-scope data, including any validation data sent to the service; do not claim exemption solely because OAuth tokens remain in the browser. Do not request unrelated Google-service scopes.

## Setup and outstanding evidence

Registration is application-level: one managed project can hold separate web/native clients for many users. The operator configures the public web client ID; ordinary users need neither Cloud projects nor payment cards. Independent deployments must have trusted origins registered by their project owner. See [decision 006](006-application-oauth-registration.md) for registration, cost and native-client boundaries.

Use separate web/native OAuth configurations. This repository configures only a public web client ID and registered origins, enables the Drive API, and requires no OAuth secret. The Stage 1 prototype accepts an existing root ID directly; Stage 5 implements the application folder browser/selector and manual ID input. Picker is not necessary for the chosen full-scope flow. The client identifies the Drive account with `about.user.permissionId` and scopes folder preferences by that ID without an additional identity scope. Display metadata and tokens remain runtime-only. See [Drive user metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/User).

Pending checks: account chooser/consent, direct API CORS, expiry/renewal/revocation, two-account isolation, existing nested hierarchy discovery, external files and access through a second OAuth application. See [Google setup](../google-setup.md) and [findings](../stage-1-findings.md). Documented capability selection can proceed without representing these checks as executed.
