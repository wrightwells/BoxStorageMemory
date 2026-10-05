# Container layout

The root Dockerfile builds the React frontend with Node 22, then copies the compiled
assets into a Python 3.12 runtime containing FastAPI/Uvicorn and hash-locked dependencies.
The frontend build also includes the shared TypeScript validator, v1 schemas and synthetic
contract fixtures used by its type checks. Only compiled browser assets enter the runtime;
there is no user inventory in the build context.
Compose runs it as UID/GID 10001 with a read-only filesystem and a temporary `/tmp`.
No database, inventory volume, Docker socket, host filesystem mount or privileged mode is needed.

The operator sets one public `GOOGLE_WEB_CLIENT_ID` for all users of the deployment and
registers the exact trusted origin with Google. Users sign in directly with Google;
they need no Cloud project or payment-card setup. No account passwords, user tokens,
client secrets or Cloud billing credentials belong in Compose/environment settings.
The native app uses separately registered publisher-managed identity. See
[application registration](../docs/decisions/006-application-oauth-registration.md).

The local example exposes loopback HTTP only. The standalone `compose.production.yaml` and baked Caddy proxy configuration provide an HTTPS example; see [deployment/runbook](../docs/deployment.md). Production Drive mutations remain gated. See [development instructions](../docs/development.md).
