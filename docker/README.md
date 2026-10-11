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

## Published GHCR image

CI publishes `ghcr.io/wrightwells/boxstoragememory:latest` and
`ghcr.io/wrightwells/boxstoragememory:sha-<full-commit-sha>` after the checks and
container smoke tests pass on `main`. The image supports Linux amd64 and arm64.
The publishing job uses the repository's `GITHUB_TOKEN` with `packages: write`;
no personal token needs to be stored in repository secrets.

Download [compose.ghcr.yaml](../compose.ghcr.yaml) into an empty directory and run:

```bash
docker compose -f compose.ghcr.yaml pull
docker compose -f compose.ghcr.yaml up -d --wait
```

Open `http://localhost:8080`. The image contains the default UI configuration;
this example needs no host config directory or inventory volume. For upgrades,
repeat both commands. Set `BOX_STORAGE_IMAGE` to a commit tag or digest to pin a
release. If using a different `HOST_PORT`, also set matching `PUBLIC_URL` and
`ALLOWED_ORIGINS` values. For Google sign-in, set the public
`GOOGLE_WEB_CLIENT_ID` and register the exact browser origin with Google.

If the GHCR package is private, first authenticate using a GitHub token with
`read:packages` and access to the package:

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

For remote access, use an HTTPS reverse proxy and set `PUBLIC_URL` and
`ALLOWED_ORIGINS` to its HTTPS origin; see the deployment runbook.
