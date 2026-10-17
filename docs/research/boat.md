# Boat integration evidence

Documented, not validated. Everything here comes from Boat's published documentation, read on 2026-10-17 (`docs.boat.dev`, the `.md` page exports, and the `openapi/boat-v1.yaml` fragments embedded in the API reference). No Boat account, key or sandbox was used. The [compute plan](../plans/compute.md) decides what Notus does with it; this note only records what Boat claims.

## Fit with the devbox port

| Port               | Boat (documented)                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch`           | `POST /sandboxes` with `from: <named snapshot>`, answers `202` with `sandbox.state: provisioning`. Safe to retry with an `Idempotency-Key` (same account, key and body return the same sandbox for 24 h; same key with another body is `409 idempotency_key_reused`). |
| `recover`          | No name or label is accepted at create; `PATCH /sandboxes/{id}` can set `name` afterwards, which is not atomic with create. The idempotency key is the only recovery handle, and only for 24 h and the identical body.                                                |
| `fetch`            | `GET /sandboxes/{id}`. A `cancelled` sandbox is reported once, then `404`.                                                                                                                                                                                            |
| `wake`             | `POST /sandboxes/{id}/resume` answers `202` with `provisioning`; readiness is polled with `GET`. "A resume takes a few seconds."                                                                                                                                      |
| `sleep`            | `POST /sandboxes/{id}/stop` answers `202` with `archiving`; `archived` once the disk is saved. A stop can be refused while the snapshot pipeline fails (`force` exists and loses data).                                                                               |
| `end`              | `DELETE /sandboxes/{id}`, `202`.                                                                                                                                                                                                                                      |
| `proveReplacement` | Nothing documented. See [machine identity](#machine-identity).                                                                                                                                                                                                        |

States, from the `Sandbox` schema: `init`, `provisioning`, `provisioned`, `cloning` (starting); `ready`, `idle`, `running` (accepts commands; `idle`/`running` describe only Boat's integrated agent, never our processes); `archiving`; `archived` (stopped); `error`; `cancelled` (terminal). Sandbox ids match `^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$`.

## Capabilities

- **No idle auto-sleep.** A sandbox stops at a fixed deadline, `ttlSeconds` after create or resume (default 3600, at most 2,592,000; `null` disables it). Only Boat's own agent prompts push the deadline. `PATCH /sandboxes/{id}` with `ttlSeconds` sets the remaining time.
- **Stop and resume** exist. A stop removes the machine and keeps the disk; running processes end; enabled systemd services start again on resume, "the same as a server reboot".
- **Busy signal.** Nothing inside the box tells Boat it is busy. Extending the deadline is an API call with a Boat key, which a `noEnv` sandbox does not hold.
- **Retention.** The disk of a stopped sandbox is kept 14 days, then deleted; resume then fails with `409 snapshot_data_expired`. Named snapshots never expire (10 free, then charged monthly).

## Bootstrap delivery

- `env` on create: per-sandbox variables "injected into the sandbox's tool environment", keys `[A-Za-z_][A-Za-z0-9_]{0,127}`, at most 100 and 64 KB, some names reserved. Not documented: whether systemd services see them.
- `setupScript` on create: up to 64 KB, runs once, in the background after `ready`, as the sandbox user `user` with passwordless `sudo`, "with the sandbox's environment applied". Its outcome is `setupStatus` (`pending`, `running`, `done`, `failed`) and `setupError`. A resume does not run it again.
- An enabled systemd unit under `/etc` is in the snapshot and starts again after stop, resume and fork. This is how the box supervisor would come back after a wake.
- `noEnv: true` gives the sandbox none of the account's environment variables, secret files or credentials, "confined to itself so it cannot act on your account or other sandboxes". The workspace's own Boat account may hold unrelated secrets, so Notus would create every sandbox this way.
- Boat has no image build. A named snapshot built once from the Notus base recipe is the template; `from` also accepts another account's share code.

## Machine identity

The `Sandbox` schema has no field naming the machine that currently backs a sandbox. Candidates that change on resume, none documented as an identity: `url` ("Machine URL when assigned"), `ip`, `hydratedAt` ("when the last resume or fork finished copying files in"). Notus's enrollment protocol binds a box to a provider-reported instance id, and its replacement check needs proof that the previous instance ended. Without a documented identity, a Boat adapter cannot claim `replacement:proof`, and the instance id it reports is a candidate until a live probe shows it changes on every resume and never repeats.

## Errors and limits

- Envelope `{ ok, type, status, code, message, error: { code, message, status, details }, requestId }`. The HTTP status is the primary signal.
- `404 not_found`; `409` state conflicts (`sandbox_resuming`, `sandbox_stopping`, `resume_failed`, `snapshot_data_expired`, `idempotency_in_progress`, `idempotency_key_reused`); `429 rate_limited` / `limit_reached`; `503 no_ready_machine` / `out_of_capacity` with `retryAfterSeconds` in the body. No `Retry-After` header.
- Starts (create, fork, resume) per minute/hour/day: $20 plan 12/60/200, trial 5/25/75. A refused start does not count.
- Keys start with `boat_` (`box_` still works). A per-sandbox key works only on its sandbox.
- Machine sizes `small`, `default`, `large`, `xlarge` (the last needs the $100 plan). EU only.

## Questions for a live probe

Each needs a Boat account and the user's go-ahead before anything is created.

1. Which field, if any, identifies the machine and changes on every resume.
2. Whether `env` reaches an enabled systemd service, or the setup script must write an environment file.
3. That the supervisor's unit restarts after resume and re-enrolls from its journal on disk.
4. How long resume takes to `ready` (the Devbox call is bounded at 20 seconds).
5. What `GET` reports for a sandbox that hit its `ttlSeconds` deadline mid-command, and whether the bootstrap credential in `env` stays readable after resume.
6. That an idempotent create retried with the same key and body returns the same sandbox, and how the key behaves past 24 hours.
