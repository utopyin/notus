# Notus base image

This runtime starts Herdr and observes native readiness, either locally or through authenticated Control callbacks. Once bound and ready it long-polls Control for durable operator commands under its epoch credential, runs each as the `devbox` user with a fixed environment that excludes callback credentials, and reports the bounded result. A checkout command clones the task's repository read-only with a token that exists only in that git process's environment. It runs no model, no specialist and no repository checkout. `runtime-ready` explicitly means `taskAuthorized: false`; it is not permission to execute a coding task.

## Startup contract

[capabilities.json](namespace/capabilities.json) defines the intended provider metadata and the canonical `notus` session command, `exec /usr/local/bin/notus-devbox start`. The deployed Namespace service drops this session during image registration, even through native `WireImage`. The successful live probe supplied the session through native Create's top-level `sessions` field instead. Inspect the stored configuration rather than assuming registration preserved it.

The image's Docker `CMD` supports local execution; it did not start the supervisor automatically in Namespace. The copy under `/usr/local/share/notus-devbox/` is a reference artifact, not automatic registration. `@notus/namespace` still rejects the reserved `notus` name in user configuration. Its separate `trustedLaunch` boundary supplies this session and the scoped callback bootstrap. The earlier published images predate that integration. The callback-enabled base has now passed isolated initial readiness and cold wake; see the [live automation evidence](../../docs/research/namespace.md#readiness-automation-probe-2026-09-13) and [provisioning plan](../../docs/plans/provisioning.md) for the remaining enablement gates.

Commands:

```sh
/usr/local/bin/notus-devbox start
/usr/local/bin/notus-devbox check
/usr/local/bin/notus-devbox doctor  # alias for check
```

`start` stays in the foreground and owns one `herdr server` child. It rejects hosts other than Linux AMD64 and UID 1001. Readiness requires a fresh native ping reporting Herdr 0.9.0/protocol 22 and a decoded snapshot with the same version/protocol. Startup has a 15-second deadline; transient connection/EOF/timeout failures retry every 100 ms within it. Protocol and schema failures do not retry. Each socket request has a two-second deadline and 1 MiB receive cap.

`check` and `doctor` query the current socket afresh, without starting a daemon, writing a readiness marker or trusting previous success. Success prints one JSON record with status, pinned version/protocol and `taskAuthorized: false`. Failure prints a fixed sanitized record and exits nonzero. Daemon output, snapshot content, environment values and exception stacks are never printed.

SIGTERM, SIGINT or SIGHUP interrupts the owning Effect scope. Cleanup sends SIGTERM to the child's process group, escalates to SIGKILL after five seconds if it has not exited, waits for the child to be reaped, then removes the owned directory. Unexpected child termination fails the supervisor, even for child exit code zero. There is no automatic daemon restart.

## State and environment

The default state root is `/home/devbox/.local/state/notus`. `NOTUS_STATE_DIR` selects the root, not the effective runtime directory. Settings reads `/proc/sys/kernel/random/boot_id` once per runtime graph and Schema-validates the Linux UUID. There is no environment override or fallback for boot identity. The readonly Settings API carries `stateRoot`, `kernelBootId`, `directory` as `<stateRoot>/boots/<kernelBootId>`, and `socketPath` as `<directory>/owner/herdr.sock`. Settings now requires FileSystem; main supplies BunServices as before.

The root must be a short, canonical path under `/home/devbox/`. The entire UTF-8 socket path must fit in 107 bytes. Startup validates the root, `boots` and current boot directory in order for canonical paths, UID 1001 and mode 0700. Check/doctor validate those paths and the current owner without creating directories. Symlinked ancestors and noncanonical paths fail. Any legacy `<stateRoot>/owner` entry, including a dangling symlink, blocks startup and checks because its ownership cannot be established. No automatic migration or deletion occurs. Start from a fresh root/image without legacy owners, or require explicit administrator intervention with teardown evidence.

Atomic creation of the current boot's `owner/` prevents duplicate starts. The owner holds the socket, a newly written config, and fresh XDG config/state/cache directories. No native agent state is restored or copied. Successful ordinary cleanup removes only that scope's current owner, after the existing child/group cleanup. Previous boot directories remain untouched and are retained without automatic pruning. The root keeps the enrollment journal in a separate `control/` directory; no callback credentials or other credential state belong in Herdr's boot/owner directories.

SIGKILL or an orphan within the same kernel boot leaves ownership blocked, even if a PID is absent or a file lock is free. A new kernel boot selects a distinct runtime directory without adopting, inspecting PIDs from, or deleting previous boot ownership. Distinct explicitly selected roots remain independent, as before.

This changes the cross-boot exclusion boundary. A boot ID alone cannot prove an old VM using a copied volume is dead, and is neither attestation nor execution authority. Supported use requires Control's single persisted Namespace assignment and a validated provider Stop/Wake boundary. Do not enable wake-up based on this local change alone. Concurrent cloned VMs, same-kernel container recovery and agent-session resume are not supported. Path checks retain the existing trust in the administrator and same-UID processes; they do not prevent those actors from replacing directories between checks. Retained boot directories also accumulate until a separate retention policy is implemented.

