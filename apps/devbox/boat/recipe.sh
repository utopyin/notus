#!/bin/bash
# The Notus template for Boat, which has no image build: run as root on a fresh sandbox, then save
# the sandbox as a named snapshot. It installs what apps/devbox/Dockerfile's runtime stage does;
# keep the download pins below identical to the Dockerfile's.
#
# Expects beside it: main.js (bun run build), notus-devbox and notus-devbox.service.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
test "$(id -u)" = 0
test "$(dpkg --print-architecture)" = amd64

apt-get update
apt-get install -y --no-install-recommends bash git tmux ca-certificates jq curl unzip

# The supervisor runs as UID 1001 only, like the image's devbox user.
if ! id devbox >/dev/null 2>&1; then
  groupadd --gid 1001 devbox
  useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash devbox
fi
test "$(id -u devbox)" = 1001
install -d -o 1001 -g 1001 -m 0755 /workspaces
install -d -o 1001 -g 1001 -m 0700 /home/devbox/.local/state/notus
install -d -o 0 -g 0 -m 0755 /usr/local/lib/notus-devbox /usr/local/share/notus-devbox

downloads=$(mktemp -d)
cd "$downloads"
curl --fail --location --retry 3 -o herdr \
  https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-linux-x86_64
echo '4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f  herdr' | sha256sum --check --strict
curl --fail --location --retry 3 -o bun.zip \
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64-baseline.zip
echo 'c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f  bun.zip' | sha256sum --check --strict
unzip -q bun.zip
curl --fail --location --retry 3 -o codex-package.tar.gz \
  https://github.com/openai/codex/releases/download/rust-v0.154.0/codex-package-x86_64-unknown-linux-musl.tar.gz
echo 'fc6e3e3b85f2cf7d664520ee5c66a7fe4aa12bae7d46834f47e2f165fd0d6f78  codex-package.tar.gz' | sha256sum --check --strict
tar -xzf codex-package.tar.gz bin/codex bin/codex-code-mode-host codex-path/rg

install -o 0 -g 0 -m 0755 herdr /usr/local/bin/herdr
install -o 0 -g 0 -m 0755 bun-linux-x64-baseline/bun /usr/local/bin/bun
install -o 0 -g 0 -m 0755 bin/codex /usr/local/bin/codex
install -o 0 -g 0 -m 0755 bin/codex-code-mode-host /usr/local/bin/codex-code-mode-host
install -o 0 -g 0 -m 0755 codex-path/rg /usr/local/bin/rg
cd /
rm -rf "$downloads"

install -o 0 -g 0 -m 0644 "$here/main.js" /usr/local/lib/notus-devbox/main.js
install -o 0 -g 0 -m 0755 "$here/notus-devbox" /usr/local/bin/notus-devbox
install -o 0 -g 0 -m 0644 "$here/notus-devbox.service" /etc/systemd/system/notus-devbox.service
# A template carries no bootstrap: each launch's setup script writes its own.
rm -f /etc/notus/bootstrap.env
systemctl daemon-reload
systemctl enable notus-devbox.service
