# The 2.11.7 official Docker tag is not published yet. Retain the official
# runtime layout and install the upstream release with pinned SHA-512 checksums.
FROM caddy:2.10.2-alpine AS download
ARG TARGETARCH
RUN set -eu; \
    arch="${TARGETARCH:-$(uname -m)}"; \
    case "$arch" in \
      amd64|x86_64) arch=amd64; checksum=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7 ;; \
      arm64|aarch64) arch=arm64; checksum=3db36ba90c7a6e8dda40ee3dd71fa08844c76b5fb08f61b31e5e78d2ed38e71c51dc7baed875e50d1ca1279196e84302967237386ae87c91ae9f2aaceada682e ;; \
      *) echo "Unsupported proxy architecture" >&2; exit 1 ;; \
    esac; \
    wget -q -O /tmp/caddy.tar.gz "https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_${arch}.tar.gz"; \
    echo "$checksum  /tmp/caddy.tar.gz" | sha512sum -c -; \
    tar -xzf /tmp/caddy.tar.gz -C /tmp caddy

FROM caddy:2.10.2-alpine
COPY --from=download /tmp/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
