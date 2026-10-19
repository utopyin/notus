# Notus dev box

The supervisor that runs on a task's dev box. It enrolls with the Task object using the bootstrap credential it was launched with, starts Herdr and reports native readiness, then long-polls Control for durable commands (shell, checkout, push, specialist rounds) under its runtime capability. Each command runs as the `devbox` user with a fixed environment that excludes callback credentials, and reports a bounded result. A GitHub token exists only in the one git process that needs it.

The box never hosts the operator or model credentials beyond a one-round Codex login, and it never accepts inbound connections: it dials the API.

## Commands

```sh
/usr/local/bin/notus-devbox start   # foreground; owns one herdr server child
/usr/local/bin/notus-devbox check   # fresh readiness probe, JSON on stdout; alias: doctor
```

`start` requires Linux AMD64 and UID 1001. Signals tear down the Herdr process group and remove the owned directory; an unexpected child exit fails the supervisor, with no automatic restart.

## State

The state root defaults to `/home/devbox/.local/state/notus` (`NOTUS_STATE_DIR` overrides it). Herdr's socket and config live under `boots/<kernel boot id>/owner/`, so a new kernel boot gets a fresh directory and a duplicate start in the same boot fails. The enrollment journal lives in a separate `control/` directory. The launcher clears the inherited environment before Bun starts.

This is not a sandbox against the image administrator or same-UID processes.

## Namespace image

```sh
bun install --frozen-lockfile
bun run --cwd apps/devbox build:image
```

The [Dockerfile](Dockerfile) pins its base and verifies download checksums; record the resulting OCI digest. Register it with [namespace/capabilities.json](namespace/capabilities.json), and keep `USER devbox` in the named form, which Namespace needs. Project images derive from it:

- [Dockerfile.derived](Dockerfile.derived) takes `--build-arg NOTUS_BASE_IMAGE=<base ref>`.
- [Dockerfile.dotfiles](Dockerfile.dotfiles) also takes `DOTFILES_REPO` and `DOTFILES_REF`, makes zsh the login shell and registers with [namespace/capabilities.dotfiles.json](namespace/capabilities.dotfiles.json).

[namespace/busy](namespace/busy) is the provider's busy hook: every runtime command calls `/usr/local/libexec/notus/busy start|end <command id>` so Namespace never stops a box mid-command.

## Boat template

Boat builds no images; its template is a named snapshot of a sandbox that ran [boat/recipe.sh](boat/recipe.sh). The API builds it in the workspace's account when an admin connects one, or on Rebuild, from the recipe, [the unit](boat/notus-devbox.service), the launcher and the bundle, so `bun run deploy` builds this app first. Boat has no busy hook: the control plane moves the box's auto-stop deadline while a command runs.

To build one by hand:

```sh
bun run --cwd apps/devbox build
id=$(boat new --type small --no-env --json | jq -r 'select(.event == "ready") | .id')
boat scp apps/devbox/boat/recipe.sh apps/devbox/boat/notus-devbox.service \
  apps/devbox/notus-devbox apps/devbox/dist/main.js "$id":notus/
boat exec "$id" --timeout 0 -- sudo bash notus/recipe.sh
boat snapshot "$id" notus-base
boat delete "$id"
```
