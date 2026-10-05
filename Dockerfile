# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend frontend
COPY shared/typescript shared/typescript
COPY schemas/v1 schemas/v1
COPY fixtures/contracts fixtures/contracts
COPY tools/build_web_validators.mjs tools/build_web_validators.mjs
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    API_HOST=0.0.0.0 \
    API_PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist \
    ENABLE_API_DOCS=false
WORKDIR /app
COPY backend/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock \
    && groupadd --gid 10001 boxstorage \
    && useradd --uid 10001 --gid boxstorage --no-create-home boxstorage
COPY backend/app backend/app
COPY backend/__init__.py backend/__init__.py
COPY shared/python shared/python
COPY schemas schemas
COPY --from=frontend-build /build/frontend/dist frontend/dist
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-m", "backend.app.healthcheck"]
CMD ["python", "-m", "backend.app"]