The launcher clears inherited environment before Bun starts. The child receives only fixed HOME/USER/LOGNAME/PATH/SHELL/TERM/LANG, owned XDG directories, and supervisor-selected HERDR_CONFIG_PATH/HERDR_SOCKET_PATH. No inherited provider credentials, HERDR client overrides, Node/Bun preload options or shell startup environment hooks are passed. Nothing reads or copies client OAuth caches.

The generated config disables onboarding, update version checks, manifest checks and resume-on-restore. Terminals use `/bin/bash` in `non_login` mode. The image includes Bun, Herdr, bash, git, tmux and certificates. It does not bake in sudo, model CLIs, compilers, Docker sockets or credentials. Namespace registration currently returns Docker-client setup enabled even when CLI or native `WireImage` supplies false. Successful startup logs showed Namespace installing registry credentials in the devbox home. Herdr's environment did not inherit credential keys, but environment filtering is not filesystem isolation. The supervisor creates no file under `/.namespace/tasks`; Namespace created an empty directory there. The previously published runtime failed readiness after Stop/start because it retained unscoped ownership. The boot-scoped source change addresses local directory selection only; it does not establish trusted boot authority or validate the actual VM lifecycle.

This is not a sandbox against the image administrator or same-UID processes. A derived-image administrator can replace the supervisor, shell configuration or binaries. Native socket permissions do not provide task authorization.

## Bound readiness callbacks

With Control configured, enrollment precedes native launch. Every readiness HTTP attempt runs a fresh native ping and snapshot, including retries with the same observation ID. Exact enrollment replay refreshes readiness credentials within 30 seconds of expiry; the refreshed epoch, challenge and next recovery revision must match the stored grant. Native validation runs after refresh. Child-exit racing and scope cleanup cover the entire callback wait.

A prior pending journal from the same kernel fails closed, even without an enrollment reply or readiness acknowledgment. A free owner directory is not evidence that the prior process never launched. Within-process HTTP retries retain the exact request.

On a different kernel, a stored enrollment reply supplies only the successor credential, never readiness authority for the new VM. For a missing reply, the supervisor periodically queries assignment with the exact old credential. Only a successful assignment for the same resource and a different instance permits retiring the uncommitted request without rotating that credential. Control's exact revision check and atomic instance fence justify this transition. Same-instance assignment or permanent assignment rejection leads to exact old enrollment replay; transient failures back off and reevaluate assignment. Permanent replay failure stops recovery without falling back to bootstrap or deleting metadata.

