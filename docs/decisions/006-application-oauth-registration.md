# 006 — Application OAuth registration and user onboarding

Date: 4 October 2026.

Status: Accepted design clarification, incorporated into technical specification v1.1 §§7–10 and stage 1–5 documentation. Application registration belongs to the operator/publisher. No Google Cloud project, billing account, payment card, OAuth client creation or Cloud IAM role is required of an ordinary web or Android user. This supplements decisions 001/002; it does not change the v1 data or API contracts.

## Registration model

Use one Google Cloud project for a managed Box Storage application, with Drive API enabled, project-level consent branding/audience and separate OAuth clients for its browser and native Android components. Client registration identifies the application; user consent authorizes access to each user's Drive. Different users are not different OAuth applications. Google's [cross-client identity documentation](https://developers.google.com/identity/protocols/oauth2/cross-client-identity) describes the multi-component project model.

| Role | Required setup |
| --- | --- |
| Application operator/publisher | Own/manage the project, enable Drive API, register trusted web origins and Android application identity, configure consent/testing or applicable production verification, and manage quotas/publishing requirements. |
| Docker/web user | Open the configured application, authorize their Google account directly with Google, and choose their own accessible library folder. No Cloud Console or payment setup. |
| Android user | Install the registered native app, authorize their Google account using the supported native Google flow, and select their library. No Cloud Console or payment setup. |
| Independent Docker operator or Android distributor | Obtain appropriate client registration for their own origins or signed application, either from a publisher who explicitly trusts that deployment or from their own project. This is deployment/distribution setup, not per-user setup. |

For the existing Docker service, the operator sets one public `GOOGLE_WEB_CLIENT_ID`. All authorized users of that deployment use it. It is not an account-specific key, password or client secret. The native project registers its own client identity for its package/signing certificate and supported Google authorization library; it must not treat a web ID supplied by an arbitrary server as its trusted native application identity. Native application implementation remains outside this repository. See [Android authorization](https://developer.android.com/identity/authorization).

## Security boundaries

- Every user grants their own authorization. The project owner, public client ID and Docker server do not thereby receive users' tokens or permission to their Drive files.
- Google sign-in and consent happen through Google's browser/native UI. Box Storage has no password form, Google credential store, server token exchange, service-account impersonation or central Drive proxy.
- Browser tokens remain in memory and Google-authorized requests go directly to Google. The native client owns its Google-authorized transport. The utility API remains token-free. Account/root isolation and write verification gates still apply.
- Register exact trusted web origins. A publisher must assess a deployment before putting its origin under shared application branding: that host serves the JavaScript handling Drive tokens. A shared project is not permission to publish arbitrary self-hosted origins. Do not use wildcard origins, an OAuth relay or an embedded/shared password to bypass registration.
- In testing mode, the operator adds allowed test users to the consent audience. Production public access is subject to Google's verification and organizational policies. Users need no project membership or billing role.

This change preserves the existing full Drive scope because portable pre-existing nested inventories/photos remain a requirement. `drive.file` can reduce access/verification burden for an explicitly selected or app-created file model, but folder selection alone does not establish permission to every existing descendant. Adopting that scope would require a separate import/selection design and live acceptance evidence; it is not necessary to eliminate per-user Cloud setup. See [Google's scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Billing and cost expectations

Google's [Drive API quickstart](https://developers.google.com/workspace/drive/api/quickstart/js) lists a Cloud project and Google account with Drive as prerequisites; it does not list enrolling every user in Cloud billing. Google's [current Drive API pricing/limits](https://developers.google.com/workspace/drive/api/guides/limits) says standard use has no additional charge, and announces charges for above-quota usage later in 2026. Quotas and any applicable API billing belong to the application project; they are not a payment-card onboarding step for each authorized Drive user. Users remain subject to their own Drive storage limits.

Prefer an operator project with no billing account linked when Google permits the required Drive/OAuth configuration. Use direct project creation and Google Auth Platform setup rather than Cloud's optional free-trial enrolment. Do not enable unrelated paid products or promise unlimited/forever-free API usage. A prompt in a particular Console flow is not enough evidence to claim that Drive authorization requires every user's payment card. Inspect its wording and the selected product/account policy if it still blocks operator setup; application code cannot override Google's account/project requirements.

The existing restricted Drive scope can entail publisher verification and potentially security-assessment costs depending on the actual deployment/data handling. This architecture removes per-user Cloud setup; it does not promise that every operator's publishing, hosting, assessment or above-quota usage is cost-free.

## Acceptance and implementation impact

The Stage 5 code reads one deployment-level web client ID from public configuration and has no per-user client-ID/billing setup. Its account-isolation test explicitly asserts that both accounts authorize with the same configured ID. Missing registration is shown as an operator setup error. The authentication transport and published contracts are unchanged; documentation and release acceptance make the roles explicit.

Live acceptance must use at least two ordinary Google accounts that are not project members and have no Cloud billing setup: both authorize the same configured web app, retain separate library contexts, and cannot read each other's unshared files. The separate Android project must demonstrate the corresponding native flow with its registered client. Operator registration and existing Stage 1/5 live Google gates remain pending; no live test is claimed here.
