# syntax=docker/dockerfile:1
# Linux AMD64 Ubuntu 24.04 manifest, resolved 2026-09-13.
ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:a61567bd31828687156d735ea8eb01ba4e37636e225dd6a48ba94136a70d9d61
FROM ${UBUNTU_IMAGE} AS downloads
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64 && test "$(dpkg --print-architecture)" = amd64
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /downloads
RUN curl --fail --location --retry 3 -o herdr \
      https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-linux-x86_64 \
    && echo '4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f  herdr' | sha256sum --check --strict \
    && chmod 0755 herdr
RUN curl --fail --location --retry 3 -o bun.zip \
      https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64-baseline.zip \
    && echo 'c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f  bun.zip' | sha256sum --check --strict \
    && unzip bun.zip && chmod 0755 bun-linux-x64-baseline/bun
# Codex CLI for specialist rounds, from the release package: the CLI, the code-mode host its
# execution tool delegates to, and ripgrep. Credentials arrive per round; none are baked in.
RUN curl --fail --location --retry 3 -o codex-package.tar.gz \
      https://github.com/openai/codex/releases/download/rust-v0.154.0/codex-package-x86_64-unknown-linux-musl.tar.gz \
    && echo 'fc6e3e3b85f2cf7d664520ee5c66a7fe4aa12bae7d46834f47e2f165fd0d6f78  codex-package.tar.gz' | sha256sum --check --strict \
    && tar -xzf codex-package.tar.gz bin/codex bin/codex-code-mode-host codex-path/rg \
    && mv bin/codex codex && mv bin/codex-code-mode-host codex-code-mode-host && mv codex-path/rg rg \
    && chmod 0755 codex codex-code-mode-host rg

FROM ${UBUNTU_IMAGE} AS runtime
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64 && test "$(dpkg --print-architecture)" = amd64 \
    && apt-get update && apt-get install -y --no-install-recommends bash git tmux ca-certificates jq \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1001 devbox \
    && useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash devbox \
    && install -d -o 1001 -g 1001 -m 0755 /workspaces \
    && install -d -o 1001 -g 1001 -m 0700 /home/devbox/.local/state/notus \
    && install -d -o 0 -g 0 -m 0755 /usr/local/lib/notus-devbox /usr/local/share/notus-devbox
COPY --from=downloads --chown=0:0 /downloads/herdr /usr/local/bin/herdr
COPY --from=downloads --chown=0:0 /downloads/bun-linux-x64-baseline/bun /usr/local/bin/bun
COPY --from=downloads --chown=0:0 /downloads/codex /usr/local/bin/codex
COPY --from=downloads --chown=0:0 /downloads/codex-code-mode-host /usr/local/bin/codex-code-mode-host
COPY --from=downloads --chown=0:0 /downloads/rg /usr/local/bin/rg
COPY --chown=0:0 --chmod=0644 dist/main.js /usr/local/lib/notus-devbox/main.js
COPY --chown=0:0 --chmod=0755 notus-devbox /usr/local/bin/notus-devbox
COPY --chown=0:0 --chmod=0644 namespace/capabilities.json /usr/local/share/notus-devbox/capabilities.json
# The provider's busy hook, called around every runtime command; this base image is Namespace's template.
COPY --chown=0:0 --chmod=0755 namespace/busy /usr/local/libexec/notus/busy
ENV HOME=/home/devbox
# Namespace uses this value as a username during Docker socket setup.
USER devbox
WORKDIR /workspaces
# Local Docker convenience only. Namespace starts the trusted Create-supplied session instead.
CMD ["/usr/local/bin/notus-devbox", "start"]
