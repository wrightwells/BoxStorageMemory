# Stage 3 verification

Completed: 3 October 2026.

Design revision: 4 October 2026. Environment/Compose documentation now identifies `GOOGLE_WEB_CLIENT_ID` as one public operator-managed registration shared across deployment users. No per-user Cloud project, IAM role, billing setting or payment-card onboarding is added. Trusted origin registration remains operator setup. The existing configuration/container design already supports this model; historical checks below are unchanged. See [ADR 006](decisions/006-application-oauth-registration.md).

## Delivered

- FastAPI/Pydantic/Uvicorn packages separated into routes, models, services and schema adapters.
- Environment/dotenv settings with explicit CORS origins, optional interactive docs and configurable listener/build path.
- Safe `/api/v1/health` liveness response and request logging without headers, bodies, queries or raw paths.
- Compiled frontend serving, deep-link fallback, JSON API/missing-asset errors and private/traversal-path rejection.
- Responsive React/TypeScript/Vite shell with all planned routes, accessible navigation and actual service status. Drive sign-in/operations remain later-stage work.
- Exact npm workspace lock and hash-locked Python runtime/development dependencies.
- Python lint/format/type checks, frontend lint/format/type/build checks, route and transport tests.
- Multi-stage Docker image and Compose service with non-root/read-only execution, health check and configurable internal/host ports.
- CI for code/contracts/frontend checks plus container build, Compose smoke and non-root checks. CI is configured; equivalent checks were run locally, not on a hosted GitHub runner.
- [Development/run instructions](development.md), `.env.example` and repeatable HTTP smoke utility.

## Executed checks

| Check | Result |
| --- | --- |
| Ruff lint and formatting for backend | Passed |
| Strict mypy | Passed, 13 application source files |
| Python tests | 26 passed, including backend and existing contract/server groups; 116 subtests passed |
| Shared Python/TypeScript contract comparison | Passed, 110 shared vectors and edit preservation |
| Stage 1 prototype tests | Passed, 11 tests |
| Frontend ESLint, Prettier and TypeScript | Passed |
| Frontend route/navigation/health tests | Passed, 11 tests |
| Vite production build | Passed |
| Docker image build from locked dependencies | Passed |
| Native `python -m backend.app` | Started on temporary loopback port; HTTP smoke passed |
| Compose startup | Healthy with `API_PORT=9090` and a random loopback host port |
| Deployment smoke | Health, compiled assets, library/box/edit deep routes and JSON 404s passed |
| Container identity/filesystem | UID 10001, read-only root filesystem, standard-library health check passed |
| Cleanup | Temporary native server and isolated Compose container/network stopped/removed |

The Python test transport emits one upstream deprecation warning recommending the
newer HTTPX test transport; all tests pass with the locked supported HTTPX version.
This does not affect the Uvicorn runtime. Dependency updates should follow the lock
update/check procedure in the development guide.

No Google credentials were needed for these checks. Stage 1 live OAuth/Drive gates
remain pending as already recorded; this stage does not claim to implement or verify
Google login, inventory operations, production HTTPS policy or the Stage 4 utility API.
