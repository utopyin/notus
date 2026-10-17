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

The `Sandbox` schema has no field naming the machine that currently backs a sandbox, and the [probe](#live-probe-2026-10-17) found none either: the API's stable fields stay the same across resumes, and the fields that change are addresses. Inside the box, the kernel boot id, `/etc/machine-id` and the hostname all change on every resume. Notus's enrollment protocol binds a box to a provider-reported instance id, and its replacement check needs proof that the previous instance ended. A Boat adapter therefore cannot claim `replacement:proof`, and needs another source of the instance id.

## Errors and limits

- Envelope `{ ok, type, status, code, message, error: { code, message, status, details }, requestId }`. The HTTP status is the primary signal.
- `404 not_found`; `409` state conflicts (`sandbox_resuming`, `sandbox_stopping`, `resume_failed`, `snapshot_data_expired`, `idempotency_in_progress`, `idempotency_key_reused`); `429 rate_limited` / `limit_reached`; `503 no_ready_machine` / `out_of_capacity` with `retryAfterSeconds` in the body. No `Retry-After` header.
- Starts (create, fork, resume) per minute/hour/day: $20 plan 12/60/200, trial 5/25/75. A refused start does not count.
- Keys start with `boat_` (`box_` still works). A per-sandbox key works only on its sandbox.
- Machine sizes `small`, `default`, `large`, `xlarge` (the last needs the $100 plan). EU only.

## Live probe 2026-10-17

One `small` sandbox on a free-trial account (`noEnv: true`, `ttlSeconds: 1800`, a per-sandbox `env` value, and a setup script that installed and enabled a oneshot systemd unit logging boot id, machine id, hostname and that value). It went through create, two stop/resume cycles and an auto-stop deadline, then was deleted. The account listed no sandboxes afterwards. The probe script and its redacted log stayed outside the repository.

1. **Identity.** `id`, `subdomain` and `url` (`https://<subdomain>.on.boat.dev`) stayed the same across both resumes, so `url` is the sandbox, not the machine. `ip` and `sshEndpoint` changed on each resume and are null while stopped; they are addresses, not documented as unique. `hydratedAt` stayed null through both resumes and was set only later. Inside the box, the boot id, `/etc/machine-id` (although `/etc` is in the snapshot) and the hostname (`box-node-<hex>`) were new on each resume.
2. **Environment.** The per-sandbox `env` value reached the setup script and commands run through `POST /commands`, including after resume, but not the systemd unit: there it was unset, and `systemctl show-environment` did not carry it. The supervisor's unit needs an `EnvironmentFile` written by the setup script.
3. **Restart.** The enabled unit ran again at each resume: one log line per boot, each with a new boot id, appended to the same file in `/home/user`. The supervisor journal on disk would survive the same way. Re-enrollment itself was not exercised.
4. **Timing.** Create answered `202` in 0.17 s, and the sandbox was `idle` 1.1 s later. The setup script finished within about 7 s. Stop reached `archived` in 8.3 s the first time and 2.1 s the second. Resume answered `202` in 0.4 to 0.5 s with state `provisioned`, and was `idle` or `ready` 1.1 s later. All of this fits the Devbox call's 20-second bound.
5. **Deadline.** With `ttlSeconds` patched to 60 and a detached `sleep 900` running, the sandbox was `archived` 62 s later with `error: null`, the same as an explicit stop. A running process does not hold the deadline off. `POST /commands` on a stopped sandbox answered `409 machine_not_running`.
6. **Idempotency.** The same key and body returned the same sandbox (`202`, same id). The same key with another body answered `409 idempotency_key_reused`. Keys past 24 hours were not tested.

Also observed:

- `DELETE /sandboxes/{id}` requires the header `X-Ascii-Confirm-Delete: <sandbox id>`; without it, `409 delete_confirmation_required`. With it, `202 sandbox.deleting` with a deletion operation (`bdop_…`), and `GET` answered `404` five seconds later.
- The default name is `Box <date>`, not `Sandbox <date>` as the reference shows.
- An account without a plan or started trial answers `402 billing_required` on create, and `GET /limits` reports `canStart: false`.
- The sandbox object also carries `stop`, `lastSnapshotAttemptAt`, `lastSnapshotStatus`, `environment` and `environmentVersion`, which the reference does not list.

## Open questions

- Whether the box-reported boot id can serve as the instance id: the box would report it at enrollment, and the control plane would accept a new one only after observing the sandbox `archived` since the last enrollment. That is a protocol change, decided in the [compute plan](../plans/compute.md).
- How the key behaves past 24 hours, and whether `ip` can repeat across resumes.
- The supervisor's actual re-enrollment after resume, which needs the Boat adapter and a template built from the Notus base recipe.