Temporary offline follow-up fixtures exercised uncommitted cross-boot recovery, committed replay, same-kernel refusal, grant mismatch, journal guards, native revalidation after HTTP retry/credential refresh, and cleanup during callback waits. A SQLite-backed fixture exercised the durable old-instance commit fence. Real Herdr checks used the existing local Linux AMD64 image with network disabled; no image was rebuilt or published. These offline checks alone do not validate a real Namespace Stop/Wake cycle, provider evidence, or production HTTP routing. A later callback-enabled publication passed an isolated live cold-wake cycle with exact old-VM destruction evidence, distinct kernel boot IDs and epoch-2 readiness. Both enrollment replays preserved their grants and stale readiness was rejected. That host used Bun SQLite, not deployed Cloudflare; see the [live evidence](../../docs/research/namespace.md#readiness-automation-probe-2026-09-13).

## Build and derivation

Install workspace dependencies and bundle before sending the small app-only Docker context:

```sh
bun install --frozen-lockfile
bun run --cwd apps/devbox build:image
```

The Dockerfile pins an Ubuntu AMD64 manifest and verifies the Herdr and Bun download checksums. Apt repositories remain mutable, so rebuilding is not guaranteed to produce identical bytes. Record and use the resulting OCI digest. The Dockerfile rejects other architectures even when a builder silently chooses its host default. Downloads are checksum-verified in a separate stage. Installed executables and the bundle are root-owned. `.dockerignore` admits only the Dockerfile, launcher, `dist/main.js` and the Namespace files under `namespace/` (canonical capabilities and the busy hook); no workspace-root context or `COPY . .` is used.

[Dockerfile.derived](Dockerfile.derived) takes `ARG NOTUS_BASE_IMAGE` without a fabricated default:

```sh
docker build --platform=linux/amd64 -f apps/devbox/Dockerfile.derived \
  --build-arg NOTUS_BASE_IMAGE="$ACTUAL_BASE_OCI_REF" \
  -t notus-project:local apps/devbox
```

[Dockerfile.dotfiles](Dockerfile.dotfiles) is a derived image carrying a personal dotfiles setup. Root clones the dotfiles repository at a pinned commit and installs its APT manifest; the `devbox` user then runs the repository's `bin/bootstrap --unattended`, which stows the configuration and installs the Mise toolset without signing in to anything. `NOTUS_BASE_IMAGE`, `DOTFILES_REPO` and `DOTFILES_REF` are required build arguments with no defaults; `devbox image build` passes none, so build with docker or a local copy that sets them. The optional `github_token` build secret only raises GitHub's API rate limit while Mise resolves releases and is not written to a layer:

```sh
docker build --platform=linux/amd64 -f apps/devbox/Dockerfile.dotfiles \
  --build-arg NOTUS_BASE_IMAGE="$ACTUAL_BASE_OCI_REF" \
  --build-arg DOTFILES_REPO="$DOTFILES_REPO_URL" \
  --build-arg DOTFILES_REF="$DOTFILES_COMMIT_SHA" \
  --secret id=github_token,env=GITHUB_TOKEN \
  -t notus-dotfiles:local apps/devbox
```

The `devbox` login shell becomes zsh, which is where the Mise tools are on `PATH`. Register it with [capabilities.dotfiles.json](namespace/capabilities.dotfiles.json), the canonical capabilities with `"shell": "/usr/bin/zsh"`, so Namespace's own terminals and SSH sessions open zsh too; the base has no zsh, so the canonical file keeps bash. Read the registered image back, since registration has dropped the `shell` field before. Operator commands and Herdr terminals still run bash with the fixed environment described above, so they do not see those tools. Mise tools declared as `latest` resolve at build time; record the resulting OCI digest. Sign in on the live box with `dot init`.

Keep `USER devbox` in both images. Namespace's generated username metadata mishandles the numeric `1001:1001` form, despite its validity in Docker. The named form preserves UID/GID 1001 and fixed the observed container-creation failure.

Register the derived image with the same canonical `capabilities.json` again, inspect effective metadata, and supply the startup session at Create as described above. OCI inheritance is not Namespace registration. Project-specific dependencies belong in the derived image, without credentials baked into layers.

## Boat template

Boat builds no images, so the Boat template is a named snapshot of a sandbox that ran [boat/recipe.sh](boat/recipe.sh). The recipe installs what the Dockerfile's runtime stage does, with the same download pins, on Boat's Ubuntu 24.04 AMD64 machine: the `devbox` user as UID 1001, Herdr, Bun, Codex, ripgrep, the supervisor bundle and its launcher. It also enables [boat/notus-devbox.service](boat/notus-devbox.service). The unit starts only once `/etc/notus/bootstrap.env` exists. Each launch's setup script writes that root-only file from the sandbox's `env`, because per-sandbox `env` does not reach systemd. After every resume the unit starts again by itself. There is no busy hook: nothing inside a Boat box holds off its auto-stop deadline. The control plane moves it instead while a command runs (`activity:lease`, see the [compute plan](../../docs/plans/compute.md)).

```sh
bun run --cwd apps/devbox build
id=$(boat new --type small --no-env --json | jq -r 'select(.event == "ready") | .id')
boat scp apps/devbox/boat/recipe.sh apps/devbox/boat/notus-devbox.service \
  apps/devbox/notus-devbox apps/devbox/dist/main.js "$id":notus/
boat exec "$id" --timeout 0 -- sudo bash notus/recipe.sh
boat snapshot "$id" notus-base
boat delete "$id"
```

Add the snapshot's name on the Devbox page. Rebuild and save it under a new name whenever the supervisor or a pin changes; a saved name never changes underneath the boxes started from it.

## Validation evidence

The final Dockerfile passed local Linux AMD64 readiness and shutdown checks under emulation, without network access. Independent tests cover native framing, duplicate ownership, child failure and SIGTERM/SIGINT/SIGHUP cleanup. Both base and derived images were published to the authorized Namespace workspace.

The previously published runtime was rebuilt after the diagnostic cleanup. A controlled `USER devbox` comparison and an independent final-source build both activated successfully. The final base passed automatic native Herdr readiness with a Create-supplied session, UID/GID 1001 and the expected bundle hash. The final derived image built from that exact base digest and installed `jq`; it was not launched.

Those published images predate boot-scoped ownership and still fail closed on stale ownership after Stop/start. All test devboxes were expired. See [results and current artifact references](../../docs/research/devbox-results.md) for the reproduced failure, fix and remaining integration limits. These images are not validated for real task execution.

The boot-scoped source passes the app's uncached typecheck, lint and formatting checks on installed Effect rc.112. Temporary Linux AMD64 tests ran with `--network=none --pull=never` on existing local image `sha256:2689b56d344f534a7ebc773a881ae089ef8f41757419d7bef67708ca861cdc85`, with only the current bundle and temporary test scripts mounted. Native Herdr tests cover readiness, duplicate starts, actual same-kernel supervisor SIGKILL/orphan exclusion, stale ownership with an absent PID/free flock, legacy owner entries, root/boots/boot symlinks and unsafe modes, byte-overlong paths, and SIGINT/SIGTERM/SIGHUP cleanup. A synthetic prior-boot owner remains intact while the actual kernel boot selects its own socket. This is a directory-selection test, not a mocked or real VM reboot.

A temporary child stub also verifies cleanup of TERM-resistant detached descendants on all three signals, zero/nonzero leader exit and startup timeout. No live leader or tested descendant remains after cleanup; only the current owner is removed. That boot-directory validation added no repository test files, native helpers, image publication or provider calls. The subsequent callback implementation is described above. Trusted boot authority and an actual Namespace VM Stop/Wake cycle still require separate validation before enablement.
